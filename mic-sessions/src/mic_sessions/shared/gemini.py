"""Gemini CLI transport: the installed `gemini` binary, driven through its two native interfaces.

No vendor SDK: Google ships no agent SDK for the Gemini CLI, so this module launches the pinned CLI
itself and speaks either of the programmatic interfaces it implements:

- `Acp`: `gemini --acp`, the Agent Client Protocol (JSON-RPC 2.0, one JSON object per line on stdio).
  One long-lived process per session; `session/prompt` runs a turn while `session/update`
  notifications stream its text, thoughts, tool calls and context usage.
- `Headless`: `gemini --prompt … --output-format stream-json`, one process per turn printing one JSON
  event per line; the conversation continues across turns with `--resume <session id>`.

Both run with a private `GEMINI_CLI_HOME` (settings, credentials, session logs) and a minimal process
environment, so the host's keys and Mooi's own secrets never reach the agent. No application/session
contracts live here.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import suppress
from pathlib import Path
from typing import Any

from mic_sessions.shared.browser import playwright_server
from mic_sessions.shared.mooi import Credential

LOG = logging.getLogger("sessions")

PROTOCOL_VERSION = 1
AUTH_OAUTH = "oauth-personal"
AUTH_API_KEY = "gemini-api-key"
# The CLI's auto router: it picks a Pro or Flash model per request, like the Gemini CLI's own default.
AUTO_MODEL = "auto"
# What the CLI reads as instructions: Gemini's own file and the cross-agent convention.
CONTEXT_FILES = ("GEMINI.md", "AGENTS.md")
# Variables holding the account credential: redacted from every command the agent runs.
_CREDENTIAL_VARIABLES = ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_ACCESS_TOKEN")
_INHERITED = ("PATH", "TMPDIR", "LANG", "LC_ALL", "JAVA_HOME", "DOCKER_HOST", "AGENT_BROWSER_DIRECTORY")
_STDERR_TAIL = 20
_CLOSE_SECONDS = 10
_END = object()
_MESSAGE_LIMIT = 64 * 1024 * 1024

UpdateHandler = Callable[[dict[str, Any]], Awaitable[None]]
"""Receives one `session/update` notification's `params`, in the order the CLI sent them."""

RequestHandler = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]
"""Answers one request the CLI makes of the client (`session/request_permission`) with its result."""


class GeminiError(RuntimeError):
    """The CLI process or its protocol failed; `cause` is a short, user-safe reason and `code` the
    JSON-RPC error code when the CLI refused a request."""

    def __init__(self, cause: str, detail: str = "", code: int | None = None) -> None:
        super().__init__(f"{cause}: {detail}" if detail else cause)
        self.cause = cause
        self.detail = detail
        self.code = code


def executable(configured: str) -> str:
    path = shutil.which(configured)
    if path is None:
        raise GeminiError("the Gemini CLI is not installed", configured)
    return path


# --- isolation ---------------------------------------------------------------------------------


def _write_private(path: Path, content: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(content)


def write_credential(home: Path, credential: Credential) -> None:
    """The account's Google grant as the CLI caches it. The refresh token lets the CLI renew the one-hour
    access token inside a long turn; Google never rotates it, so no other holder is invalidated."""
    path = home / ".gemini" / "oauth_creds.json"
    if credential.mode != "oauth":
        with suppress(FileNotFoundError):
            path.unlink()
        return
    expires = credential.expires_at.timestamp() * 1000 if credential.expires_at else None
    grant = {"access_token": credential.token, "token_type": "Bearer",
             "scope": "https://www.googleapis.com/auth/cloud-platform "
                      "https://www.googleapis.com/auth/userinfo.email "
                      "https://www.googleapis.com/auth/userinfo.profile"}
    if expires:
        grant["expiry_date"] = int(expires)
    if credential.refresh_token:
        grant["refresh_token"] = credential.refresh_token
    _write_private(path, json.dumps(grant))


def prepare_home(home: Path, credential: Credential, *, instructions: str = "",
                 environment: Mapping[str, str] | None = None, browser: bool = True) -> None:
    """Writes the private Gemini home: settings, the account credential and the session instructions.

    Settings pin the CLI to what Mooi needs: the account's auth type, no auto-update, telemetry,
    checkpoints, IDE companion or interactive shells, the shared Playwright browser, and the
    credential variables redacted from tool commands (the session's own variables always pass)."""
    config = home / ".gemini"
    config.mkdir(parents=True, exist_ok=True, mode=0o700)
    settings: dict[str, Any] = {
        "general": {"enableAutoUpdate": False, "enableAutoUpdateNotification": False,
                    "checkpointing": {"enabled": False}},
        "privacy": {"usageStatisticsEnabled": False},
        "telemetry": {"enabled": False},
        "ide": {"enabled": False},
        "context": {"fileName": list(CONTEXT_FILES)},
        "tools": {"shell": {"enableInteractiveShell": False}},
        "security": {
            "auth": {"selectedType": AUTH_OAUTH if credential.mode == "oauth" else AUTH_API_KEY},
            "folderTrust": {"enabled": False},
            "environmentVariableRedaction": {"enabled": True, "blocked": list(_CREDENTIAL_VARIABLES),
                                             "allowed": sorted(environment or {})},
        },
    }
    if browser:
        settings["mcpServers"] = {"playwright": playwright_server()}
    _write_private(config / "settings.json", json.dumps(settings, indent=2))
    # The global context file: loaded before the repository's own GEMINI.md / AGENTS.md.
    _write_private(config / "GEMINI.md", instructions.strip() + "\n" if instructions.strip() else "")
    write_credential(home, credential)


def environment(home: Path, credential: Credential, extra: Mapping[str, str] | None = None) -> dict[str, str]:
    """A minimal process environment: the toolchain basics, the session's variables, the private home and
    the account. Launched as the whole environment (never merged with the service's), so host API keys,
    proxy credentials and Mooi secrets cannot reach Gemini or the commands it runs."""
    values = {key: os.environ[key] for key in _INHERITED if key in os.environ}
    values.update(extra or {})
    values.update({
        "HOME": str(home), "GEMINI_CLI_HOME": str(home),
        # The session's own checkout: never prompt for folder trust.
        "GEMINI_CLI_TRUST_WORKSPACE": "true",
        # Sign-in is the platform's: the CLI must never open a browser or prompt for a code.
        "NO_BROWSER": "true",
        "TERM": "dumb",
    })
    if credential.mode == "api_key":
        values["GEMINI_API_KEY"] = credential.token
    return values


def session_logs(home: Path) -> Path:
    """Where the CLI records its conversations: `<home>/.gemini/tmp/<project>/chats/`."""
    return home / ".gemini" / "tmp"


# --- process ------------------------------------------------------------------------------------


class _Process:
    """One CLI process in its own process group; closing never leaves its tools or MCP servers behind."""

    def __init__(self, arguments: Sequence[str], *, cwd: Path, env: Mapping[str, str]) -> None:
        self._arguments = list(arguments)
        self._cwd = cwd
        self._env = dict(env)
        self.process: asyncio.subprocess.Process | None = None
        self._stderr: asyncio.Task[None] | None = None
        self.stderr_tail: deque[str] = deque(maxlen=_STDERR_TAIL)

    async def spawn(self) -> asyncio.subprocess.Process:
        try:
            self.process = await asyncio.create_subprocess_exec(
                *self._arguments, cwd=str(self._cwd), env=self._env,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                limit=_MESSAGE_LIMIT, start_new_session=True,
            )
        except OSError as error:
            raise GeminiError("the Gemini CLI could not be started", str(error)) from error
        self._stderr = asyncio.create_task(self._drain_stderr())
        return self.process

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.returncode is None

    def signal(self, signum: int, *, group: bool = True) -> None:
        if self.process is None:
            return
        with suppress(ProcessLookupError, PermissionError):
            if group:
                os.killpg(self.process.pid, signum)
            else:
                self.process.send_signal(signum)

    async def stop(self) -> None:
        """Closes stdin so the CLI saves and exits; a CLI that does not exit has its group signalled."""
        process = self.process
        if process is not None and process.returncode is None:
            if process.stdin is not None and not process.stdin.is_closing():
                with suppress(Exception):
                    process.stdin.close()
            try:
                await asyncio.wait_for(process.wait(), _CLOSE_SECONDS)
            except TimeoutError:
                self.signal(signal.SIGTERM)
                try:
                    await asyncio.wait_for(process.wait(), _CLOSE_SECONDS)
                except TimeoutError:
                    self.signal(signal.SIGKILL)
                    await process.wait()
        if self._stderr is not None:
            self._stderr.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await self._stderr

    def failure_detail(self) -> str:
        code = self.process.returncode if self.process else None
        return f"exit code {code}" + (f"; {self.stderr_tail[-1]}" if self.stderr_tail else "")

    async def _drain_stderr(self) -> None:
        assert self.process is not None and self.process.stderr is not None
        while line := await self.process.stderr.readline():
            text = line.decode("utf-8", "replace").rstrip()
            if text:
                self.stderr_tail.append(text[:500])
                LOG.debug("Gemini CLI emitted diagnostic output (%s characters)", len(text))


async def _lines(stream: asyncio.StreamReader) -> AsyncIterator[dict[str, Any]]:
    """Each JSON object the CLI writes on its own line; anything else (a stray log line) is skipped."""
    while True:
        try:
            line = await stream.readline()
        except (ValueError, asyncio.LimitOverrunError) as error:
            raise GeminiError("a Gemini message exceeded the size limit") from error
        if not line:
            return
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            LOG.debug("Gemini CLI wrote a non-JSON line (%s bytes)", len(line))
            continue
        if isinstance(frame, dict):
            yield frame


# --- Agent Client Protocol ----------------------------------------------------------------------


class Acp:
    """One live `gemini --acp` process. Every frame is handled in the order the CLI wrote it, so a turn's
    `session/prompt` answer is only seen once all of its updates were. Requests the CLI makes are
    answered by `requests`, each in its own task so a parked answer never blocks the stream. Never log
    the environment: it carries the account credential."""

    def __init__(self, arguments: Sequence[str], *, cwd: Path, env: Mapping[str, str],
                 updates: UpdateHandler, requests: RequestHandler | None = None) -> None:
        self._process = _Process(arguments, cwd=cwd, env=env)
        self._updates = updates
        self._requests = requests
        self._reader: asyncio.Task[None] | None = None
        self._responses: dict[int, asyncio.Future[Any]] = {}
        self._handlers: set[asyncio.Task[None]] = set()
        self._write_lock = asyncio.Lock()
        self._next_id = 0
        self._failure: GeminiError | None = None
        self.initialization: dict[str, Any] = {}

    @property
    def alive(self) -> bool:
        return self._process.running and self._failure is None

    @property
    def failure(self) -> GeminiError | None:
        """Why the process stopped serving, once it did."""
        return self._failure

    async def start(self, timeout: float = 60) -> dict[str, Any]:
        """Launch the process and run the `initialize` handshake. A failed start leaves no process behind."""
        await self._process.spawn()
        self._reader = asyncio.create_task(self._read())
        try:
            self.initialization = await self.request("initialize", {
                "protocolVersion": PROTOCOL_VERSION,
                # Gemini reads and writes the checkout itself and runs its own shell: no client file
                # system or terminal, so nothing is proxied through Mooi.
                "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False},
                "clientInfo": {"name": "mooi", "title": "Mooi", "version": "0.1.0"},
            }, timeout=timeout)
        except BaseException:
            await self.close()
            raise
        return self.initialization

    async def request(self, method: str, params: dict[str, Any], timeout: float | None = 60) -> Any:
        """One request the CLI answers; `timeout=None` waits as long as the request runs (a prompt)."""
        self._next_id += 1
        request_id = self._next_id
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._responses[request_id] = future
        try:
            await self._write({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
            if timeout is None:
                return await future
            async with asyncio.timeout(timeout):
                return await future
        except TimeoutError:
            raise GeminiError("the Gemini CLI did not answer", method) from None
        finally:
            self._responses.pop(request_id, None)

    async def notify(self, method: str, params: dict[str, Any]) -> None:
        await self._write({"jsonrpc": "2.0", "method": method, "params": params})

    async def close(self) -> None:
        """Ends the process; safe to call more than once."""
        for task in list(self._handlers):
            task.cancel()
        await self._process.stop()
        if self._reader is not None:
            self._reader.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await self._reader
        await asyncio.gather(*self._handlers, return_exceptions=True)
        self._fail(GeminiError("the agent process exited"))

    async def _write(self, frame: dict[str, Any]) -> None:
        process = self._process.process
        if not self.alive or process is None or process.stdin is None:
            raise self._failure or GeminiError("the agent process exited")
        data = (json.dumps(frame, ensure_ascii=False) + "\n").encode()
        async with self._write_lock:
            try:
                process.stdin.write(data)
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as error:
                raise GeminiError("the agent process exited") from error

    async def _read(self) -> None:
        process = self._process.process
        assert process is not None and process.stdout is not None
        try:
            async for frame in _lines(process.stdout):
                await self._dispatch(frame)
            await process.wait()
            self._fail(GeminiError("the agent process exited", self._process.failure_detail()))
        except GeminiError as error:
            self._fail(error)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self._fail(GeminiError("the agent stream broke", str(error)))

    async def _dispatch(self, frame: dict[str, Any]) -> None:
        method = frame.get("method")
        if method is None:
            future = self._responses.get(frame.get("id"))  # type: ignore[arg-type]
            if future is None or future.done():
                return
            error = frame.get("error")
            if isinstance(error, dict):
                future.set_exception(GeminiError("the Gemini CLI rejected a request",
                                                 str(error.get("message") or ""), error.get("code")))
            else:
                future.set_result(frame.get("result"))
        elif "id" in frame:
            task = asyncio.create_task(self._answer(frame["id"], str(method), frame.get("params") or {}))
            self._handlers.add(task)
            task.add_done_callback(self._handlers.discard)
        elif method == "session/update":
            try:
                await self._updates(frame.get("params") or {})
            except Exception:
                LOG.warning("A Gemini session update could not be handled", exc_info=True)

    async def _answer(self, request_id: Any, method: str, params: dict[str, Any]) -> None:
        try:
            if self._requests is None:
                raise GeminiError("unsupported request", method)
            reply: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "result": await self._requests(method, params)}
        except asyncio.CancelledError:
            raise
        except Exception as error:
            LOG.info("A Gemini CLI %s request was refused", method)
            reply = {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32603, "message": str(error)[:200]}}
        with suppress(GeminiError):
            await self._write(reply)

    def _fail(self, error: GeminiError) -> None:
        if self._failure is None:
            self._failure = error
        for future in self._responses.values():
            if not future.done():
                future.set_exception(self._failure)


# --- headless -----------------------------------------------------------------------------------


class Headless:
    """One `gemini --prompt` turn printing stream-json events. The prompt goes in on stdin, so its size
    is not bound by the command line. `interrupt()` asks the CLI to stop as a Ctrl-C would, so it still
    saves the conversation; a CLI that does not stop has its whole group ended."""

    def __init__(self, arguments: Sequence[str], *, cwd: Path, env: Mapping[str, str]) -> None:
        self._process = _Process(arguments, cwd=cwd, env=env)
        self._finished = False

    @property
    def running(self) -> bool:
        return self._process.running

    async def events(self, prompt: str) -> AsyncIterator[dict[str, Any]]:
        process = await self._process.spawn()
        assert process.stdin is not None and process.stdout is not None
        try:
            process.stdin.write(prompt.encode())
            await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            LOG.debug("The Gemini CLI exited before reading its prompt")
        finally:
            with suppress(Exception):
                process.stdin.close()
        try:
            async for frame in _lines(process.stdout):
                # The `result` event is the turn's own verdict: the exit code only repeats it.
                self._finished |= frame.get("type") == "result"
                yield frame
            code = await process.wait()
            if not self._finished and code not in (0, 130):
                raise GeminiError("the Gemini CLI failed", self._process.failure_detail())
        finally:
            await self.close()

    async def interrupt(self) -> None:
        if not self._process.running:
            return
        self._process.signal(signal.SIGINT, group=False)
        process = self._process.process
        assert process is not None
        try:
            await asyncio.wait_for(process.wait(), _CLOSE_SECONDS)
        except TimeoutError:
            self._process.signal(signal.SIGTERM)

    async def close(self) -> None:
        await self._process.stop()


# --- catalog ------------------------------------------------------------------------------------


_catalogs: dict[str, tuple[float, list[dict[str, Any]]]] = {}


async def models(credential: Credential, binary: str, scratch: Path, *, refresh: bool = False) -> list[dict[str, Any]]:
    """The models this account may use, as `session/new` of a throwaway ACP process reports them (the
    CLI knows which previews the account may use). Cached per account for five minutes."""
    key = credential.connection_id or ""
    cached = _catalogs.get(key)
    if key and not refresh and cached and cached[0] > time.monotonic():
        return cached[1]
    home = scratch / "home"
    workspace = scratch / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    prepare_home(home, credential, browser=False)

    async def ignore(_: dict[str, Any]) -> None:
        return None

    acp = Acp([executable(binary), "--acp"], cwd=workspace, env=environment(home, credential), updates=ignore)
    try:
        await acp.start(timeout=60)
        session = await acp.request("session/new", {"cwd": str(workspace), "mcpServers": []}, timeout=60)
    finally:
        await acp.close()
    entries = ((session or {}).get("models") or {}).get("availableModels") or []
    result = [{"id": entry["modelId"], "label": entry.get("name") or entry["modelId"],
               "description": entry.get("description")}
              for entry in entries if isinstance(entry, dict) and isinstance(entry.get("modelId"), str)]
    if key:
        for stale, (expires, _) in list(_catalogs.items()):
            if expires < time.monotonic():
                _catalogs.pop(stale, None)
        if len(_catalogs) >= 1024:
            _catalogs.pop(next(iter(_catalogs)))
        _catalogs[key] = (time.monotonic() + 300, result)
    return result


# --- account usage ------------------------------------------------------------------------------

_CODE_ASSIST = "https://cloudcode-pa.googleapis.com/v1internal"
_CLIENT_METADATA = {"ideType": "IDE_UNSPECIFIED", "platform": "PLATFORM_UNSPECIFIED", "pluginType": "GEMINI"}
_quotas: dict[str, tuple[float, dict[str, Any]]] = {}
_projects: dict[str, str] = {}


async def quota(credential: Credential, *, refresh: bool = False) -> dict[str, Any]:
    """The Google sign-in's daily request limits per model, as the Gemini CLI's `/stats` reads them from
    Code Assist. Best effort and cached per account for a minute; an API key has no plan limits to read."""
    import httpx

    if credential.mode != "oauth":
        return {}
    key = credential.connection_id or ""
    cached = _quotas.get(key)
    if not refresh and cached and cached[0] > time.monotonic():
        return cached[1]
    headers = {"Authorization": f"Bearer {credential.token}", "Content-Type": "application/json",
               "User-Agent": "Mooi/0.1.0"}
    result: dict[str, Any] = {}
    try:
        async with httpx.AsyncClient(timeout=8) as http:
            project = _projects.get(key)
            if project is None:
                response = await http.post(f"{_CODE_ASSIST}:loadCodeAssist", headers=headers,
                                           json={"metadata": _CLIENT_METADATA})
                response.raise_for_status()
                project = (response.json() or {}).get("cloudaicompanionProject")
                if isinstance(project, dict):
                    project = project.get("id")
            if isinstance(project, str) and project:
                if key:
                    _projects[key] = project
                response = await http.post(f"{_CODE_ASSIST}:retrieveUserQuota", headers=headers,
                                           json={"project": project})
                response.raise_for_status()
                result = _quota_windows((response.json() or {}).get("buckets") or [])
    except (httpx.HTTPError, ValueError, TypeError):
        LOG.debug("Gemini account usage is unavailable")
        result = cached[1] if cached else {}
    if key:
        if len(_quotas) >= 1024:
            _quotas.pop(next(iter(_quotas)))
        _quotas[key] = (time.monotonic() + 60, result)
    return result


def _quota_windows(buckets: list[Any]) -> dict[str, Any]:
    """One daily window per model, named after it: `{"gemini-2.5-pro daily": {"percent": …}}`."""
    from datetime import datetime

    windows: dict[str, Any] = {}
    for bucket in buckets:
        if not isinstance(bucket, dict) or not isinstance(bucket.get("modelId"), str):
            continue
        fraction = bucket.get("remainingFraction")
        if not isinstance(fraction, (int, float)) or isinstance(fraction, bool):
            continue
        reset = bucket.get("resetTime")
        try:
            resets_at = datetime.fromisoformat(reset.replace("Z", "+00:00")).timestamp() if reset else None
        except (ValueError, AttributeError):
            resets_at = None
        windows[f"{bucket['modelId']}_daily"] = {
            "percent": max(0.0, min(100.0, (1 - float(fraction)) * 100)), "window": "daily",
            "resetsAt": resets_at, "updatedAt": time.time()}
    return windows


def last_context(log: Path) -> tuple[int | None, str | None]:
    """The context the conversation's latest model call used (prompt plus reply) and its model, read
    from the CLI's own session log: records are appended, and a message re-appended when it changes."""
    used: int | None = None
    model: str | None = None
    try:
        with log.open(encoding="utf-8") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                tokens = record.get("tokens") if isinstance(record, dict) and record.get("type") == "gemini" else None
                if isinstance(tokens, dict) and isinstance(tokens.get("input"), int):
                    used = tokens["input"] + int(tokens.get("output") or 0)
                    model = record.get("model") if isinstance(record.get("model"), str) else model
    except OSError:
        return None, None
    return used, model


def find_log(home: Path, session_id: str) -> Path | None:
    """The main session log of one conversation: `session-<time>-<first 8 of the id>.jsonl`."""
    matches = sorted(session_logs(home).glob(f"*/chats/session-*-{session_id[:8]}.jsonl"))
    return matches[-1] if matches else None
