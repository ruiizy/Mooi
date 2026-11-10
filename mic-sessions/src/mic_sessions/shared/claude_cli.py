"""Claude Code CLI transport: one `claude --print` process speaking its native stream-json protocol.

No vendor SDK: this module launches the installed CLI itself and speaks the newline-delimited JSON
it reads on stdin and writes on stdout — user messages in, conversation messages out, and the
bidirectional `control_request` / `control_response` frames (initialize, interrupt, set_model,
context usage, tool approvals and hook callbacks). No application/session contracts live here.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import suppress
from pathlib import Path
from typing import Any
from uuid import uuid4

LOG = logging.getLogger("sessions")

ControlHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]
"""Answers one request the CLI makes (`can_use_tool`, `hook_callback`) with its response body."""

_END = object()
_STDERR_TAIL = 20
_CLOSE_SECONDS = 10


class ClaudeCliError(RuntimeError):
    """The CLI process or its protocol failed; `cause` is a short, user-safe reason."""

    def __init__(self, cause: str, detail: str = "") -> None:
        super().__init__(f"{cause}: {detail}" if detail else cause)
        self.cause = cause


def executable(configured: str) -> str:
    path = shutil.which(configured)
    if path is None:
        raise ClaudeCliError("the Claude Code CLI is not installed", configured)
    return path


def environment(overrides: Mapping[str, str]) -> dict[str, str]:
    """The service environment plus `overrides`. `CLAUDECODE` is dropped so the child never
    believes it runs inside another Claude Code, and the CLI never updates itself in place."""
    inherited = {key: value for key, value in os.environ.items() if key != "CLAUDECODE"}
    return {**inherited, "DISABLE_AUTOUPDATER": "1", **overrides}


class ClaudeCli:
    """One live CLI process. Conversation messages are read with `messages()`; control requests the
    CLI sends are answered by `handler`, each in its own task so a parked question never blocks
    the stream. Never log the environment: it carries the account token."""

    def __init__(self, arguments: Sequence[str], *, cwd: Path, env: Mapping[str, str],
                 handler: ControlHandler | None = None, max_message_bytes: int = 64 * 1024 * 1024) -> None:
        self._arguments = list(arguments)
        self._cwd = cwd
        self._env = dict(env)
        self._handler = handler
        self._limit = max_message_bytes
        self._process: asyncio.subprocess.Process | None = None
        self._reader: asyncio.Task[None] | None = None
        self._stderr: asyncio.Task[None] | None = None
        self._stderr_tail: deque[str] = deque(maxlen=_STDERR_TAIL)
        self._messages: asyncio.Queue[Any] = asyncio.Queue()
        self._responses: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._handlers: dict[str, asyncio.Task[None]] = {}
        self._write_lock = asyncio.Lock()
        self._failure: ClaudeCliError | None = None
        self.initialization: dict[str, Any] = {}

    @property
    def alive(self) -> bool:
        return self._process is not None and self._process.returncode is None and self._failure is None

    @property
    def pid(self) -> int | None:
        return self._process.pid if self._process else None

    async def start(self, hooks: dict[str, Any] | None = None, timeout: float = 120) -> dict[str, Any]:
        """Launch the process and run the `initialize` handshake; returns its response (models,
        commands, account). A failed start leaves no process behind."""
        try:
            self._process = await asyncio.create_subprocess_exec(
                *self._arguments, cwd=str(self._cwd), env=self._env,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                limit=self._limit, start_new_session=True,
            )
        except OSError as error:
            raise ClaudeCliError("the Claude Code CLI could not be started", str(error)) from error
        self._reader = asyncio.create_task(self._read())
        self._stderr = asyncio.create_task(self._drain_stderr())
        try:
            self.initialization = await self.request({"subtype": "initialize", "hooks": hooks}, timeout=timeout)
        except BaseException:
            await self.close()
            raise
        return self.initialization

    async def send_user(self, content: str | list[dict[str, Any]], session_id: str | None = None) -> None:
        await self._write({"type": "user", "message": {"role": "user", "content": content},
                           "parent_tool_use_id": None, "session_id": session_id or ""})

    async def request(self, body: dict[str, Any], timeout: float = 30) -> dict[str, Any]:
        """One control request the CLI answers, e.g. `{"subtype": "interrupt"}`."""
        request_id = f"mooi_{uuid4().hex}"
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._responses[request_id] = future
        try:
            await self._write({"type": "control_request", "request_id": request_id, "request": body})
            async with asyncio.timeout(timeout):
                return await future
        except TimeoutError:
            raise ClaudeCliError("the Claude Code CLI did not answer", str(body.get("subtype"))) from None
        finally:
            self._responses.pop(request_id, None)

    async def get_context_usage(self) -> dict[str, Any]:
        return await self.request({"subtype": "get_context_usage"}, timeout=10)

    async def messages(self) -> AsyncIterator[dict[str, Any]]:
        """Conversation messages until the process ends; a broken process raises `ClaudeCliError`."""
        while True:
            message = await self._messages.get()
            if message is _END:
                self._messages.put_nowait(_END)
                raise self._failure or ClaudeCliError("the agent process exited")
            yield message

    async def close(self) -> None:
        """End the conversation: close stdin so the CLI saves and exits; only a CLI that does not
        exit has its whole process group (tools, MCP servers) signalled. Safe to call more than once."""
        process = self._process
        for task in list(self._handlers.values()):
            task.cancel()
        if process is not None and process.returncode is None:
            if process.stdin is not None and not process.stdin.is_closing():
                with suppress(Exception):
                    process.stdin.close()
            try:
                await asyncio.wait_for(process.wait(), _CLOSE_SECONDS)
            except TimeoutError:
                self._signal(signal.SIGTERM)
                try:
                    await asyncio.wait_for(process.wait(), _CLOSE_SECONDS)
                except TimeoutError:
                    self._signal(signal.SIGKILL)
                    await process.wait()
        for task in (self._reader, self._stderr):
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await task
        await asyncio.gather(*self._handlers.values(), return_exceptions=True)
        self._fail(ClaudeCliError("the agent process exited"))

    def _signal(self, signum: int) -> None:
        if self._process is not None:
            with suppress(ProcessLookupError, PermissionError):
                os.killpg(self._process.pid, signum)

    async def _write(self, frame: dict[str, Any]) -> None:
        process = self._process
        if not self.alive or process is None or process.stdin is None:
            raise self._failure or ClaudeCliError("the agent process exited")
        data = (json.dumps(frame, ensure_ascii=False) + "\n").encode()
        async with self._write_lock:
            try:
                process.stdin.write(data)
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as error:
                raise ClaudeCliError("the agent process exited") from error

    async def _read(self) -> None:
        assert self._process is not None and self._process.stdout is not None
        stdout = self._process.stdout
        try:
            while True:
                try:
                    line = await stdout.readline()
                except (ValueError, asyncio.LimitOverrunError) as error:
                    raise ClaudeCliError("an agent message exceeded the size limit") from error
                if not line:
                    break
                try:
                    frame = json.loads(line)
                except json.JSONDecodeError:
                    LOG.debug("Claude CLI wrote a non-JSON line (%s bytes)", len(line))
                    continue
                if isinstance(frame, dict):
                    self._dispatch(frame)
            code = await self._process.wait()
            detail = f"exit code {code}" + (f"; {self._stderr_tail[-1]}" if self._stderr_tail else "")
            self._fail(ClaudeCliError("the agent process exited", detail))
        except ClaudeCliError as error:
            self._fail(error)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self._fail(ClaudeCliError("the agent stream broke", str(error)))

    def _dispatch(self, frame: dict[str, Any]) -> None:
        kind = frame.get("type")
        if kind == "control_response":
            response = frame.get("response") or {}
            future = self._responses.get(str(response.get("request_id")))
            if future is not None and not future.done():
                if response.get("subtype") == "error":
                    future.set_exception(ClaudeCliError("the Claude Code CLI rejected a request",
                                                        str(response.get("error") or "")))
                else:
                    future.set_result(response.get("response") or {})
        elif kind == "control_request":
            request_id = str(frame.get("request_id"))
            self._handlers[request_id] = asyncio.create_task(self._answer(request_id, frame.get("request") or {}))
        elif kind == "control_cancel_request":
            task = self._handlers.get(str(frame.get("request_id")))
            if task is not None:
                task.cancel()
        else:
            self._messages.put_nowait(frame)

    async def _answer(self, request_id: str, request: dict[str, Any]) -> None:
        try:
            if self._handler is None:
                raise ClaudeCliError("unsupported request", str(request.get("subtype")))
            body = await self._handler(request)
            reply = {"subtype": "success", "request_id": request_id, "response": body}
        except asyncio.CancelledError:
            # The CLI abandoned the request: it expects no answer.
            self._handlers.pop(request_id, None)
            raise
        except Exception as error:
            LOG.warning("A Claude CLI %s request failed", request.get("subtype"), exc_info=True)
            reply = {"subtype": "error", "request_id": request_id, "error": str(error)}
        try:
            await self._write({"type": "control_response", "response": reply})
        except ClaudeCliError:
            LOG.debug("The Claude CLI exited before a %s answer", request.get("subtype"))
        finally:
            self._handlers.pop(request_id, None)

    async def _drain_stderr(self) -> None:
        assert self._process is not None and self._process.stderr is not None
        while line := await self._process.stderr.readline():
            text = line.decode("utf-8", "replace").rstrip()
            if text:
                self._stderr_tail.append(text[:500])
                LOG.debug("Claude CLI emitted diagnostic output (%s characters)", len(text))

    def _fail(self, error: ClaudeCliError) -> None:
        if self._failure is None:
            self._failure = error
            self._messages.put_nowait(_END)
        for future in self._responses.values():
            if not future.done():
                future.set_exception(self._failure)
