"""Transversal aspect: agent provider runtimes.

Provider-neutral contracts: the session feature depends on the `AgentRuntime` protocol, on the
domain events built here, and on the `PROVIDERS` factory — never on a vendor
SDK. `claude_agent_sdk` is imported **only** by the Claude adapters in this module, and a second provider's SDK
must be confined to its own adapter exactly the same way.

Adding a provider:

1. Implement the `AgentRuntime` protocol in a new class in this module.
2. The adapter owns all vendor state — subprocess, HTTP session, and its own conversation history
   when the vendor SDK is stateless: `send(text, images)` must work N times on a live runtime.
3. Emit the required domain events (`session.status`, `message.user`, `assistant.message`,
   `tool.use`, `tool.result`, `turn.result`, `error`) and only the optional ones the adapter's
   `AgentCapabilities` declares. Absence of an optional event is compliance, not a bug. Images the
   agent produces (generated, captured or returned by a tool) are stored with `images.save*` and
   travel only as metadata on `tool.result.images`; a native image generator reports itself as the
   `ImageGeneration` tool, so it renders as a generation card from `tool.use` to `tool.result`.
4. `interrupt()` may be a no-op when the `interrupt` capability is `False`.
5. A broken transport costs at most the running turn: `recover()` reconnects keeping the
   conversation, and a long-lived stream recovers itself before it reports `failed`.
6. `trace_sources()` names where the provider's native session log lives (`traces.TraceSource`), so
   the Trace tab reads it; it is cheap and may return `[]` before the conversation exists.
7. Register a `ProviderDescriptor` in `PROVIDERS`.

A provider may have several adapters (`AdapterDescriptor`): implementations of the same contract
with a different integration technology, e.g. Claude through its SDK or through its CLI. Each one
is a complete `AgentRuntime`; a session picks one when it opens and keeps it. Adding an adapter is
adding its runtime class to the provider's `adapters`; the first one is the default.

Nothing outside this module changes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import shutil
import subprocess
import tempfile
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import suppress
from contextvars import ContextVar
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, ClassVar, Protocol, TypedDict, runtime_checkable
from uuid import UUID, uuid4

# The single import of a vendor SDK in the whole service belongs to the Claude SDK adapter, and a second provider's SDK must stay confined to its own adapter the same way. The Claude CLI adapter imports none: it drives the CLI through `claude_cli`.
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    CLIJSONDecodeError,
    ConversationResetMessage,
    HookCallback,
    HookContext,
    HookInput,
    HookJSONOutput,
    HookMatcher,
    PermissionResult,
    PermissionResultAllow,
    PermissionResultDeny,
    ProcessError,
    ResultMessage,
    RateLimitEvent,
    ServerToolResultBlock,
    ServerToolUseBlock,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolPermissionContext,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from mic_sessions.shared import claude_cli
from mic_sessions.shared.agent_conduct import conduct_instructions
from mic_sessions.shared.browser import playwright_server
from mic_sessions.shared.env import get_settings
from mic_sessions.shared import images as session_images
from mic_sessions.shared.images import Image
from mic_sessions.shared.mooi import Credential
from mic_sessions.shared.traces import TraceSource, codex_rollout
from mic_sessions.shared.web import ApiException

LOG = logging.getLogger("sessions")

STATUS_PROVISIONING = "provisioning"
STATUS_READY = "ready"
STATUS_WORKING = "working"
STATUS_WAITING = "waiting"
STATUS_COMPACTING = "compacting"
STATUS_FAILED = "failed"
STATUS_CLOSED = "closed"

_SUMMARY_LIMIT = 100_000
_COMPACT_SUMMARY_LIMIT = 16_000
_TITLE_LIMIT = 120
_FILE_TOOLS = {"Read", "Edit", "Write", "MultiEdit", "NotebookEdit"}
_QUESTION_TOOL = "AskUserQuestion"
IMAGE_GENERATION_TOOL = "ImageGeneration"
VIEW_IMAGE_TOOL = "ViewImage"
_DENIED_MESSAGE = "The user declined this action"
_KIND_PERMISSION = "permission"
_KIND_QUESTION = "question"
_INTERRUPTED_MESSAGE = "The agent connection was interrupted"
RECOVERABLE_DETAIL = "The agent lost its connection. Reconnect to continue; the workspace and its changes are kept."
_ASIDE_TIMEOUT_SECONDS = 300
_TASK_SUBTYPES = frozenset({"task_started", "task_progress", "task_notification", "task_updated"})
# Both Claude task vocabularies: `task_notification` says `stopped` where `task_updated` says `killed`.
_TASK_STATUSES = {"pending": "started", "running": "working", "completed": "completed",
                  "failed": "failed", "stopped": "interrupted", "killed": "interrupted"}


def _aside_prompt(question: str) -> str:
    """Wraps a side question so the model answers it on its own, outside the main task."""
    return (
        "The user has a quick side question while the main task continues elsewhere. Answer it "
        "directly and concisely from this conversation and what you already know. You cannot use "
        "tools, run commands or change files now; if the answer needs information you do not have, "
        "say so briefly and suggest how to find it. Do not continue the main task.\n\n"
        f"<side_question>\n{question}\n</side_question>"
    )


class AgentEvent(TypedDict):
    """One domain event: `type` is an event name and `data` its exact payload."""

    type: str
    data: dict[str, Any]


def session_status(status: str, detail: str | None = None) -> AgentEvent:
    return {"type": "session.status", "data": {"status": status, "detail": detail}}


def message_user(message_id: str, text: str, images: Sequence[Image] = ()) -> AgentEvent:
    return {"type": "message.user", "data": {
        "messageId": message_id, "text": text, "images": [image.payload() for image in images]}}


def assistant_delta(message_id: str, text: str) -> AgentEvent:
    return {"type": "assistant.delta", "data": {"messageId": message_id, "text": text}}


def assistant_message(message_id: str, text: str) -> AgentEvent:
    return {"type": "assistant.message", "data": {"messageId": message_id, "text": text}}


def thinking_delta(message_id: str, text: str) -> AgentEvent:
    return {"type": "thinking.delta", "data": {"messageId": message_id, "text": text}}


def thinking_message(message_id: str, text: str) -> AgentEvent:
    return {"type": "thinking.message", "data": {"messageId": message_id, "text": text}}


def tool_use(tool_use_id: str, name: str, title: str, input_data: dict[str, Any]) -> AgentEvent:
    return {
        "type": "tool.use",
        "data": {"toolUseId": tool_use_id, "name": name, "title": title, "input": input_data},
    }


def tool_result(tool_use_id: str, is_error: bool, summary: str, images: Sequence[Image] = ()) -> AgentEvent:
    data: dict[str, Any] = {"toolUseId": tool_use_id, "isError": is_error, "summary": summary}
    if images:
        data["images"] = [image.payload() for image in images]
    return {"type": "tool.result", "data": data}


def subagent_updated(tool_use_id: str, **fields: Any) -> AgentEvent:
    """The lifecycle of one delegated agent, keyed by the tool call that delegated it. Only fields
    the provider exposed are sent; clients merge them into what they already know."""
    return {"type": "subagent.updated",
            "data": {"toolUseId": tool_use_id, **{key: value for key, value in fields.items() if value is not None}}}


def _with_parent(event: AgentEvent, parent: str | None) -> AgentEvent:
    """Marks an event produced inside a delegated agent, so clients nest it under its delegation
    instead of mixing it with the main agent's turn."""
    if not parent or parent == "root":
        return event
    return {"type": event["type"], "data": {**event["data"], "parentToolUseId": parent}}


def _claude_task_update(task_tools: dict[str, str], subtype: str, data: Mapping[str, Any]) -> AgentEvent | None:
    """Claude reports each delegated agent as a task tied to the `Agent` tool call that started
    it. Tasks of other tools (a background command) share the shape; clients ignore those.
    `task_tools` remembers task id -> delegating call, since later task updates omit the call."""
    task_id = str(data.get("task_id") or "")
    tool_use_id = data.get("tool_use_id") or task_tools.get(task_id)
    if not isinstance(tool_use_id, str) or not tool_use_id:
        return None
    if task_id:
        task_tools[task_id] = tool_use_id
    patch = data.get("patch") if isinstance(data.get("patch"), dict) else {}
    status = {"task_started": "started", "task_progress": "working"}.get(subtype) or _TASK_STATUSES.get(
        str(patch.get("status") or data.get("status") or ""))
    if status is None:
        return None
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    summary = data.get("summary") if subtype == "task_notification" else patch.get("error")
    return subagent_updated(
        tool_use_id, taskId=task_id or None, status=status,
        description=data.get("description") or None,
        lastToolName=data.get("last_tool_name") or None,
        summary=summary if isinstance(summary, str) and summary else None,
        usage={"totalTokens": usage.get("total_tokens"), "toolUses": usage.get("tool_uses"),
               "durationMs": usage.get("duration_ms")} if usage else None,
    )


def permission_request(request_id: str, tool_name: str, title: str, input_data: dict[str, Any]) -> AgentEvent:
    return {
        "type": "permission.request",
        "data": {"requestId": request_id, "toolName": tool_name, "title": title, "input": input_data},
    }


def permission_resolved(request_id: str, decision: str) -> AgentEvent:
    return {"type": "permission.resolved", "data": {"requestId": request_id, "decision": decision}}


def question_request(request_id: str, questions: list[dict[str, Any]]) -> AgentEvent:
    return {"type": "question.request", "data": {"requestId": request_id, "questions": questions}}


def question_resolved(request_id: str, answers: dict[str, Any]) -> AgentEvent:
    return {"type": "question.resolved", "data": {"requestId": request_id, "answers": answers}}


def turn_result(
    terminal_reason: str | None,
    subtype: str | None = None,
    duration_ms: int | None = None,
    cost_usd: float | None = None,
    usage: dict[str, Any] | None = None,
) -> AgentEvent:
    return {
        "type": "turn.result",
        "data": {
            "terminalReason": terminal_reason,
            "subtype": subtype,
            "durationMs": duration_ms,
            "costUsd": cost_usd,
            "usage": usage,
        },
    }


def changes_updated(changes: dict[str, Any]) -> AgentEvent:
    return {"type": "changes.updated", "data": changes}


def session_configuration(model: str, effort: str | None) -> AgentEvent:
    return {"type": "session.configuration", "data": {"model": model, "effort": effort}}


def agent_error(message: str) -> AgentEvent:
    return {"type": "error", "data": {"message": message}}


@dataclass(frozen=True)
class PermissionRequest:
    """The adapter is blocked until the player allows or denies this tool call."""

    request_id: str
    tool_name: str
    title: str
    input: dict[str, Any]


@dataclass(frozen=True)
class QuestionRequest:
    """The adapter is blocked until the player answers the agent's own questions."""

    request_id: str
    questions: list[dict[str, Any]]


Emit = Callable[[str, dict[str, Any]], Awaitable[None]]
"""Publishes one domain event to the session's event log."""

Ask = Callable[[PermissionRequest | QuestionRequest], Awaitable[dict[str, Any]]]
"""Announces to the host that the adapter is now blocked on the player, so the session can move to
`waiting` and expose the pending request. The answer itself does not come back through this call:
it arrives through `resolve(request_id, payload)` on the adapter, because a vendor callback has to
return a vendor-typed result that only the adapter can build. The returned dict is host context and
is empty today."""


@dataclass(frozen=True)
class AgentCapabilities:
    """What a provider can actually do. Everything defaults to `False`, so a new adapter is
    conservative until it opts in and the SPA renders only the affordances it declares."""

    streaming: bool = False
    thinking: bool = False
    permissions: bool = False
    questions: bool = False
    interrupt: bool = False
    editable_tool_input: bool = False
    cost: bool = False
    images: bool = False
    asides: bool = False

    def as_payload(self) -> dict[str, bool]:
        return {
            "streaming": self.streaming,
            "thinking": self.thinking,
            "permissions": self.permissions,
            "questions": self.questions,
            "interrupt": self.interrupt,
            "editableToolInput": self.editable_tool_input,
            "cost": self.cost,
            "images": self.images,
            "asides": self.asides,
        }


@dataclass(frozen=True)
class AgentConfig:
    model: str
    effort: str | None


@runtime_checkable
class AgentRuntime(Protocol):
    """One live agent conversation on one workspace.

    `capabilities` is a class attribute so a runtime instance and its descriptor can never disagree.
    Constructor contract: `(credential, workspace, branch, emit, ask, config, *, instructions="",
    environment=None)`, where `instructions` are session-level guidance the provider adds to its own
    system instructions and `environment` are variables every agent tool command receives.
    """

    capabilities: ClassVar[AgentCapabilities]

    def __init__(
        self,
        credential: Credential,
        workspace: Path,
        branch: str,
        emit: Emit,
        ask: Ask,
        config: AgentConfig,
        *,
        instructions: str = "",
        environment: Mapping[str, str] | None = None,
    ) -> None: ...

    @staticmethod
    def configuration() -> dict[str, Any]: ...

    @classmethod
    def configure(cls, model: str | None, effort: str | None) -> AgentConfig: ...

    async def start(self) -> None: ...

    async def send(self, text: str, images: Sequence[Image] = ()) -> None:
        """Start a turn. `images` reach the model only when the `images` capability is declared."""

    async def refresh_usage(self) -> None: ...

    async def set_configuration(self, config: AgentConfig) -> AgentConfig: ...

    async def interrupt(self) -> None: ...

    async def compact(self, instructions: str | None = None) -> None: ...

    async def close(self) -> None: ...

    def trace_sources(self) -> Sequence[TraceSource]:
        """Where this conversation's native session log lives, for the Trace tab. Cheap: called on every
        trace sync. May return `[]` before the conversation exists or after `close()` (which deletes it)."""
        ...

    async def recover(self) -> None:
        """Reconnect after a broken provider transport, keeping the conversation and the workspace:
        only a running turn is lost. Raises when the session cannot continue."""

    async def resolve(self, request_id: str, payload: dict[str, Any]) -> None: ...

    def aside(self, question: str) -> AsyncIterator[str]:
        """Answer a side question from the conversation so far, in chunks, without touching it: no
        tools, no changes and nothing recorded. Runs beside a turn; only with the `asides` capability."""


CLAUDE_CAPABILITIES = AgentCapabilities(
    streaming=True,
    thinking=True,
    permissions=False,
    questions=True,
    interrupt=True,
    editable_tool_input=False,
    cost=True,
    images=True,
    asides=True,
)


@dataclass
class _PendingRequest:
    """One in-flight `can_use_tool` call, parked until the player answers it."""

    kind: str
    future: asyncio.Future[dict[str, Any]]


class _InMemoryTranscriptStore:
    """Keeps one runtime's opaque SDK transcript for reconnecting clients."""

    def __init__(self) -> None:
        self._entries: dict[tuple[str, str, str | None], list[dict[str, Any]]] = {}
        self._entry_ids: dict[tuple[str, str, str | None], set[str]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _key(key: dict[str, Any]) -> tuple[str, str, str | None]:
        return (str(key["project_key"]), str(key["session_id"]), key.get("subpath"))

    async def append(self, key: dict[str, Any], entries: list[dict[str, Any]]) -> None:
        """Persist SDK blobs in order and de-duplicate retried mirror frames."""
        storage_key = self._key(key)
        async with self._lock:
            stored = self._entries.setdefault(storage_key, [])
            known_ids = self._entry_ids.setdefault(storage_key, set())
            for entry in entries:
                entry_id = entry.get("uuid")
                if isinstance(entry_id, str) and entry_id in known_ids:
                    continue
                # The SDK owns this schema. A shallow copy prevents a caller
                # from mutating the top-level object after append returns.
                stored.append(dict(entry))
                if isinstance(entry_id, str):
                    known_ids.add(entry_id)

    async def load(self, key: dict[str, Any]) -> list[dict[str, Any]] | None:
        async with self._lock:
            entries = self._entries.get(self._key(key))
            return [dict(entry) for entry in entries] if entries else None

    async def forget(self, session_id: str) -> None:
        """Drops a throwaway conversation, such as a side question's fork."""
        async with self._lock:
            for key in [key for key in self._entries if key[1] == session_id]:
                self._entries.pop(key, None)
                self._entry_ids.pop(key, None)


def _tool_title(name: str, input_data: dict[str, Any]) -> str:
    if name == "Bash":
        label = str(input_data.get("command") or name)
    elif name in _FILE_TOOLS:
        label = str(input_data.get("file_path") or input_data.get("notebook_path") or name)
    elif name == "Skill":
        label = str(input_data.get("skill") or input_data.get("name") or input_data.get("description") or name)
    else:
        label = next(
            (
                str(input_data[key])
                for key in ("path", "query", "pattern", "url", "task", "description", "prompt")
                if input_data.get(key)
            ),
            name,
        )
    return label[:_TITLE_LIMIT]


def _block_summary(block: Any) -> str:
    """Readable text of one result block; image bytes never reach the transcript."""
    if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
        return block["text"]
    if isinstance(block, dict) and block.get("type") == "image":
        return "[Image]"
    return block if isinstance(block, str) else json.dumps(block, ensure_ascii=False, default=str)


def _result_summary(content: Any) -> str:
    if isinstance(content, list):
        content = "\n".join(_block_summary(block) for block in content)
    text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, default=str)
    if len(text) > _SUMMARY_LIMIT:
        return text[:_SUMMARY_LIMIT] + "\n[Output truncated at 100,000 characters]"
    return text


def _validate_agent_workspace(workspace_path: Path, expected_branch: str) -> Path:
    settings = get_settings()
    try:
        managed_root = (settings.workspace_root / "sessions").resolve(strict=True)
        workspace = workspace_path.resolve(strict=True)
    except FileNotFoundError as error:
        raise RuntimeError("The session workspace does not exist") from error

    if (
        workspace_path.is_symlink()
        or not workspace.is_dir()
        or workspace == managed_root
        or not workspace.is_relative_to(managed_root)
    ):
        raise RuntimeError("The session workspace is outside the managed workspace root")
    git_dir = workspace / ".git"
    if (
        not git_dir.is_dir()
        or git_dir.is_symlink()
        or not git_dir.resolve(strict=True).is_relative_to(workspace)
    ):
        raise RuntimeError("The session workspace does not have private Git metadata")

    git_binary = shutil.which(settings.git_binary)
    if not git_binary:
        raise RuntimeError("Git is required to validate the session workspace")
    environment = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "LC_ALL": "C",
    }
    try:
        top_level = subprocess.run(
            [git_binary, "-C", str(workspace), "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
            timeout=settings.git_timeout_seconds,
            env=environment,
        ).stdout.strip()
        branch = subprocess.run(
            [git_binary, "-C", str(workspace), "symbolic-ref", "--quiet", "--short", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=settings.git_timeout_seconds,
            env=environment,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("The session workspace Git state could not be validated") from error

    if Path(top_level).resolve() != workspace or branch != expected_branch:
        raise RuntimeError("The session workspace is not on its requested branch")
    return workspace


def _claude_model_label(entry: dict[str, Any], model_id: str) -> str:
    """Versioned name for a Claude Code alias, e.g. "Opus 5.5" for `opus`.

    Aliases stay the stable ids (they follow upgrades), but the CLI only names the family in
    `displayName`; its `description` leads with the current version ("Opus 5.5 · ..."). Any other
    shape falls back to the family name, so a CLI wording change never breaks the catalog.
    """
    name = entry.get("displayName") or model_id
    description = entry.get("description")
    headline = description.split("·", 1)[0].strip() if isinstance(description, str) else ""
    return headline if headline.lower().startswith(f"{name.lower()} ") and len(headline) <= 40 else name


_CLAUDE_CONDUCT = conduct_instructions(edit_tools="the Write, Edit, MultiEdit and NotebookEdit tools")

# `rtk rewrite` exit codes that come with a rewritten command: 0 plain, 3 when a settings `ask` rule
# matched (every tool is approved here anyway). 1 means no RTK filter, 2 a settings `deny` rule.
_RTK_REWRITTEN = {0, 3}
_RTK_TIMEOUT_SECONDS = 5


def _shell_compressor(rtk: str) -> HookCallback:
    """PreToolUse hook running Bash commands through RTK, which keeps only what the model needs of
    their output (as RTK's own Claude Code hook does), so every later request carries less context.

    Only the executed command changes: the transcript keeps the agent's command, and a command RTK
    does not know, or any RTK failure, runs unchanged. It never denies: a denied call is paid twice.
    """

    async def compress(input_data: HookInput, tool_use_id: str | None, context: HookContext) -> HookJSONOutput:
        tool_input = input_data.get("tool_input") or {}
        command = tool_input.get("command")
        if not isinstance(command, str) or not command.strip():
            return {}
        try:
            process = await asyncio.create_subprocess_exec(
                rtk, "rewrite", command, cwd=input_data.get("cwd") or None,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            )
            try:
                stdout, _ = await asyncio.wait_for(process.communicate(), _RTK_TIMEOUT_SECONDS)
            except TimeoutError:
                process.kill()
                await process.wait()
                raise
        except Exception:
            LOG.warning("RTK could not rewrite a shell command; it runs unchanged", exc_info=True)
            return {}
        rewritten = stdout.decode("utf-8", "replace").strip()
        if process.returncode not in _RTK_REWRITTEN or not rewritten or rewritten == command:
            return {}
        return {"hookSpecificOutput": {
            "hookEventName": "PreToolUse", "updatedInput": {**tool_input, "command": rewritten}}}

    return compress


class ClaudeAgentRuntime:
    """Adapter for Claude Code through `claude_agent_sdk`, the only module here that imports it.

    Credentials are process environment for this SDK, and `ClaudeAgentOptions.env` is bound at
    construction: the client instance is therefore the unit of credential isolation — one session,
    one subprocess, one player token, never swapped on a live client.
    """

    capabilities: ClassVar[AgentCapabilities] = CLAUDE_CAPABILITIES
    _catalog: ClassVar[ContextVar[dict[str, Any] | None]] = ContextVar('claude_catalog', default=None)
    _catalogs: ClassVar[dict[str, tuple[float, dict[str, Any]]]] = {}

    @classmethod
    async def load_configuration(cls, credential: Credential, refresh: bool = False) -> None:
        cached = cls._catalogs.get(credential.connection_id or '')
        if not refresh and cached and cached[0] > time.monotonic():
            cls._catalog.set(cached[1])
            return
        with tempfile.TemporaryDirectory(prefix="mooi-claude-models-") as config_dir:
            client = ClaudeSDKClient(options=ClaudeAgentOptions(
                env={
                    "CLAUDE_CODE_OAUTH_TOKEN": credential.token,
                    "CLAUDE_CONFIG_DIR": config_dir,
                    "ANTHROPIC_API_KEY": "",
                    "ANTHROPIC_AUTH_TOKEN": "",
                    "CLAUDE_CODE_USE_BEDROCK": "0",
                    "CLAUDE_CODE_USE_VERTEX": "0",
                    "CLAUDE_CODE_USE_FOUNDRY": "0",
                },
                setting_sources=[],
            ))
            try:
                async with asyncio.timeout(30):
                    await client.connect()
                    info = await client.get_server_info()
            except Exception:
                LOG.exception("Could not load Claude models")
                raise ApiException(502, "Could not load Claude models. Check your connection and try again.") from None
            finally:
                with suppress(Exception):
                    await client.disconnect()

        models = []
        for entry in (info or {}).get("models", []):
            model_id = entry.get("value")
            if not isinstance(model_id, str) or not model_id or model_id.lower() == "default":
                continue
            efforts = entry.get("supportedEffortLevels") or []
            models.append({"id": model_id, "label": _claude_model_label(entry, model_id),
                           "contextWindow": entry.get("contextWindow"),
                           "efforts": efforts if isinstance(efforts, list) else [],
                           # Every Claude Code model is multimodal; the CLI does not list modalities.
                           "images": True})
        if not models:
            raise ApiException(502, "Claude returned no available models. Check your connection and try again.")
        settings = get_settings()
        preferred = settings.agent_claude_model
        default = next((item for item in models if item["id"] == preferred), models[0])
        catalog = {"id": "claude", "label": "Claude", "models": models,
                   "defaultModel": default["id"], "defaultEffort": settings.agent_claude_effort}
        if credential.connection_id:
            for key, (expires, _) in list(cls._catalogs.items()):
                if expires < time.monotonic():
                    cls._catalogs.pop(key, None)
            if len(cls._catalogs) >= 1024:
                cls._catalogs.pop(next(iter(cls._catalogs)))
            cls._catalogs[credential.connection_id] = (time.monotonic() + 300, catalog)
        cls._catalog.set(catalog)

    @classmethod
    def configuration(cls) -> dict[str, Any]:
        return cls._catalog.get() or {"id": "claude", "label": "Claude", "models": [],
                                      "defaultModel": "", "defaultEffort": None}

    @classmethod
    def configure(cls, model: str | None, effort: str | None) -> AgentConfig:
        catalog = cls.configuration()
        chosen = model or catalog["defaultModel"]
        candidate = next((item for item in catalog["models"] if item["id"] == chosen), None)
        if candidate is None:
            raise ApiException.bad_request("Unsupported model")
        supported = candidate["efforts"]
        default = catalog["defaultEffort"]
        chosen_effort = effort if effort is not None else (
            default if default in supported else supported[0] if supported else None
        )
        if chosen_effort is not None and chosen_effort not in candidate["efforts"]:
            raise ApiException.bad_request("Unsupported effort for this model")
        return AgentConfig(chosen, chosen_effort)


    def __init__(
        self,
        credential: Credential,
        workspace: Path,
        branch: str,
        emit: Emit,
        ask: Ask,
        config: AgentConfig,
        *,
        instructions: str = "",
        environment: Mapping[str, str] | None = None,
    ) -> None:
        self._config = config
        self._instructions = instructions
        self._environment = dict(environment or {})
        self._credential = credential
        self._workspace = workspace
        self._branch = branch
        self._emit = emit
        self._ask = ask
        self._client: ClaudeSDKClient | None = None
        self._pump: asyncio.Task[None] | None = None
        self._pending: dict[str, _PendingRequest] = {}
        self._stream_message_id: str | None = None
        self._stream_ids: dict[str, str] = {}
        self._assistant_block_offsets: dict[tuple[str, str], int] = {}
        # Claude task id -> the tool call that delegated it; later task updates omit the call.
        self._task_tools: dict[str, str] = {}
        self._context_input: int | None = None
        self._context_output = 0
        self._context_model: str | None = None
        self._context_window: int | None = None
        self._quota_reported_at = 0.0
        self._last_quota = None
        self._interrupted = False
        self._turn_active = False
        self._awaiting_first_event_at: float | None = None
        self._config_dir: Path | None = None
        self._clients: set[ClaudeSDKClient] = set()
        self._recovery_lock = asyncio.Lock()
        self._conversation_id: str | None = None
        self._compacted_context: str | None = None
        self._transcript_store = _InMemoryTranscriptStore()

    async def start(self) -> None:
        started_at = time.perf_counter()
        self._workspace = await asyncio.to_thread(self._validate_workspace)
        # Provider state is private to this runtime and survives client replacement.
        # It is outside the checkout, but inside the owned session directory so
        # workspace reconciliation can remove it after an unclean service exit.
        self._config_dir = Path(tempfile.mkdtemp(prefix="claude-", dir=self._workspace.parent))
        self._client = await self._connect_client(self._config)
        self._pump = asyncio.create_task(self._pump_messages(self._client))
        await asyncio.gather(self._refresh_context(), self._refresh_quota())
        LOG.info("Claude runtime connected in %.0f ms", (time.perf_counter() - started_at) * 1000)

    async def _refresh_context(self) -> None:
        from mic_sessions.shared import claude_usage
        context = await claude_usage.context(self._require_client())
        if context is not None:
            self._context_window = context["limitTokens"]
            await self._emit("session.usage", {"context": context})

    async def _refresh_quota(self, *, refresh: bool = False) -> None:
        from mic_sessions.shared import claude_usage
        quota = await claude_usage.quota(self._credential.connection_id, self._credential.token, refresh=refresh)
        if quota != self._last_quota:
            self._last_quota = quota
            await self._emit("session.usage", {"quota": quota})

    async def refresh_usage(self) -> None:
        await self._refresh_quota()

    async def send(self, text: str, images: Sequence[Image] = ()) -> None:
        self._interrupted = False
        started_at = time.perf_counter()
        client = self._require_client()
        self._turn_active = True
        if images:
            # Images precede the text, as the Messages API recommends for multimodal prompts.
            blocks = await asyncio.to_thread(lambda: [
                {"type": "image", "source": {"type": "base64", "media_type": image.media_type,
                                             "data": image.base64()}} for image in images])
            if text:
                blocks.append({"type": "text", "text": text})

            async def prompt():
                yield {"type": "user", "message": {"role": "user", "content": blocks}, "parent_tool_use_id": None}

            await client.query(prompt())
        else:
            await client.query(text)
        self._awaiting_first_event_at = time.perf_counter()
        LOG.info("Claude turn submitted in %.0f ms", (time.perf_counter() - started_at) * 1000)

    async def refresh_credential(self, credential: Credential) -> None:
        """The platform renews a Claude sign-in token before it expires; a running client keeps the
        token it was launched with, so a renewed one reconnects it, resuming the conversation."""
        if credential.connection_id != self._credential.connection_id:
            raise ApiException.conflict("The Claude account changed. Create a new session.")
        if credential.token == self._credential.token or self._turn_active:
            # Mid-turn the current token still has the renewal margin left; the next message swaps it.
            return
        previous, self._credential = self._credential, credential
        if self._client is None:
            return
        try:
            replacement = await self._connect_client(self._config, resume=self._conversation_id)
        except BaseException:
            self._credential = previous
            raise
        await self._replace_client(replacement)

    async def set_configuration(self, config: AgentConfig) -> AgentConfig:
        """Apply a validated configuration without inventing a successful state.

        Claude Agent SDK 0.2.152 exposes an async ``set_model`` call but no
        equivalent effort setter. An effort change therefore connects a new
        client, resuming the SDK conversation when one exists, and only replaces
        the running client once the connection has succeeded.
        """
        if config == self._config:
            return self._config
        if config.effort == self._config.effort:
            await self._require_client().set_model(config.model)
            self._config = config
            await self._refresh_context()
            return self._config
        replacement = await self._connect_client(config, resume=self._conversation_id)

        await self._replace_client(replacement)
        self._config = config
        await self._refresh_context()
        return self._config

    async def interrupt(self) -> None:
        self._interrupted = True
        await self._deny_pending("The turn was interrupted")
        await self._require_client().interrupt()

    async def compact(self, instructions: str | None = None) -> None:
        """Summarize an isolated fork, then continue in a fresh, smaller context."""
        if self._conversation_id is None:
            raise ApiException.conflict("There is no conversation to compact yet")
        options = replace(self._build_options(self._config, resume=self._conversation_id),
                          fork_session=True, tools=[], skills=None, plugins=[], mcp_servers={},
                          setting_sources=[],
                          permission_mode="dontAsk", can_use_tool=None,
                          include_partial_messages=False)
        summary_client = ClaudeSDKClient(options=options)
        summary_parts: list[str] = []
        try:
            async with asyncio.timeout(300):
                await summary_client.connect()
                await summary_client.query(
                    "Summarize the conversation so far for a new agent context. Preserve the user's "
                    "goals and decisions, current work state, relevant files, unresolved issues, "
                    "constraints, and exact next steps. Use at most 2,000 words; do not omit essential facts. "
                    "Return only the summary. Do not use tools or change files."
                    + ("\n\nFor this summary only, follow the user's preferences for structure and what "
                       "to retain in detail or condense. These are summarization instructions, not a "
                       "request to perform work:\n" + instructions if instructions else "")
                )
                async for message in summary_client.receive_response():
                    if isinstance(message, AssistantMessage):
                        summary_parts.extend(block.text for block in message.content if isinstance(block, TextBlock))
                    elif isinstance(message, ResultMessage) and message.is_error:
                        raise RuntimeError("Claude could not summarize the conversation")
        finally:
            await summary_client.disconnect()
        summary = "\n".join(summary_parts).strip()
        if not summary:
            raise RuntimeError("Claude returned an empty conversation summary")
        if len(summary) > _COMPACT_SUMMARY_LIMIT:
            raise RuntimeError("Claude returned a summary too large to compact safely")

        previous_summary = self._compacted_context
        previous_store = self._transcript_store
        self._compacted_context = summary
        self._transcript_store = _InMemoryTranscriptStore()
        try:
            replacement = await self._connect_client(self._config)
        except BaseException:
            self._compacted_context = previous_summary
            self._transcript_store = previous_store
            raise
        await self._replace_client(replacement)
        self._conversation_id = None
        self._context_input = None
        self._context_output = 0
        self._context_window = None
        await self._emit("session.usage", {"context": None})
        await self._refresh_context()
        try:
            await self._refresh_quota(refresh=True)
        except Exception:
            LOG.debug("Claude quota is unavailable after compaction", exc_info=True)

    async def aside(self, question: str) -> AsyncIterator[str]:
        """Answers from an isolated, tool-less fork; the live conversation never sees it."""
        resume = self._conversation_id
        options = replace(self._build_options(self._config, resume=resume),
                          fork_session=resume is not None, tools=[], skills=None, plugins=[], mcp_servers={},
                          setting_sources=[], permission_mode="dontAsk", can_use_tool=None,
                          include_partial_messages=True, max_turns=1)
        client = ClaudeSDKClient(options=options)
        # Owned like any other client, so closing the session also stops a running side question.
        self._clients.add(client)
        fork_id: str | None = None
        try:
            async with asyncio.timeout(_ASIDE_TIMEOUT_SECONDS):
                await client.connect()
                await client.query(_aside_prompt(question))
                streamed = False
                async for message in client.receive_response():
                    session_id = getattr(message, "session_id", None)
                    if isinstance(session_id, str) and session_id != resume:
                        fork_id = session_id
                    if isinstance(message, StreamEvent) and not getattr(message, "parent_tool_use_id", None):
                        raw = message.event if isinstance(message.event, dict) else {}
                        text = (raw.get("delta") or {}).get("text") if raw.get("type") == "content_block_delta" else None
                        if text:
                            streamed = True
                            yield text
                    elif isinstance(message, AssistantMessage) and not streamed:
                        text = "".join(block.text for block in message.content if isinstance(block, TextBlock))
                        if text:
                            yield text
                    elif isinstance(message, ResultMessage) and message.is_error:
                        raise RuntimeError("Claude could not answer the side question")
        finally:
            with suppress(Exception):
                await client.disconnect()
            self._clients.discard(client)
            if fork_id is not None:
                await self._transcript_store.forget(fork_id)

    async def close(self) -> None:
        if self._pump is not None:
            self._pump.cancel()
            try:
                await self._pump
            except asyncio.CancelledError:
                pass
            except Exception:
                LOG.debug("The Claude message pump ended with an error", exc_info=True)
            self._pump = None
        await self._deny_pending("The session was closed")
        for client in tuple(self._clients):
            # Propagate failure: the session must retain its workspace if a
            # provider process may still be using it. A later close can retry.
            await client.disconnect()
            self._clients.discard(client)
        self._client = None
        if self._config_dir is not None:
            cleanup = asyncio.create_task(asyncio.to_thread(shutil.rmtree, self._config_dir))
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                await cleanup
                self._config_dir = None
                raise
            self._config_dir = None
        self._transcript_store = _InMemoryTranscriptStore()

    def trace_sources(self) -> Sequence[TraceSource]:
        """The CLI writes its session logs (and sub-agent logs) under the private config dir."""
        return [TraceSource("claude", self._config_dir / "projects")] if self._config_dir else []

    async def recover(self) -> None:
        """Reconnects resuming the SDK conversation from this runtime's transcript store. Serialized:
        the failed pump and a failed delivery may both try at once."""
        async with self._recovery_lock:
            if self._config_dir is None:
                await self.start()
                return
            await self._deny_pending(_INTERRUPTED_MESSAGE)
            replacement = await self._connect_client(self._config, resume=self._conversation_id)
            if self._client is None:
                self._client = replacement
                self._pump = asyncio.create_task(self._pump_messages(replacement))
            else:
                await self._replace_client(replacement)
            self._turn_active = False
            self._interrupted = False
            self._reset_stream_state()

    async def _recover_stream(self, error: Exception) -> None:
        """A broken stream loses only its running turn: reconnect with backoff, resuming the
        conversation, and fail the session only when every attempt does. Runs on the failed pump."""
        LOG.error("The Claude message stream failed", exc_info=error)
        turn_active = self._turn_active
        await self._deny_pending(_INTERRUPTED_MESSAGE)
        await self._publish(agent_error(_stream_failure_message(error)))
        attempts = get_settings().agent_recovery_attempts
        for attempt in range(attempts):
            if attempt:
                await asyncio.sleep(2 ** attempt)
            try:
                await self.recover()
            except asyncio.CancelledError:
                raise
            except Exception:
                LOG.warning("Claude reconnection attempt %s/%s failed", attempt + 1, attempts, exc_info=True)
                continue
            LOG.info("Claude stream recovered after %s attempt(s)", attempt + 1)
            await self._emit("agent.activity", {
                "kind": "stream_recovered",
                "description": "Reconnected and restored the conversation. Send a message to continue.",
            })
            if turn_active:
                await self._publish(turn_result("error", subtype="stream_interrupted"))
            return
        await self._publish(session_status(STATUS_FAILED, RECOVERABLE_DETAIL))

    def _reset_stream_state(self) -> None:
        self._stream_ids.clear()
        self._assistant_block_offsets.clear()
        self._stream_message_id = None

    async def _connect_client(self, config: AgentConfig, resume: str | None = None) -> ClaudeSDKClient:
        """Validate the checkout before every connection, including resume."""
        workspace = await asyncio.to_thread(self._validate_workspace)
        if workspace != self._workspace:
            raise RuntimeError("The session workspace changed during the conversation")
        client = ClaudeSDKClient(options=self._build_options(config, resume=resume))
        self._clients.add(client)
        try:
            # No prompt: this keeps the input stream open so `can_use_tool` can fire.
            await asyncio.wait_for(client.connect(), timeout=120)
        except BaseException:
            try:
                await client.disconnect()
                self._clients.discard(client)
            except Exception:
                LOG.warning("The failed Claude client did not disconnect cleanly", exc_info=True)
            raise
        return client

    async def _replace_client(self, replacement: ClaudeSDKClient) -> None:
        previous_client = self._require_client()
        previous_pump = self._pump
        self._client = replacement
        # A recovering pump replaces its own client: it ends by itself once recovery returns.
        if previous_pump is not None and previous_pump is not asyncio.current_task():
            previous_pump.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await previous_pump
        self._pump = asyncio.create_task(self._pump_messages(replacement))
        try:
            await previous_client.disconnect()
            self._clients.discard(previous_client)
        except Exception:
            # Keep ownership so close() retries before the workspace is deleted.
            LOG.warning("The replaced Claude client did not disconnect cleanly", exc_info=True)

    def _require_client(self) -> ClaudeSDKClient:
        if self._client is None:
            raise ApiException.conflict("The agent runtime is not running")
        return self._client

    def _credential_env(self) -> dict[str, str]:
        """Every Claude mode carries an OAuth access token (sign-in or setup-token), so there is no
        branch on `mode` here: renewal belongs to the platform. Never log the returned dict."""
        return {"CLAUDE_CODE_OAUTH_TOKEN": self._credential.token}

    def _validate_workspace(self) -> Path:
        return _validate_agent_workspace(self._workspace, self._branch)

    def _build_options(self, config: AgentConfig, resume: str | None = None) -> ClaudeAgentOptions:
        settings = get_settings()
        if self._config_dir is None:
            raise RuntimeError("The Claude runtime state directory was not prepared")
        # Only a root native plugin is explicitly loaded. Other plugins and
        # MCP servers follow the CLI's project/local settings and approvals.
        plugins = ([{"type": "local", "path": str(self._workspace)}]
                   if (self._workspace / ".claude-plugin" / "plugin.json").is_file() else [])
        system_append = (
            _CLAUDE_CONDUCT + "\n\n"
            "The session shows the user every image a tool returns. To deliver an image "
            "(created, rendered, converted or captured), save it as a PNG, JPEG, WebP or GIF "
            "file and open it with the Read tool."
        )
        if self._instructions:
            system_append += "\n\n" + self._instructions
        if self._compacted_context:
            system_append += "\n\nContext retained from the conversation before compaction:\n" + self._compacted_context
        rtk = shutil.which("rtk") if settings.agent_claude_rtk else None
        hooks = {"PreToolUse": [HookMatcher(matcher="Bash", hooks=[_shell_compressor(rtk)])]} if rtk else None
        return ClaudeAgentOptions(
            cwd=str(self._workspace),
            env={
                **self._environment,
                **self._credential_env(),
                "CLAUDE_CONFIG_DIR": str(self._config_dir),
                # Prevent inherited alternative auth from overriding this session's PAT.
                "ANTHROPIC_API_KEY": "",
                "ANTHROPIC_AUTH_TOKEN": "",
                "CLAUDE_CODE_USE_BEDROCK": "0",
                "CLAUDE_CODE_USE_VERTEX": "0",
                "CLAUDE_CODE_USE_FOUNDRY": "0",
            },
            # Full access: every tool is approved in the callback without creating a pending
            # request, and no project setting can re-enable the bash sandbox. Only the agent's
            # own questions reach the player.
            permission_mode="default",
            can_use_tool=self._can_use_tool,
            hooks=hooks,
            sandbox={"enabled": False},
            include_partial_messages=True,
            max_buffer_size=settings.agent_claude_max_message_bytes,
            # Native project discovery; cwd and these settings are not a host
            # filesystem boundary. Hooks and tools run as the service user.
            setting_sources=["project", "local"],
            skills="all",
            plugins=plugins,
            mcp_servers={"playwright": playwright_server()},
            system_prompt={
                "type": "preset",
                "preset": "claude_code",
                "append": system_append,
            },
            disallowed_tools=settings.agent_claude_disallowed_tools,
            model=config.model,
            effort=config.effort,
            resume=resume,
            session_store=self._transcript_store,
            session_store_flush="eager",
            stderr=self._on_stderr,
        )

    def _on_stderr(self, line: str) -> None:
        LOG.debug("Claude CLI emitted diagnostic output (%s characters)", len(line))

    async def _deny_pending(self, message: str) -> None:
        for request_id, pending in list(self._pending.items()):
            if not pending.future.done():
                pending.future.set_result({"decision": "deny", "message": message})
                await self._emit(f"{pending.kind}.resolved", {
                    "requestId": request_id, "decision": "deny", "message": message,
                })
            self._pending.pop(request_id, None)

    async def _can_use_tool(
        self, tool_name: str, input_data: dict[str, Any], context: ToolPermissionContext
    ) -> PermissionResult:
        """Only user decisions pause the session; tool execution is automatic."""
        if tool_name != _QUESTION_TOOL:
            return PermissionResultAllow(updated_input=input_data)

        request_id = uuid4().hex
        questions = list(input_data.get("questions") or [])
        request = QuestionRequest(request_id, questions)
        event = question_request(request_id, questions)
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = _PendingRequest(_KIND_QUESTION, future)
        # A delegated agent asking the player waits on them, and says so on its delegation.
        delegation = self._task_tools.get(getattr(context, "agent_id", None) or "")
        try:
            if delegation:
                await self._publish(subagent_updated(delegation, status="waiting"))
            await self._publish(event)
            await self._ask(request)
            payload = await future
        except asyncio.CancelledError:
            raise
        except Exception as error:
            LOG.error("The %s request %s could not be answered", tool_name, request_id, exc_info=error)
            return PermissionResultDeny(message=_DENIED_MESSAGE)
        finally:
            self._pending.pop(request_id, None)
            if delegation:
                await self._publish(subagent_updated(delegation, status="working"))
        return self._decide(payload, input_data, True)

    def _decide(self, payload: dict[str, Any], input_data: dict[str, Any], is_question: bool) -> PermissionResult:
        """Turns the camelCase wire payload into the vendor's result type."""
        if payload.get("decision") == "deny":
            return PermissionResultDeny(message=payload.get("message") or _DENIED_MESSAGE)
        if is_question:
            updated: dict[str, Any] = {
                "questions": input_data.get("questions", []),
                "answers": {key: ", ".join(value) if isinstance(value, list) else value
                            for key, value in (payload.get("answers") or {}).items()},
            }
            response = payload.get("response")
            if response:
                updated["response"] = response
            return PermissionResultAllow(updated_input=updated)
        # Honouring `updatedInput` is the `editableToolInput` capability: the player may edit the
        # tool input before allowing it, and an adapter without that capability ignores the field.
        return PermissionResultAllow(updated_input=payload["updatedInput"] if payload.get("updatedInput") is not None else input_data)

    async def resolve(self, request_id: str, payload: dict[str, Any]) -> None:
        """Answers one parked request. Unknown or already answered ids are indistinguishable on
        purpose — both mean there is nothing left to answer."""
        pending = self._pending.get(request_id)
        if pending is None or pending.future.done():
            raise ApiException.not_found("Unknown or already answered request")
        pending.future.set_result(payload)
        if pending.kind == _KIND_QUESTION:
            await self._publish(question_resolved(request_id, payload.get("answers") or {}))
        else:
            await self._publish(permission_resolved(request_id, payload.get("decision") or "allow"))

    async def _publish(self, event: AgentEvent) -> None:
        await self._emit(event["type"], event["data"])

    async def _pump_messages(self, client: ClaudeSDKClient) -> None:
        """Translates the vendor message stream into domain events until the client stops."""
        try:
            async for message in client.receive_messages():
                await self._translate(message)
            raise RuntimeError("The agent stream ended unexpectedly")
        except asyncio.CancelledError:
            raise
        except Exception as error:
            # A configuration replacement first connects its successor, then
            # cancels this old pump. Never let an obsolete client fail a ready
            # session after the successor has taken over.
            if client is self._client:
                await self._recover_stream(error)

    async def _translate(self, message: Any) -> None:
        session_id = getattr(message, "session_id", None)
        if isinstance(session_id, str):
            try:
                self._conversation_id = str(UUID(session_id))
            except ValueError:
                pass
        if self._awaiting_first_event_at is not None:
            LOG.info(
                "Claude first event received in %.0f ms",
                (time.perf_counter() - self._awaiting_first_event_at) * 1000,
            )
            self._awaiting_first_event_at = None
        if isinstance(message, StreamEvent):
            await self._on_stream_event(message)
        elif isinstance(message, AssistantMessage):
            await self._on_assistant_message(message)
        elif isinstance(message, UserMessage):
            await self._on_user_message(message)
        elif isinstance(message, ResultMessage):
            await self._on_result_message(message)
        elif isinstance(message, RateLimitEvent):
            info = message.rate_limit_info
            self._quota_reported_at = time.time()
            from mic_sessions.shared import claude_usage
            await claude_usage.remember(self._credential.connection_id, self._credential.token,
                                  info.rate_limit_type, {
                # A rejected window is exhausted even when the CLI omits its utilization.
                "percent": info.utilization * 100 if info.utilization is not None
                else 100 if info.status == "rejected" else None,
                "window": info.rate_limit_type, "resetsAt": info.resets_at,
                "status": info.status, "updatedAt": self._quota_reported_at,
            })
            # The CLI tracks every plan window from the anthropic-ratelimit-unified-*
            # headers on each response; utilization is a fraction that may exceed 1.
            windows = info.raw.get("unifiedWindows")
            for name in ("five_hour", "seven_day"):
                window = windows.get(name) if isinstance(windows, dict) else None
                utilization = window.get("utilization") if isinstance(window, dict) else None
                if (isinstance(utilization, (int, float)) and not isinstance(utilization, bool)
                        and math.isfinite(utilization)):
                    await claude_usage.remember(self._credential.connection_id, self._credential.token, name, {
                        "percent": max(0, min(100, utilization * 100)), "window": name,
                        "resetsAt": window.get("resetsAt"), "updatedAt": self._quota_reported_at,
                    })
            await self._refresh_quota()

        elif isinstance(message, SystemMessage) and message.subtype in _TASK_SUBTYPES:
            await self._on_task_message(message.subtype, message.data)
        elif isinstance(message, SystemMessage):
            # Whitelist useful user-facing metadata; never publish the raw initialization payload.
            data = {key: message.data[key] for key in
                    ("description", "summary", "status", "task_id", "tool_use_id") if key in message.data}
            await self._emit("agent.activity", {"kind": message.subtype, **data})
        elif isinstance(message, ConversationResetMessage):
            self._context_input = None
            self._context_output = 0
            await self._emit("session.usage", {"context": None})
            self._conversation_id = None
            self._task_tools.clear()
            self._stream_ids.clear()
            self._assistant_block_offsets.clear()
            self._stream_message_id = None
            await self._emit("agent.activity", {
                "kind": "conversation_reset", "description": "The provider cleared its conversation context.",
            })

    async def _on_task_message(self, subtype: str, data: Mapping[str, Any]) -> None:
        event = _claude_task_update(self._task_tools, subtype, data)
        if event is not None:
            await self._publish(event)

    async def _on_stream_event(self, message: Any) -> None:
        """Partial-message deltas. The SDK carries the raw Anthropic event in `event`; older
        releases exposed it as `event_type` + `data`, so both shapes are read."""
        raw = getattr(message, "event", None)
        if not isinstance(raw, dict):
            raw = getattr(message, "data", None) or {}
        event_type = raw.get("type") or getattr(message, "event_type", None)
        parent = getattr(message, "parent_tool_use_id", None) or "root"
        self._stream_message_id = self._stream_ids.get(parent)
        if parent == "root" and event_type == "message_start":
            info = raw.get("message") or {}
            tokens = info.get("usage") or {}
            self._context_model = info.get("model")
            self._context_input = sum(tokens.get(key, 0) or 0 for key in
                                      ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")) if tokens else None
            self._context_output = tokens.get("output_tokens", 0) or 0
            await self._emit_context_usage()
        if parent == "root" and event_type == "message_delta":
            self._context_output = (raw.get("usage") or {}).get("output_tokens", self._context_output)
            await self._emit_context_usage()
        if event_type == "message_start":
            self._stream_message_id = ((raw.get("message") or {}).get("id")) or uuid4().hex
            self._stream_ids[parent] = self._stream_message_id
            self._assistant_block_offsets[(parent, self._stream_message_id)] = 0
            return
        if event_type == "message_stop":
            return
        if event_type != "content_block_delta":
            return
        delta = raw.get("delta") or {}
        stream_id = self._current_stream_message_id()
        self._stream_ids[parent] = stream_id
        message_id = f"{stream_id}:{raw.get('index', 0)}"
        if delta.get("text"):
            await self._publish(_with_parent(assistant_delta(message_id, delta["text"]), parent))
        elif delta.get("thinking"):
            await self._publish(_with_parent(thinking_delta(message_id, delta["thinking"]), parent))

    def _current_stream_message_id(self) -> str:
        if self._stream_message_id is None:
            self._stream_message_id = uuid4().hex
        return self._stream_message_id

    async def _emit_context_usage(self) -> None:
        if self._context_input is None:
            return
        used = self._context_input + self._context_output
        window = self._context_window
        await self._emit("session.usage", {"context": {
            "percent": used / window * 100 if window else None,
            "usedTokens": used, "limitTokens": window, "updatedAt": time.time(),
        }})

    async def _on_assistant_message(self, message: Any) -> None:
        parent = getattr(message, "parent_tool_use_id", None) or "root"
        # The streamed and authoritative messages can carry different vendor IDs. Reuse the
        # stream ID so the final block replaces its provisional deltas in the transcript.
        message_id = self._stream_ids.get(parent) or getattr(message, "message_id", None) or uuid4().hex
        block_key = (parent, message_id)
        # The SDK can deliver each block of one message as a separate AssistantMessage.
        # Keep its original stream index across those slices.
        first_index = self._assistant_block_offsets.get(block_key, 0)
        # Synthetic messages (provider errors, interruptions) carry zeroed usage: never let them
        # overwrite the context measured by the last real model response.
        tokens = message.usage if parent == "root" and not message.error else None
        input_tokens = sum(tokens.get(key, 0) or 0 for key in
                           ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")) if tokens else 0
        if tokens and getattr(message, "model", None) != "<synthetic>" and input_tokens > 0:
            self._context_input = input_tokens
            self._context_output = tokens.get("output_tokens", self._context_output) or 0
            await self._emit_context_usage()
        for index, block in enumerate(message.content, start=first_index):
            block_id = f"{message_id}:{index}"
            if isinstance(block, TextBlock):
                # Claude emits this sentinel when filtering a contentless assistant message.
                # Publish an empty authoritative block so clients also clear provisional deltas.
                text = "" if block.text.strip() in {"[No message content]", "<no message>"} else block.text
                await self._publish(_with_parent(assistant_message(block_id, text), parent))
            elif isinstance(block, ThinkingBlock):
                await self._publish(_with_parent(thinking_message(block_id, block.thinking), parent))
            elif isinstance(block, ToolUseBlock):
                await self._publish(_with_parent(
                    tool_use(block.id, block.name, _tool_title(block.name, block.input), block.input), parent))
            elif isinstance(block, ServerToolUseBlock):
                name = {"web_search": "WebSearch", "web_fetch": "WebFetch"}.get(block.name, block.name)
                await self._publish(_with_parent(tool_use(block.id, name, _tool_title(name, block.input), block.input), parent))
            elif isinstance(block, ServerToolResultBlock):
                await self._publish(_with_parent(
                    tool_result(block.tool_use_id, False, _result_summary(block.content)), parent))
        self._assistant_block_offsets[block_key] = first_index + len(message.content)
        self._stream_message_id = None
        if message.error:
            await self._publish(agent_error(f"Provider error: {message.error}"))

    async def _on_user_message(self, message: Any) -> None:
        content = message.content
        if not isinstance(content, list):
            return
        parent = getattr(message, "parent_tool_use_id", None)
        for block in content:
            if isinstance(block, ToolResultBlock):
                images = await self._result_images(block.content)
                await self._publish(_with_parent(
                    tool_result(block.tool_use_id, bool(block.is_error), _result_summary(block.content), images), parent))

    async def _result_images(self, content: Any) -> list[Image]:
        """Images a tool returned (a read image file, an MCP screenshot) are kept for the player;
        their base64 never reaches the event log."""
        sources = [block["source"] for block in content if isinstance(block, dict) and block.get("type") == "image"
                   and isinstance(block.get("source"), dict) and block["source"].get("type") == "base64"
                   and isinstance(block["source"].get("data"), str)] if isinstance(content, list) else []
        if not sources:
            return []
        stored = await asyncio.to_thread(lambda: [
            session_images.save_encoded(self._workspace, source["data"]) for source in sources])
        return [image for image in stored if image is not None]

    async def _on_result_message(self, message: Any) -> None:
        """Only `terminalReason` is required by the contract; every other field is best effort, so
        it is read defensively — the vendor adds and removes them across releases."""
        await self._refresh_quota()
        models = getattr(message, "model_usage", None) or {}
        model_usage = models.get(self._context_model, {})
        window = model_usage.get("contextWindow")
        if isinstance(window, int) and window > 0:
            self._context_window = window
        await self._emit_context_usage()
        await self._deny_pending("The turn ended")
        self._turn_active = False
        self._reset_stream_state()
        # A stopped turn ends as an error with internal diagnostics only; the footer reports it.
        errors = [error for error in getattr(message, "errors", None) or []
                  if not str(error).startswith("[ede_diagnostic]")]
        if message.is_error and errors and not self._interrupted:
            await self._publish(agent_error(_result_summary("\n".join(errors))))
        await self._publish(
            turn_result(
                terminal_reason="interrupted" if self._interrupted else "error" if message.is_error else "completed",
                subtype=getattr(message, "subtype", None),
                duration_ms=getattr(message, "duration_ms", None),
                cost_usd=getattr(message, "total_cost_usd", None),
                usage=getattr(message, "usage", None),
            )
        )


def _stream_failure_message(error: Exception) -> str:
    if isinstance(error, CLIJSONDecodeError):
        cause = "an agent message exceeded the size limit"
    elif isinstance(error, ProcessError):
        cause = "the agent process exited"
    else:
        cause = "the agent stream broke"
    return f"{_INTERRUPTED_MESSAGE} ({cause}). Restoring the conversation; the workspace and its changes are kept."


class ClaudeCliAgentRuntime:
    """Adapter for Claude Code through its own CLI (`claude --print`, stream-json), without the SDK.

    Same contract and capabilities as `ClaudeAgentRuntime`, implemented with the CLI's native
    features: the conversation id is chosen up front (`--session-id`) and the CLI persists the
    transcript in this runtime's private config directory, so reconnecting and changing the effort
    simply `--resume` it; compaction is the CLI's own `/compact`; tool approvals and the RTK hook
    travel over its stdio control protocol. One process per session, bound to one player token.
    """

    # Side questions need an isolated, tool-less fork of the conversation, which only the SDK adapter implements.
    capabilities: ClassVar[AgentCapabilities] = replace(CLAUDE_CAPABILITIES, asides=False)
    _catalog: ClassVar[ContextVar[dict[str, Any] | None]] = ContextVar('claude_cli_catalog', default=None)
    _catalogs: ClassVar[dict[str, tuple[float, dict[str, Any]]]] = {}

    @classmethod
    async def load_configuration(cls, credential: Credential, refresh: bool = False) -> None:
        """The model catalog is the `initialize` answer of a throwaway CLI process."""
        cached = cls._catalogs.get(credential.connection_id or '')
        if not refresh and cached and cached[0] > time.monotonic():
            cls._catalog.set(cached[1])
            return
        settings = get_settings()
        with tempfile.TemporaryDirectory(prefix="mooi-claude-cli-models-") as config_dir:
            try:
                cli = claude_cli.ClaudeCli(
                    [claude_cli.executable(settings.agent_claude_cli), *_CLAUDE_CLI_STREAM, "--setting-sources="],
                    cwd=Path(config_dir), env=claude_cli.environment(_claude_cli_credential_env(credential, config_dir)),
                )
                info = await cli.start(timeout=30)
            except Exception:
                LOG.exception("Could not load Claude CLI models")
                raise ApiException(502, "Could not load Claude models. Check your connection and try again.") from None
            finally:
                with suppress(Exception):
                    await cli.close()

        models = []
        for entry in info.get("models") or []:
            model_id = entry.get("value")
            if not isinstance(model_id, str) or not model_id or model_id.lower() == "default":
                continue
            efforts = entry.get("supportedEffortLevels") or []
            models.append({"id": model_id, "label": _claude_model_label(entry, model_id),
                           "contextWindow": entry.get("contextWindow"),
                           "efforts": efforts if isinstance(efforts, list) else [], "images": True})
        if not models:
            raise ApiException(502, "Claude returned no available models. Check your connection and try again.")
        preferred = settings.agent_claude_model
        default = next((item for item in models if item["id"] == preferred), models[0])
        catalog = {"id": "claude", "label": "Claude", "models": models,
                   "defaultModel": default["id"], "defaultEffort": settings.agent_claude_effort}
        if credential.connection_id:
            for key, (expires, _) in list(cls._catalogs.items()):
                if expires < time.monotonic():
                    cls._catalogs.pop(key, None)
            if len(cls._catalogs) >= 1024:
                cls._catalogs.pop(next(iter(cls._catalogs)))
            cls._catalogs[credential.connection_id] = (time.monotonic() + 300, catalog)
        cls._catalog.set(catalog)

    @classmethod
    def configuration(cls) -> dict[str, Any]:
        return cls._catalog.get() or {"id": "claude", "label": "Claude", "models": [],
                                      "defaultModel": "", "defaultEffort": None}

    @classmethod
    def configure(cls, model: str | None, effort: str | None) -> AgentConfig:
        catalog = cls.configuration()
        chosen = model or catalog["defaultModel"]
        candidate = next((item for item in catalog["models"] if item["id"] == chosen), None)
        if candidate is None:
            raise ApiException.bad_request("Unsupported model")
        supported = candidate["efforts"]
        default = catalog["defaultEffort"]
        chosen_effort = effort if effort is not None else (
            default if default in supported else supported[0] if supported else None)
        if chosen_effort is not None and chosen_effort not in supported:
            raise ApiException.bad_request("Unsupported effort for this model")
        return AgentConfig(chosen, chosen_effort)

    def __init__(
        self,
        credential: Credential,
        workspace: Path,
        branch: str,
        emit: Emit,
        ask: Ask,
        config: AgentConfig,
        *,
        instructions: str = "",
        environment: Mapping[str, str] | None = None,
    ) -> None:
        self._config = config
        self._instructions = instructions
        self._environment = dict(environment or {})
        self._credential = credential
        self._workspace = workspace
        self._branch = branch
        self._emit = emit
        self._ask = ask
        self._cli: claude_cli.ClaudeCli | None = None
        self._clis: set[claude_cli.ClaudeCli] = set()
        self._pump: asyncio.Task[None] | None = None
        self._pending: dict[str, _PendingRequest] = {}
        self._stream_message_id: str | None = None
        self._stream_ids: dict[str, str] = {}
        self._assistant_block_offsets: dict[tuple[str, str], int] = {}
        # Claude task id -> the tool call that delegated it; later task updates omit the call.
        self._task_tools: dict[str, str] = {}
        self._context_input: int | None = None
        self._context_output = 0
        self._context_model: str | None = None
        self._context_window: int | None = None
        self._last_quota = None
        self._interrupted = False
        self._turn_active = False
        self._awaiting_first_event_at: float | None = None
        self._config_dir: Path | None = None
        self._recovery_lock = asyncio.Lock()
        # The CLI's own conversation id; it holds a saved transcript once a turn has ended.
        self._conversation_id = str(uuid4())
        self._conversation_saved = False
        self._compaction: asyncio.Future[None] | None = None
        self._compaction_error: str | None = None

    async def start(self) -> None:
        started_at = time.perf_counter()
        self._workspace = await asyncio.to_thread(self._validate_workspace)
        # Outside the checkout, inside the owned session directory: the CLI keeps its transcripts
        # here, and workspace reconciliation removes it after an unclean service exit.
        self._config_dir = Path(tempfile.mkdtemp(prefix="claude-cli-", dir=self._workspace.parent))
        self._cli = await self._connect(self._config)
        self._pump = asyncio.create_task(self._pump_messages(self._cli))
        await asyncio.gather(self._refresh_context(), self._refresh_quota())
        LOG.info("Claude CLI runtime connected in %.0f ms", (time.perf_counter() - started_at) * 1000)

    async def _refresh_context(self) -> None:
        from mic_sessions.shared import claude_usage
        context = await claude_usage.context(self._require_cli())
        if context is not None:
            self._context_window = context["limitTokens"]
            await self._emit("session.usage", {"context": context})

    async def _refresh_quota(self, *, refresh: bool = False) -> None:
        from mic_sessions.shared import claude_usage
        quota = await claude_usage.quota(self._credential.connection_id, self._credential.token, refresh=refresh)
        if quota != self._last_quota:
            self._last_quota = quota
            await self._emit("session.usage", {"quota": quota})

    async def refresh_usage(self) -> None:
        await self._refresh_quota()

    async def send(self, text: str, images: Sequence[Image] = ()) -> None:
        self._interrupted = False
        started_at = time.perf_counter()
        cli = self._require_cli()
        self._turn_active = True
        content: str | list[dict[str, Any]] = text
        if images:
            # Images precede the text, as the Messages API recommends for multimodal prompts.
            content = await asyncio.to_thread(lambda: [
                {"type": "image", "source": {"type": "base64", "media_type": image.media_type,
                                             "data": image.base64()}} for image in images])
            if text:
                content.append({"type": "text", "text": text})
        try:
            await cli.send_user(content, self._conversation_id)
        except BaseException:
            self._turn_active = False
            raise
        self._awaiting_first_event_at = time.perf_counter()
        LOG.info("Claude CLI turn submitted in %.0f ms", (time.perf_counter() - started_at) * 1000)

    async def refresh_credential(self, credential: Credential) -> None:
        """The platform renews a Claude sign-in token before it expires; a running CLI keeps the token
        it was launched with, so a renewed one relaunches it, resuming its saved conversation."""
        if credential.connection_id != self._credential.connection_id:
            raise ApiException.conflict("The Claude account changed. Create a new session.")
        if credential.token == self._credential.token or self._turn_active:
            # Mid-turn the current token still has the renewal margin left; the next message swaps it.
            return
        previous, self._credential = self._credential, credential
        if self._cli is None:
            return
        try:
            replacement = await self._connect(self._config)
        except BaseException:
            self._credential = previous
            raise
        await self._replace(replacement)

    async def set_configuration(self, config: AgentConfig) -> AgentConfig:
        """A model change is applied live (`set_model`); an effort is a launch flag, so the CLI is
        relaunched resuming its saved conversation and replaces the running one only once up."""
        if config == self._config:
            return self._config
        if config.effort == self._config.effort:
            await self._require_cli().request({"subtype": "set_model", "model": config.model})
        else:
            await self._replace(await self._connect(config))
        self._config = config
        await self._refresh_context()
        return self._config

    async def interrupt(self) -> None:
        self._interrupted = True
        await self._deny_pending("The turn was interrupted")
        await self._require_cli().request({"subtype": "interrupt"})

    async def compact(self, instructions: str | None = None) -> None:
        """The CLI's native `/compact`: it summarizes the conversation and continues in place.
        Its messages are consumed here and never reach the transcript as a turn."""
        if not self._conversation_saved:
            raise ApiException.conflict("There is no conversation to compact yet")
        cli = self._require_cli()
        self._compaction = asyncio.get_running_loop().create_future()
        self._compaction_error = None
        try:
            command = "/compact" + (" " + " ".join(instructions.split()) if instructions else "")
            await cli.send_user(command, self._conversation_id)
            async with asyncio.timeout(600):
                await self._compaction
        finally:
            self._compaction = None
        self._reset_stream_state()
        self._context_input = None
        self._context_output = 0
        await self._emit("session.usage", {"context": None})
        await self._refresh_context()
        try:
            await self._refresh_quota(refresh=True)
        except Exception:
            LOG.debug("Claude quota is unavailable after compaction", exc_info=True)

    async def close(self) -> None:
        if self._pump is not None:
            self._pump.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await self._pump
            self._pump = None
        await self._deny_pending("The session was closed")
        self._fail_compaction("The session was closed")
        for cli in tuple(self._clis):
            # close() always ends the process (the group is killed last), so the workspace is free.
            await cli.close()
            self._clis.discard(cli)
        self._cli = None
        if self._config_dir is not None:
            cleanup = asyncio.create_task(asyncio.to_thread(shutil.rmtree, self._config_dir, True))
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                await cleanup
                self._config_dir = None
                raise
            self._config_dir = None

    def trace_sources(self) -> Sequence[TraceSource]:
        """The CLI writes its session logs (and sub-agent logs) under the private config dir."""
        return [TraceSource("claude", self._config_dir / "projects")] if self._config_dir else []

    async def recover(self) -> None:
        """Relaunches the CLI resuming its saved conversation. Serialized: the failed pump and a
        failed delivery may both try at once."""
        async with self._recovery_lock:
            if self._config_dir is None:
                await self.start()
                return
            await self._deny_pending(_INTERRUPTED_MESSAGE)
            replacement = await self._connect(self._config)
            if self._cli is None:
                self._cli = replacement
                self._pump = asyncio.create_task(self._pump_messages(replacement))
            else:
                await self._replace(replacement)
            self._turn_active = False
            self._interrupted = False
            self._reset_stream_state()

    async def _recover_stream(self, error: Exception) -> None:
        """A broken process loses only its running turn: relaunch with backoff, resuming the
        conversation, and fail the session only when every attempt does. Runs on the failed pump."""
        LOG.error("The Claude CLI message stream failed", exc_info=error)
        turn_active = self._turn_active
        await self._deny_pending(_INTERRUPTED_MESSAGE)
        self._fail_compaction(_INTERRUPTED_MESSAGE)
        cause = error.cause if isinstance(error, claude_cli.ClaudeCliError) else "the agent stream broke"
        await self._publish(agent_error(
            f"{_INTERRUPTED_MESSAGE} ({cause}). Restoring the conversation; the workspace and its changes are kept."))
        attempts = get_settings().agent_recovery_attempts
        for attempt in range(attempts):
            if attempt:
                await asyncio.sleep(2 ** attempt)
            try:
                await self.recover()
            except asyncio.CancelledError:
                raise
            except Exception:
                LOG.warning("Claude CLI relaunch attempt %s/%s failed", attempt + 1, attempts, exc_info=True)
                continue
            LOG.info("Claude CLI stream recovered after %s attempt(s)", attempt + 1)
            await self._emit("agent.activity", {
                "kind": "stream_recovered",
                "description": "Reconnected and restored the conversation. Send a message to continue.",
            })
            if turn_active:
                await self._publish(turn_result("error", subtype="stream_interrupted"))
            return
        await self._publish(session_status(STATUS_FAILED, RECOVERABLE_DETAIL))

    def _reset_stream_state(self) -> None:
        self._stream_ids.clear()
        self._assistant_block_offsets.clear()
        self._stream_message_id = None

    def _fail_compaction(self, message: str) -> None:
        if self._compaction is not None and not self._compaction.done():
            self._compaction.set_exception(RuntimeError(message))

    async def _connect(self, config: AgentConfig) -> claude_cli.ClaudeCli:
        """Validate the checkout before every launch; a saved conversation is resumed, otherwise a
        fresh id starts one (an unsaved id may already name a half-written transcript)."""
        workspace = await asyncio.to_thread(self._validate_workspace)
        if workspace != self._workspace:
            raise RuntimeError("The session workspace changed during the conversation")
        if not self._conversation_saved:
            self._conversation_id = str(uuid4())
        settings = get_settings()
        rtk = shutil.which("rtk") if settings.agent_claude_rtk else None
        cli = claude_cli.ClaudeCli(
            self._arguments(config), cwd=self._workspace, env=claude_cli.environment(self._process_env()),
            handler=self._control_handler(_shell_compressor(rtk) if rtk else None),
            max_message_bytes=settings.agent_claude_max_message_bytes,
        )
        self._clis.add(cli)
        hooks = {"PreToolUse": [{"matcher": "Bash", "hookCallbackIds": [_RTK_HOOK_ID]}]} if rtk else None
        try:
            await cli.start(hooks=hooks)
        except BaseException:
            self._clis.discard(cli)
            raise
        return cli

    async def _replace(self, replacement: claude_cli.ClaudeCli) -> None:
        previous = self._require_cli()
        previous_pump = self._pump
        self._cli = replacement
        # A recovering pump replaces its own process: it ends by itself once recovery returns.
        if previous_pump is not None and previous_pump is not asyncio.current_task():
            previous_pump.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await previous_pump
        self._pump = asyncio.create_task(self._pump_messages(replacement))
        await previous.close()
        self._clis.discard(previous)

    def _require_cli(self) -> claude_cli.ClaudeCli:
        if self._cli is None:
            raise ApiException.conflict("The agent runtime is not running")
        return self._cli

    def _validate_workspace(self) -> Path:
        return _validate_agent_workspace(self._workspace, self._branch)

    def _process_env(self) -> dict[str, str]:
        if self._config_dir is None:
            raise RuntimeError("The Claude runtime state directory was not prepared")
        # RTK's hook runs over the protocol, not from settings: keep its "no hook" notice out of tool output.
        return {**self._environment, "RTK_SUPPRESS_HOOK_WARNING": "1",
                **_claude_cli_credential_env(self._credential, str(self._config_dir))}

    def _arguments(self, config: AgentConfig) -> list[str]:
        settings = get_settings()
        system_append = (
            _CLAUDE_CONDUCT + "\n\n"
            "The session shows the user every image a tool returns. To deliver an image "
            "(created, rendered, converted or captured), save it as a PNG, JPEG, WebP or GIF "
            "file and open it with the Read tool."
        )
        if self._instructions:
            system_append += "\n\n" + self._instructions
        arguments = [
            claude_cli.executable(settings.agent_claude_cli), *_CLAUDE_CLI_STREAM,
            "--include-partial-messages",
            # Full access: every tool is approved over stdio without a pending request, and no
            # project setting can re-enable the bash sandbox. Only the agent's questions reach the player.
            "--permission-mode", "default", "--permission-prompt-tool", "stdio",
            "--settings", json.dumps({"sandbox": {"enabled": False}}),
            # Native project discovery; cwd and these settings are not a host filesystem boundary.
            "--setting-sources=project,local",
            "--mcp-config", json.dumps({"mcpServers": {"playwright": playwright_server()}}),
            "--append-system-prompt", system_append,
            f"--model={config.model}",
            # `=` binds each value to its flag, so no value can be read as another flag.
            f"--resume={self._conversation_id}" if self._conversation_saved else f"--session-id={self._conversation_id}",
        ]
        if config.effort:
            arguments.append(f"--effort={config.effort}")
        if settings.agent_claude_disallowed_tools:
            arguments.append("--disallowedTools=" + ",".join(settings.agent_claude_disallowed_tools))
        # Only a root native plugin is explicitly loaded; others follow the project settings.
        if (self._workspace / ".claude-plugin" / "plugin.json").is_file():
            arguments.append(f"--plugin-dir={self._workspace}")
        return arguments

    def _control_handler(self, compress: HookCallback | None) -> claude_cli.ControlHandler:
        async def handle(request: dict[str, Any]) -> dict[str, Any]:
            subtype = request.get("subtype")
            if subtype == "can_use_tool":
                return await self._can_use_tool(str(request.get("tool_name")), request.get("input") or {})
            if subtype == "hook_callback" and request.get("callback_id") == _RTK_HOOK_ID and compress:
                return dict(await compress(request.get("input") or {}, request.get("tool_use_id"), {"signal": None}))
            raise RuntimeError(f"Unsupported Claude CLI request: {subtype}")

        return handle

    async def _deny_pending(self, message: str) -> None:
        for request_id, pending in list(self._pending.items()):
            if not pending.future.done():
                pending.future.set_result({"decision": "deny", "message": message})
                await self._emit(f"{pending.kind}.resolved", {
                    "requestId": request_id, "decision": "deny", "message": message,
                })
            self._pending.pop(request_id, None)

    async def _can_use_tool(self, tool_name: str, input_data: dict[str, Any]) -> dict[str, Any]:
        """Only user decisions pause the session; tool execution is automatic."""
        if tool_name != _QUESTION_TOOL:
            return {"behavior": "allow", "updatedInput": input_data}
        request_id = uuid4().hex
        questions = list(input_data.get("questions") or [])
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = _PendingRequest(_KIND_QUESTION, future)
        try:
            await self._publish(question_request(request_id, questions))
            await self._ask(QuestionRequest(request_id, questions))
            payload = await future
        except asyncio.CancelledError:
            raise
        except Exception as error:
            LOG.error("The %s request %s could not be answered", tool_name, request_id, exc_info=error)
            return {"behavior": "deny", "message": _DENIED_MESSAGE}
        finally:
            self._pending.pop(request_id, None)
        if payload.get("decision") == "deny":
            return {"behavior": "deny", "message": payload.get("message") or _DENIED_MESSAGE}
        updated: dict[str, Any] = {
            "questions": input_data.get("questions", []),
            "answers": {key: ", ".join(value) if isinstance(value, list) else value
                        for key, value in (payload.get("answers") or {}).items()},
        }
        if payload.get("response"):
            updated["response"] = payload["response"]
        return {"behavior": "allow", "updatedInput": updated}

    async def resolve(self, request_id: str, payload: dict[str, Any]) -> None:
        """Answers one parked request. Unknown or already answered ids are indistinguishable on
        purpose — both mean there is nothing left to answer."""
        pending = self._pending.get(request_id)
        if pending is None or pending.future.done():
            raise ApiException.not_found("Unknown or already answered request")
        pending.future.set_result(payload)
        if pending.kind == _KIND_QUESTION:
            await self._publish(question_resolved(request_id, payload.get("answers") or {}))
        else:
            await self._publish(permission_resolved(request_id, payload.get("decision") or "allow"))

    async def _publish(self, event: AgentEvent) -> None:
        await self._emit(event["type"], event["data"])

    async def _pump_messages(self, cli: claude_cli.ClaudeCli) -> None:
        """Translates the CLI's stream-json messages into domain events until the process ends."""
        try:
            async for message in cli.messages():
                await self._translate(message)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            # A replacement first launches its successor, then cancels this old pump. Never let
            # an obsolete process fail a ready session after the successor has taken over.
            if cli is self._cli:
                await self._recover_stream(error)

    async def _translate(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        if self._awaiting_first_event_at is not None:
            LOG.info("Claude CLI first event received in %.0f ms",
                     (time.perf_counter() - self._awaiting_first_event_at) * 1000)
            self._awaiting_first_event_at = None
        if kind == "rate_limit_event":
            await self._on_rate_limit(message.get("rate_limit_info") or {})
        elif self._compaction is not None:
            self._on_compaction_message(message)
        elif kind == "stream_event":
            await self._on_stream_event(message)
        elif kind == "assistant":
            await self._on_assistant_message(message)
        elif kind == "user":
            await self._on_user_message(message)
        elif kind == "result":
            await self._on_result_message(message)
        elif kind == "system" and message.get("subtype") in _TASK_SUBTYPES:
            event = _claude_task_update(self._task_tools, str(message.get("subtype")), message)
            if event is not None:
                await self._publish(event)
        elif kind == "system":
            # Whitelist useful user-facing metadata; never publish the raw initialization payload.
            data = {key: message[key] for key in
                    ("description", "summary", "status", "task_id", "tool_use_id") if key in message}
            await self._emit("agent.activity", {"kind": message.get("subtype"), **data})
        elif kind == "conversation_reset":
            self._context_input = None
            self._context_output = 0
            await self._emit("session.usage", {"context": None})
            self._task_tools.clear()
            self._reset_stream_state()
            await self._emit("agent.activity", {
                "kind": "conversation_reset", "description": "The provider cleared its conversation context.",
            })

    def _on_compaction_message(self, message: dict[str, Any]) -> None:
        """`/compact` reports a failure as a status message and always ends with a result."""
        if message.get("type") == "system" and message.get("compact_result") == "failed":
            self._compaction_error = str(message.get("compact_error") or "Compaction failed")
        elif message.get("type") == "result" and self._compaction is not None and not self._compaction.done():
            if self._compaction_error or message.get("is_error"):
                self._compaction.set_exception(RuntimeError(self._compaction_error or "Compaction failed"))
            else:
                self._compaction.set_result(None)

    async def _on_rate_limit(self, info: dict[str, Any]) -> None:
        from mic_sessions.shared import claude_usage
        reported_at = time.time()
        utilization = info.get("utilization")
        window_type = info.get("rateLimitType")
        await claude_usage.remember(self._credential.connection_id, self._credential.token, window_type, {
            # A rejected window is exhausted even when the CLI omits its utilization.
            "percent": utilization * 100 if isinstance(utilization, (int, float))
            else 100 if info.get("status") == "rejected" else None,
            "window": window_type, "resetsAt": info.get("resetsAt"),
            "status": info.get("status"), "updatedAt": reported_at,
        })
        # Every plan window from the anthropic-ratelimit-unified-* headers; utilization is a fraction.
        windows = info.get("unifiedWindows")
        for name in ("five_hour", "seven_day"):
            window = windows.get(name) if isinstance(windows, dict) else None
            value = window.get("utilization") if isinstance(window, dict) else None
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                await claude_usage.remember(self._credential.connection_id, self._credential.token, name, {
                    "percent": max(0, min(100, value * 100)), "window": name,
                    "resetsAt": window.get("resetsAt"), "updatedAt": reported_at,
                })
        await self._refresh_quota()

    async def _on_stream_event(self, message: dict[str, Any]) -> None:
        raw = message.get("event") or {}
        event_type = raw.get("type")
        parent = message.get("parent_tool_use_id") or "root"
        self._stream_message_id = self._stream_ids.get(parent)
        if parent == "root" and event_type == "message_start":
            info = raw.get("message") or {}
            tokens = info.get("usage") or {}
            self._context_model = info.get("model")
            self._context_input = sum(tokens.get(key, 0) or 0 for key in
                                      ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")) if tokens else None
            self._context_output = tokens.get("output_tokens", 0) or 0
            await self._emit_context_usage()
        if parent == "root" and event_type == "message_delta":
            self._context_output = (raw.get("usage") or {}).get("output_tokens", self._context_output)
            await self._emit_context_usage()
        if event_type == "message_start":
            self._stream_message_id = ((raw.get("message") or {}).get("id")) or uuid4().hex
            self._stream_ids[parent] = self._stream_message_id
            self._assistant_block_offsets[(parent, self._stream_message_id)] = 0
            return
        if event_type != "content_block_delta":
            return
        delta = raw.get("delta") or {}
        if self._stream_message_id is None:
            self._stream_message_id = uuid4().hex
        self._stream_ids[parent] = self._stream_message_id
        message_id = f"{self._stream_message_id}:{raw.get('index', 0)}"
        if delta.get("text"):
            await self._publish(_with_parent(assistant_delta(message_id, delta["text"]), parent))
        elif delta.get("thinking"):
            await self._publish(_with_parent(thinking_delta(message_id, delta["thinking"]), parent))

    async def _emit_context_usage(self) -> None:
        if self._context_input is None:
            return
        used = self._context_input + self._context_output
        window = self._context_window
        await self._emit("session.usage", {"context": {
            "percent": used / window * 100 if window else None,
            "usedTokens": used, "limitTokens": window, "updatedAt": time.time(),
        }})

    async def _on_assistant_message(self, message: dict[str, Any]) -> None:
        body = message.get("message") or {}
        parent = message.get("parent_tool_use_id") or "root"
        error = message.get("error")
        # Reuse the stream id so the final block replaces its provisional deltas in the transcript.
        message_id = self._stream_ids.get(parent) or body.get("id") or uuid4().hex
        block_key = (parent, message_id)
        # The CLI can deliver each block of one message as a separate assistant message.
        first_index = self._assistant_block_offsets.get(block_key, 0)
        # Synthetic messages (provider errors, interruptions) carry zeroed usage: never let them
        # overwrite the context measured by the last real model response.
        tokens = body.get("usage") if parent == "root" and not error else None
        input_tokens = sum(tokens.get(key, 0) or 0 for key in
                           ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")) if tokens else 0
        if tokens and body.get("model") != "<synthetic>" and input_tokens > 0:
            self._context_input = input_tokens
            self._context_output = tokens.get("output_tokens", self._context_output) or 0
            await self._emit_context_usage()
        content = body.get("content") if isinstance(body.get("content"), list) else []
        for index, block in enumerate(content, start=first_index):
            block_id = f"{message_id}:{index}"
            block_type = block.get("type") if isinstance(block, dict) else None
            if block_type == "text":
                # Claude emits this sentinel when filtering a contentless assistant message.
                text = str(block.get("text") or "")
                await self._publish(_with_parent(assistant_message(
                    block_id, "" if text.strip() in {"[No message content]", "<no message>"} else text), parent))
            elif block_type == "thinking":
                await self._publish(_with_parent(thinking_message(block_id, str(block.get("thinking") or "")), parent))
            elif block_type == "tool_use":
                name, input_data = str(block.get("name")), block.get("input") or {}
                await self._publish(_with_parent(
                    tool_use(str(block.get("id")), name, _tool_title(name, input_data), input_data), parent))
            elif block_type == "server_tool_use":
                name = {"web_search": "WebSearch", "web_fetch": "WebFetch"}.get(str(block.get("name")), str(block.get("name")))
                input_data = block.get("input") or {}
                await self._publish(_with_parent(
                    tool_use(str(block.get("id")), name, _tool_title(name, input_data), input_data), parent))
            elif block_type == "advisor_tool_result":
                await self._publish(_with_parent(
                    tool_result(str(block.get("tool_use_id")), False, _result_summary(block.get("content"))), parent))
        self._assistant_block_offsets[block_key] = first_index + len(content)
        self._stream_message_id = None
        if error:
            await self._publish(agent_error(f"Provider error: {error}"))

    async def _on_user_message(self, message: dict[str, Any]) -> None:
        content = (message.get("message") or {}).get("content")
        if not isinstance(content, list):
            return
        parent = message.get("parent_tool_use_id")
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                images = await self._result_images(block.get("content"))
                await self._publish(_with_parent(tool_result(str(block.get("tool_use_id")), bool(block.get("is_error")),
                                                             _result_summary(block.get("content")), images), parent))

    async def _result_images(self, content: Any) -> list[Image]:
        """Images a tool returned are kept for the player; their base64 never reaches the event log."""
        sources = [block["source"] for block in content if isinstance(block, dict) and block.get("type") == "image"
                   and isinstance(block.get("source"), dict) and block["source"].get("type") == "base64"
                   and isinstance(block["source"].get("data"), str)] if isinstance(content, list) else []
        if not sources:
            return []
        stored = await asyncio.to_thread(lambda: [
            session_images.save_encoded(self._workspace, source["data"]) for source in sources])
        return [image for image in stored if image is not None]

    async def _on_result_message(self, message: dict[str, Any]) -> None:
        """Only `terminalReason` is required by the contract; every other field is best effort."""
        self._conversation_saved = True
        await self._refresh_quota()
        model_usage = (message.get("modelUsage") or {}).get(self._context_model) or {}
        window = model_usage.get("contextWindow")
        if isinstance(window, int) and window > 0:
            self._context_window = window
        await self._emit_context_usage()
        await self._deny_pending("The turn ended")
        self._turn_active = False
        self._reset_stream_state()
        is_error = bool(message.get("is_error"))
        # A stopped turn ends as an error with internal diagnostics only; the footer reports it.
        errors = [error for error in message.get("errors") or [] if not str(error).startswith("[ede_diagnostic]")]
        if is_error and errors and not self._interrupted:
            await self._publish(agent_error(_result_summary("\n".join(map(str, errors)))))
        await self._publish(turn_result(
            terminal_reason="interrupted" if self._interrupted else "error" if is_error else "completed",
            subtype=message.get("subtype"),
            duration_ms=message.get("duration_ms"),
            cost_usd=message.get("total_cost_usd"),
            usage=message.get("usage"),
        ))


_CLAUDE_CLI_STREAM = ("--print", "--verbose", "--output-format", "stream-json", "--input-format", "stream-json")
_RTK_HOOK_ID = "mooi_rtk"


def _claude_cli_credential_env(credential: Credential, config_dir: str) -> dict[str, str]:
    """The player's token as the only credential the CLI can use. Never log the returned dict."""
    return {
        "CLAUDE_CODE_OAUTH_TOKEN": credential.token,
        "CLAUDE_CONFIG_DIR": config_dir,
        # Prevent inherited alternative auth from overriding this session's token.
        "ANTHROPIC_API_KEY": "",
        "ANTHROPIC_AUTH_TOKEN": "",
        "CLAUDE_CODE_USE_BEDROCK": "0",
        "CLAUDE_CODE_USE_VERTEX": "0",
        "CLAUDE_CODE_USE_FOUNDRY": "0",
    }


CODEX_CAPABILITIES = AgentCapabilities(streaming=True, thinking=True, questions=True, interrupt=True, images=True,
                                       asides=True)

# Full access, like the Claude adapter: Codex never asks for approvals and runs unsandboxed
# inside the session's own clone. Only the agent's own questions reach the player.
# Codex approves nothing per call (`approvalPolicy: never`), so its file rule is instruction only.
_CODEX_CONDUCT = conduct_instructions(edit_tools="apply_patch")
_CODEX_ACCESS = {"approvalPolicy": "never", "sandbox": "danger-full-access"}
_CODEX_FILE_TOOLS = {"add": "Write", "delete": "Edit", "update": "Edit"}
# Codex collab calls other than `spawnAgent` are the main agent managing its delegates: steps.
_CODEX_COLLAB_TOOLS = {"sendInput": "MessageAgent", "sendMessage": "MessageAgent", "followupTask": "MessageAgent",
                       "resumeAgent": "ResumeAgent", "wait": "WaitAgent", "closeAgent": "CloseAgent",
                       "interruptAgent": "InterruptAgent", "listAgents": "ListAgents"}
# `shutdown` follows any end once the agent is closed and `notFound` says nothing about the work:
# neither may overwrite how the agent finished.
_CODEX_AGENT_STATUSES = {"pendingInit": "started", "running": "working", "completed": "completed",
                         "errored": "failed", "interrupted": "interrupted"}


def _codex_file_steps(item: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    """One `(id, tool, input)` per file of a Codex `fileChange` item, shaped like the Claude file
    tools (`file_path`) so every provider renders an edit as its file name, never as `Edit`."""
    identity = item.get("id") or uuid4().hex
    steps = []
    for index, change in enumerate(item.get("changes") or []):
        path = change.get("path") if isinstance(change, dict) else None
        if not isinstance(path, str) or not path:
            continue
        kind = change.get("kind") if isinstance(change.get("kind"), dict) else {}
        operation = kind.get("type") if kind.get("type") in _CODEX_FILE_TOOLS else "update"
        steps.append((f"{identity}:{index}", _CODEX_FILE_TOOLS[operation],
                      {"file_path": kind.get("move_path") or path, "operation": operation,
                       "diff": change.get("diff") or ""}))
    return steps


class CodexAgentRuntime:
    """Codex conversation adapter; vendor objects never cross the event contract.

    Like the Codex app, one session keeps one `codex app-server` and its loaded thread across turns,
    so a message starts its turn at once. The connection is replaced only when it broke or when another
    connection of the same account rotated the shared credential since it connected. It is per session,
    never per account: the SDK answers a pending question on its single reader thread, which must
    only ever block the conversation that asked.
    """

    capabilities: ClassVar[AgentCapabilities] = CODEX_CAPABILITIES
    _catalog: ClassVar[ContextVar[dict[str, Any] | None]] = ContextVar('codex_catalog', default=None)

    @staticmethod
    def configuration() -> dict[str, Any]:
        return CodexAgentRuntime._catalog.get() or {
            "id": "codex", "label": "Codex", "models": [], "defaultModel": "", "defaultEffort": None}

    @classmethod
    async def load_configuration(cls, credential: Credential, refresh: bool = False):
        from mic_sessions.shared import codex
        try:
            cls._catalog.set(await codex.models(credential, refresh=refresh))
        except Exception:
            raise ApiException(502, "Could not load Codex models. Check your connection and try again.") from None

    @classmethod
    def configure(cls, model: str | None, effort: str | None) -> AgentConfig:
        catalog = cls.configuration()
        chosen = model or catalog["defaultModel"]
        entry = next((item for item in catalog["models"] if item["id"] == chosen), None)
        if entry is None:
            raise ApiException.bad_request("Unsupported Codex model; refresh the model list")
        supported = entry["efforts"]
        preferred = catalog.get("defaultEffort") if chosen == catalog["defaultModel"] else None
        value = effort if effort is not None else preferred if preferred in supported else entry.get("defaultEffort")
        if value is not None and value not in supported:
            raise ApiException.bad_request("Unsupported effort for this model")
        return AgentConfig(chosen, value)

    def __init__(self, credential, workspace, branch, emit, ask, config, *, instructions="", environment=None):
        self._credential, self._workspace, self._branch = credential, workspace, branch
        self._emit, self._ask, self._config = emit, ask, config
        self._instructions = instructions
        self._environment = dict(environment or {})
        self._account = None
        self._client = None
        # The credential the connection was opened with, and whether it has loaded the thread.
        self._client_token = None
        self._thread_loaded = False
        self._connect_lock = asyncio.Lock()
        self._thread_id = None
        # The thread's rollout file as the app-server reported it, or as found by `trace_sources`.
        self._thread_path: str | None = None
        self._turn_id = None
        self._task = None
        self._pending = {}
        self._loop = asyncio.get_running_loop()
        self._interrupted = False
        self._closing = False
        self._open_steps: set[str] = set()
        # Codex thread id of each delegated agent -> the `spawnAgent` call that delegated it.
        self._delegations: dict[str, str] = {}

    async def _publish(self, event):
        await self._emit(event["type"], event["data"])

    def _thread_params(self) -> dict[str, Any]:
        params = {"cwd": str(self._workspace), "model": self._config.model, **_CODEX_ACCESS,
                  "developerInstructions": "\n\n".join(filter(None, [_CODEX_CONDUCT, self._instructions]))}
        if self._environment:
            # The account's app-server is shared by sessions: per-thread overrides scope the variables
            # to this conversation's shell commands, on top of the server's `inherit="none"` policy.
            params["config"] = {f"shell_environment_policy.set.{key}": value
                                for key, value in self._environment.items()}
        return params

    async def start(self):
        from mic_sessions.shared import codex
        # Both adapters enforce the appropriate managed workspace contract.
        await asyncio.to_thread(_validate_agent_workspace, self._workspace, self._branch)
        self._account = codex.acquire(self._credential)
        window = codex.context_window(self._credential.connection_id, self._config.model)
        if window:
            await self._emit("session.usage", {"context": {
                "percent": 0, "usedTokens": 0, "limitTokens": window, "updatedAt": time.time(),
            }})
        try:
            # The connection the first turn will reuse, opened while the session provisions.
            async with asyncio.timeout(30):
                client = await self._connection()
                snapshot = await codex.quota(self._account, client)
            await self._emit("session.usage", {"quota": snapshot})
        except Exception:
            LOG.debug("Initial Codex account usage is unavailable")
            await self._emit("session.usage", {"quota": {}})

    async def _connection(self):
        """The session's app-server, opened on first use and replaced when broken or stale."""
        from mic_sessions.shared import codex
        async with self._connect_lock:
            if self._closing or self._account is None:
                raise ApiException.conflict("Codex session is closed")
            if self._client is not None and not (self._client.alive and self._account.current(self._client_token)):
                await self._disconnect()
            if self._client is None:
                self._client, self._client_token = await codex.open_client(self._account, self._workspace, self._answer)
                self._thread_loaded = False
            return self._client

    async def _disconnect(self):
        from mic_sessions.shared import codex
        client, self._client, self._thread_loaded = self._client, None, False
        if client is not None and self._account is not None:
            try:
                await codex.close_client(self._account, client)
            except asyncio.CancelledError:
                raise
            except Exception:
                LOG.debug("The Codex app-server did not close cleanly", exc_info=True)

    async def _load_thread(self, client):
        params = self._thread_params()
        if self._thread_id is None:
            thread = (await client.call("thread_start", params)).thread
            self._thread_id = thread.id
            self._thread_path = getattr(thread, "path", None)
        elif not self._thread_loaded:
            await client.call("thread_resume", self._thread_id, params)
        self._thread_loaded = True

    def trace_sources(self) -> Sequence[TraceSource]:
        """The thread's rollout file in the account's `CODEX_HOME`; `[]` until the thread exists."""
        if self._account is None or self._thread_id is None:
            return []
        path = codex_rollout(self._account.home, self._thread_id, self._thread_path)
        if path is None:
            return []
        self._thread_path = str(path)
        return [TraceSource("codex", path)]

    async def refresh_usage(self):
        """Reads the account limits on the live connection; never starts an app-server just for them."""
        from mic_sessions.shared import codex
        account, client = self._account, self._client
        if self._closing or account is None:
            return
        if client is None or not client.alive:
            if account.quota_snapshot:
                await self._emit("session.usage", {"quota": account.quota_snapshot})
            return
        async with asyncio.timeout(15):
            snapshot = await codex.quota(account, client)
        if snapshot:
            await self._emit("session.usage", {"quota": snapshot})

    async def send(self, text, images=()):
        if self._closing or self._account is None:
            raise ApiException.conflict("Codex session is closed")
        if self._task and not self._task.done():
            raise ApiException.conflict("A Codex turn is already running")
        self._interrupted = False
        # The bundled CLI reads each stored image from the session directory itself.
        items = [*({"type": "localImage", "path": str(image.path)} for image in images),
                 *([{"type": "text", "text": text}] if text else [])]
        self._task = asyncio.create_task(self._run(items))
        await asyncio.sleep(0)

    async def refresh_credential(self, credential):
        if credential.connection_id != self._credential.connection_id:
            raise ApiException.conflict("The Codex account changed. Create a new session.")
        self._credential = credential
        if self._account:
            self._account.credential = credential

    async def set_configuration(self, config):
        self._config = config
        return config

    async def _answer(self, method, params):
        from mic_sessions.shared.codex import decline
        if self._closing or self._interrupted:
            return decline(method)
        request_id = uuid4().hex
        future = self._loop.create_future()
        questions = params.get("questions", [])
        is_question = method in ("item/tool/requestUserInput", "tool/requestUserInput")
        is_permissions = method == "item/permissions/requestApproval"
        if not is_question and not is_permissions and method not in (
            "item/commandExecution/requestApproval", "item/fileChange/requestApproval"
        ):
            return decline(method)
        self._pending[request_id] = (future, is_question)
        try:
            if is_question:
                normalized = [{"question": item["question"], "header": item.get("header", "Question"),
                               "multiSelect": False, "options": item.get("options") or []}
                              for item in questions]
                await self._publish(question_request(request_id, normalized))
                await self._ask(QuestionRequest(request_id, normalized))
            else:
                name = "Permissions" if is_permissions else "Bash" if "commandExecution" in method else "Edit"
                title = str(params.get("command") or params.get("reason") or name)[:120]
                await self._publish(permission_request(request_id, name, title, params))
                await self._ask(PermissionRequest(request_id, name, title, params))
            answer = await future
            if is_question:
                answers = answer.get("answers") or {}
                return {"answers": {item["id"]: {"answers": (
                    answers.get(item["question"], []) if isinstance(answers.get(item["question"]), list)
                    else [str(answers[item["question"]])] if item["question"] in answers else [])}
                    for item in questions}}
            if is_permissions:
                return {"permissions": params.get("permissions", {}) if answer.get("decision") == "allow" else {},
                        "scope": "turn"}
            return {"decision": "accept" if answer.get("decision") == "allow" else "decline"}
        finally:
            self._pending.pop(request_id, None)

    async def resolve(self, request_id, payload):
        pending = self._pending.get(request_id)
        if not pending or pending[0].done():
            raise ApiException.not_found("Unknown or already answered request")
        pending[0].set_result(payload)
        await self._publish(question_resolved(request_id, payload.get("answers") or {}) if pending[1]
                            else permission_resolved(request_id, payload.get("decision", "deny")))

    async def _deny_pending(self):
        for key, (future, question) in list(self._pending.items()):
            if not future.done():
                await self.resolve(key, {"answers": {}} if question else {"decision": "deny"})

    async def interrupt(self):
        self._interrupted = True
        await self._deny_pending()
        if self._client and self._turn_id:
            try:
                async with asyncio.timeout(10):
                    await self._client.call("turn_interrupt", self._thread_id, self._turn_id)
            except Exception:
                if self._task and not self._task.done():
                    self._task.cancel()
        elif self._task and not self._task.done():
            self._task.cancel()

    async def compact(self, instructions: str | None = None):
        from mic_sessions.shared import codex
        if self._closing or self._account is None:
            raise ApiException.conflict("Codex session is closed")
        if self._thread_id is None:
            raise ApiException.conflict("There is no conversation to compact yet")
        if self._task and not self._task.done():
            raise ApiException.conflict("A Codex turn is still running")
        client = await self._connection()
        try:
            await self._load_thread(client)
            tokens = await client.compact(self._thread_id, instructions)
        except asyncio.CancelledError:
            await self._disconnect()
            raise
        except Exception:
            if not client.alive:
                await self._disconnect()
            raise
        last = (tokens or {}).get("last") or {}
        window = (tokens or {}).get("modelContextWindow")
        used = last.get("totalTokens")
        await self._emit("session.usage", {"context": {
            "percent": used / window * 100 if used is not None and window else None,
            "usedTokens": used, "limitTokens": window, "updatedAt": time.time(),
        }})
        try:
            await self._emit("session.usage", {"quota": await codex.quota(self._account, client, refresh=True)})
        except Exception:
            LOG.debug("Codex quota is unavailable after compaction")

    async def aside(self, question):
        """Answers in an ephemeral, read-only fork of the thread on its own connection, beside any turn."""
        from mic_sessions.shared import codex
        if self._closing or self._account is None:
            raise ApiException.conflict("Codex session is closed")
        params = {**self._thread_params(), "approvalPolicy": "never", "sandbox": "read-only", "ephemeral": True}
        async with asyncio.timeout(_ASIDE_TIMEOUT_SECONDS):
            # No request handler: anything the fork asks for is declined.
            async with codex.connected(self._account, self._workspace) as client:
                thread = (await client.call("thread_fork", self._thread_id, params) if self._thread_id
                          else await client.call("thread_start", params))
                turn = await client.call("turn_start", thread.thread.id,
                                         [{"type": "text", "text": _aside_prompt(question)}],
                                         {"model": self._config.model, "effort": self._config.effort})
                async for method, payload in client.notifications(turn.turn.id):
                    if method == "item/agentMessage/delta" and payload.get("delta"):
                        yield payload["delta"]
                    elif method == "turn/completed" and payload["turn"]["status"] != "completed":
                        raise RuntimeError("Codex could not answer the side question")

    async def recover(self):
        """A broken connection already ended its turn: drop it so the next turn reconnects and resumes
        the thread, with the workspace and the account in place again."""
        from mic_sessions.shared import codex
        if self._closing:
            raise ApiException.conflict("Codex session is closed")
        await asyncio.to_thread(_validate_agent_workspace, self._workspace, self._branch)
        if self._account is None:
            self._account = codex.acquire(self._credential)
        async with self._connect_lock:
            await self._disconnect()

    async def close(self):
        from mic_sessions.shared import codex
        self._closing = True
        await self._deny_pending()
        if self._task and not self._task.done():
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        async with self._connect_lock:
            await self._disconnect()
        if self._account:
            codex.release(self._account)
            self._account = None

    async def _run(self, items):
        from mic_sessions.shared import codex
        terminal = "error"
        started = time.monotonic()
        usage = None
        try:
            client = await self._start_turn(items)
            if self._interrupted:
                await client.call("turn_interrupt", self._thread_id, self._turn_id)
            async for method, payload in client.notifications(self._turn_id):
                if method == "turn/completed":
                    status = payload["turn"]["status"]
                    terminal = "completed" if status == "completed" else "interrupted" if status == "interrupted" else "error"
                    if terminal == "error":
                        await self._publish(agent_error("Codex could not complete the turn. Check your account and selected model."))
                elif method == "thread/tokenUsage/updated":
                    tokens = payload.get("tokenUsage") or {}
                    usage = tokens.get("last")
                    window = tokens.get("modelContextWindow")
                    used = (usage or {}).get("totalTokens")
                    await self._emit("session.usage", {"context": {
                        "percent": used / window * 100 if used is not None and window else None,
                        "usedTokens": used, "limitTokens": window, "updatedAt": time.time(),
                    }})
                else:
                    await self._event(method, payload)
            # Best effort, once per turn; shared account cache bounds short-turn traffic.
            try:
                quota = await codex.quota(self._account, client)
                await self._emit("session.usage", {"quota": quota})
            except Exception:
                LOG.debug("Codex quota is unavailable")
            await codex.persist(self._account)
        except asyncio.CancelledError:
            terminal = "interrupted"
            # Its reader may still be blocked on this turn: never reuse the connection.
            await self._disconnect()
        except Exception:
            if self._client is not None and not self._client.alive:
                await self._disconnect()
            await self._publish(agent_error("Codex could not complete the turn. Check your account connection and try again."))
        finally:
            self._turn_id = None
            await self._deny_pending()
            if not self._closing:
                await self._publish(turn_result("interrupted" if self._interrupted else terminal,
                                               duration_ms=int((time.monotonic() - started) * 1000), usage=usage))

    async def _start_turn(self, items):
        """Starts the turn on the session's connection. A reused connection that fails before the turn
        starts is replaced once: a dead app-server never costs the user's message."""
        for attempt in range(2):
            reused = self._client is not None
            client = await self._connection()
            try:
                await self._load_thread(client)
                turn = await client.call("turn_start", self._thread_id, items,
                                         {"model": self._config.model, "effort": self._config.effort})
            except Exception:
                async with self._connect_lock:
                    await self._disconnect()
                if not reused or attempt:
                    raise
                LOG.info("Codex connection was unusable; reconnecting for this turn")
                continue
            self._turn_id = turn.turn.id
            return client
        raise RuntimeError("unreachable")

    async def _event(self, method, payload):
        item_id = payload.get("itemId", "")
        if method == "item/agentMessage/delta":
            await self._publish(assistant_delta(item_id, payload.get("delta", "")))
        elif method in ("item/reasoning/summaryTextDelta", "item/reasoning/textDelta"):
            await self._publish(thinking_delta(item_id, payload.get("delta", "")))
        elif method in ("item/started", "item/completed"):
            item = payload.get("item", {})
            kind, identity = item.get("type"), item.get("id", uuid4().hex)
            done = method == "item/completed"
            if kind == "agentMessage" and done:
                await self._publish(assistant_message(identity, item.get("text", "")))
            elif kind == "reasoning" and done:
                await self._publish(thinking_message(identity, "\n".join(item.get("summary") or item.get("content") or [])))
            elif kind == "fileChange":
                await self._file_change(item, done)
            elif kind in ("imageGeneration", "imageView"):
                await self._image_item(item, done)
            elif kind == "collabAgentToolCall":
                await self._collab_item(item, done)
            elif kind not in ("agentMessage", "reasoning", "userMessage", "contextCompaction"):
                name = {"commandExecution": "Bash", "webSearch": "WebSearch"}.get(kind, kind or "Tool")
                if not done:
                    await self._publish(tool_use(identity, name, _tool_title(name, item), item))
                else:
                    await self._publish(tool_result(identity, item.get("status") in ("failed", "declined")
                                                   or item.get("exitCode") not in (None, 0),
                                                   _result_summary(item.get("aggregatedOutput") or item)))
        elif method == "error" and not payload.get("willRetry"):
            await self._publish(agent_error("Codex reported an error. Retry or reconnect your account."))

    async def _collab_item(self, item, done):
        """Codex delegation. A `spawnAgent` call becomes the delegation itself, outliving its call
        (the agent keeps working after it); the other collab calls are steps of the main agent, and
        the agent states they report update each delegation. Codex streams a delegate's own activity
        on a turn of its own thread, which never reaches this turn."""
        identity = item.get("id") or uuid4().hex
        tool = item.get("tool")
        failed = item.get("status") in ("failed", "interrupted")
        if tool == "spawnAgent":
            if identity not in self._open_steps:
                self._open_steps.add(identity)
                prompt = str(item.get("prompt") or "")
                input_data = {key: value for key, value in (
                    ("prompt", prompt), ("model", item.get("model")), ("reasoningEffort", item.get("reasoningEffort")),
                ) if value}
                await self._publish(tool_use(identity, "Agent", (prompt.strip().splitlines() or ["Delegated task"])[0][:_TITLE_LIMIT],
                                             input_data))
                await self._publish(subagent_updated(identity, status="started", detached=True, streamsActivity=False))
            for thread in item.get("receiverThreadIds") or []:
                self._delegations[thread] = identity
            if done and failed:
                await self._publish(subagent_updated(identity, status="failed",
                                                     summary="Codex could not start the agent."))
        else:
            name = _CODEX_COLLAB_TOOLS.get(tool, "Agent" + str(tool or "Tool"))
            if identity not in self._open_steps:
                self._open_steps.add(identity)
                count = len(item.get("receiverThreadIds") or [])
                title = str(item.get("prompt") or "") or f"{count} agent{'s' if count != 1 else ''}"
                await self._publish(tool_use(identity, name, title.strip()[:_TITLE_LIMIT],
                                             {"prompt": item.get("prompt")} if item.get("prompt") else {}))
            if done:
                self._open_steps.discard(identity)
                states = item.get("agentsStates") or {}
                summary = "\n\n".join(f"{state.get('status')}: {state.get('message')}" if state.get("message")
                                       else str(state.get("status")) for state in states.values()) or str(item.get("status"))
                await self._publish(tool_result(identity, failed, _result_summary(summary)))
        for thread, state in (item.get("agentsStates") or {}).items():
            delegation = self._delegations.get(thread)
            status = _CODEX_AGENT_STATUSES.get(state.get("status")) if isinstance(state, dict) else None
            if delegation and status:
                message = state.get("message")
                await self._publish(subagent_updated(
                    delegation, agentId=thread, status=status,
                    summary=message if isinstance(message, str) and message and status in ("completed", "failed") else None))

    async def _image_item(self, item, done):
        """A native generation renders as `ImageGeneration` and a viewed file as `ViewImage`. The
        item carries the generated image as base64: only its stored metadata reaches the event log.
        A step first seen on completion still gets its `tool.use` before its result."""
        identity = item.get("id") or uuid4().hex
        generation = item.get("type") == "imageGeneration"
        prompt = item.get("revisedPrompt") or ""
        name, input_data = ((IMAGE_GENERATION_TOOL, {"prompt": prompt} if prompt else {}) if generation
                            else (VIEW_IMAGE_TOOL, {"path": str(item.get("path") or "")}))
        if identity not in self._open_steps:
            self._open_steps.add(identity)
            title = (prompt or "Generating image") if generation else _tool_title(name, input_data)
            await self._publish(tool_use(identity, name, title[:_TITLE_LIMIT], input_data))
        if not done:
            return
        self._open_steps.discard(identity)
        failure = item.get("failure") or {}
        failed = bool(failure) or item.get("status") in ("failed", "declined")
        saved = item.get("savedPath") if generation else input_data["path"]
        source = Path(saved) if isinstance(saved, str) and saved else None

        def store() -> Image | None:
            image = session_images.save_encoded(self._workspace, item.get("result") or "") if generation else None
            if image is None and source is not None and source.is_absolute():
                image = session_images.save_file(self._workspace, source)
            return image

        image = None if failed else await asyncio.to_thread(store)
        if image is not None:
            summary = prompt or (source.name if source else "")
        elif failure.get("type") == "usageLimitExceeded":
            summary = "The image generation limit was reached. Try again later."
        elif generation:
            summary = "Codex could not generate the image."
        else:
            summary = "The image could not be displayed."
        await self._publish(tool_result(identity, failed or (generation and image is None), summary,
                                        [image] if image else []))

    async def _file_change(self, item, done):
        """One step per changed file. The file list may only be complete once the patch applied, so a
        file first seen on completion still gets its `tool.use` before its result."""
        steps = _codex_file_steps(item)
        failed = item.get("status") in ("failed", "declined")
        for identity, name, input_data in steps:
            if identity not in self._open_steps:
                self._open_steps.add(identity)
                await self._publish(tool_use(identity, name, _tool_title(name, input_data), input_data))
            if done:
                self._open_steps.discard(identity)
                await self._publish(tool_result(identity, failed, _result_summary(input_data["diff"] or item.get("status") or "")))
        if not steps and done:
            identity = item.get("id") or uuid4().hex
            await self._publish(tool_use(identity, "Edit", "File changes", {}))
            await self._publish(tool_result(identity, failed, _result_summary(item)))


@dataclass(frozen=True)
class AdapterDescriptor:
    """One implementation of a provider: the integration technology behind the same contract."""

    id: str
    label: str
    runtime_class: type[AgentRuntime]

    @property
    def capabilities(self) -> AgentCapabilities:
        return self.runtime_class.capabilities


@dataclass(frozen=True)
class ProviderDescriptor:
    """A provider and its adapters; the first adapter is the default. Accounts, model defaults and
    usage belong to the provider, so every adapter of one provider shares them."""

    id: str
    label: str
    adapters: tuple[AdapterDescriptor, ...]

    def adapter(self, adapter_id: str | None = None) -> AdapterDescriptor:
        if not adapter_id:
            return self.adapters[0]
        adapter = next((entry for entry in self.adapters if entry.id == adapter_id), None)
        if adapter is None:
            raise ApiException.bad_request("Unknown agent adapter")
        return adapter

    def default_adapter(self, configured: str | None) -> AdapterDescriptor:
        """The administrator's default adapter when this provider still offers it, else the first one."""
        return next((entry for entry in self.adapters if entry.id == configured), self.adapters[0])

    async def prepare(self, caller, connection_id: str, refresh: bool = False,
                      adapter: str | None = None) -> AdapterDescriptor:
        """Loads the catalog of the requested adapter, or of the platform's default one, and returns
        the adapter it prepared. The credential carries the platform defaults, so resolving the default
        costs nothing beyond the fetch the catalog needs anyway."""
        requested = self.adapter(adapter) if adapter else None
        from mic_sessions.shared.mooi import fetch_agent_credential
        credential = await fetch_agent_credential(caller, connection_id)
        if credential.provider != self.id:
            raise ApiException.bad_request("The selected account belongs to another provider")
        prepared = requested or self.default_adapter(credential.session_adapter)
        runtime_class = prepared.runtime_class
        loader = getattr(runtime_class, "load_configuration", None)
        if loader:
            await loader(credential, refresh=refresh)
            catalog = runtime_class.configuration()
            selected = (credential.session_model if credential.session_model and any(
                model["id"] == credential.session_model for model in catalog["models"]
            ) else "" if credential.session_model else catalog["defaultModel"])
            entry = next((model for model in catalog["models"] if model["id"] == selected), None)
            efforts = entry["efforts"] if entry else []
            preferred_effort = next((value for value in (
                credential.session_effort, entry.get("defaultEffort") if entry else None,
                catalog["defaultEffort"], *efforts) if value and value in efforts), None)
            runtime_class._catalog.set({**catalog, "providerDefaultModel": catalog["defaultModel"],
                                        "defaultModel": selected, "defaultEffort": preferred_effort})
        return prepared

    def configuration(self, adapter: str | None = None) -> dict[str, Any]:
        selected = self.adapter(adapter)
        return {**selected.runtime_class.configuration(), "adapter": selected.id,
                "adapters": [{"id": entry.id, "label": entry.label} for entry in self.adapters]}

    def configure(self, model: str | None, effort: str | None, adapter: str | None = None) -> AgentConfig:
        return self.adapter(adapter).runtime_class.configure(model, effort)


PROVIDERS: dict[str, ProviderDescriptor] = {
    "codex": ProviderDescriptor("codex", "Codex", (AdapterDescriptor("sdk", "Codex SDK", CodexAgentRuntime),)),
    "claude": ProviderDescriptor("claude", "Claude", (
        AdapterDescriptor("sdk", "Claude SDK", ClaudeAgentRuntime),
        AdapterDescriptor("cli", "Claude CLI", ClaudeCliAgentRuntime),
    )),
}


def describe(provider: str) -> ProviderDescriptor:
    descriptor = PROVIDERS.get(provider)
    if descriptor is None:
        raise ApiException.bad_request("Unknown agent provider")
    return descriptor


def create_runtime(
    provider: str,
    credential: Credential,
    workspace: Path,
    branch: str,
    emit: Emit,
    ask: Ask,
    config: AgentConfig,
    *,
    adapter: str | None = None,
    instructions: str = "",
    environment: Mapping[str, str] | None = None,
) -> AgentRuntime:
    return describe(provider).adapter(adapter).runtime_class(credential, workspace, branch, emit, ask, config,
                                                             instructions=instructions, environment=environment)
