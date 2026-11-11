"""Transversal aspect: agent traces — every internal step of an agent, read from its own session log.

Each provider already writes a complete, timestamped log of its conversation: Claude Code a JSONL
transcript per conversation under its config directory (plus one per sub-agent), Codex one rollout
JSONL per thread, the Gemini CLI one session JSONL per conversation (plus one per sub-agent beside it). This module turns those native logs into one provider-neutral trace, the shape
observability platforms use: prompts (one user request each), turns (one agent-loop iteration: a model
call with its exact token usage, then the tools, sub-agents and skills it requested), hooks, context
events and compactions, each a timed span in one tree.

Reading the log instead of instrumenting the agent keeps the trace complete (the log holds what the
event stream never forwards: per-request usage, sub-agent work, hooks, injected context) and free while
nobody looks: a `TraceReader` parses only when a trace is requested and then only the bytes appended
since its last read. Spans keep bounded copies of their input and output, so a conversation stays
inspectable after its provider files are gone (a cleared chat, a replaced runtime).

Adding a provider: its runtime returns `TraceSource`s from `trace_sources()` and a parser for that
`format` is registered in `_PARSERS`. Nothing else changes.

The raw logs a trace was built from stay downloadable (`SessionTrace.log_files`): a reader records every
file it discovered under its sources, and archiving a conversation keeps a hard link (or copy) of them in
the session directory, since the runtime deletes the originals on close.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, ClassVar, Literal

from mic_sessions.shared.env import get_settings

TraceFormat = Literal["claude", "codex", "gemini"]

KIND_PROMPT = "prompt"
KIND_TURN = "turn"
KIND_LLM = "llm"
KIND_TOOL = "tool"
KIND_AGENT = "agent"
KIND_SKILL = "skill"
KIND_HOOK = "hook"
KIND_CONTEXT = "context"
KIND_COMPACTION = "compaction"
KIND_EVENT = "event"

STATUS_OK = "ok"
STATUS_ERROR = "error"
STATUS_RUNNING = "running"
STATUS_INTERRUPTED = "interrupted"
STATUS_INCOMPLETE = "incomplete"

_PREVIEW_CHARS = 160
_TITLE_CHARS = 120
_AGENT_TOOLS = {"Agent", "Task"}
_SKILL_TOOLS = {"Skill"}
_INTERRUPTED_PREFIX = "[Request interrupted by user"
_TASK_NOTIFICATION_PREFIX = "<task-notification>"
# Claude Code attachments that tell the model something new; the rest is bookkeeping.
_CLAUDE_CONTEXT_ATTACHMENTS = {
    "file": "Attached file",
    "directory": "Attached directory",
    "skill_listing": "Skills available",
    "invoked_skills": "Skills invoked",
    "agent_listing_delta": "Sub-agents available",
    "mcp_instructions_delta": "MCP instructions",
    "deferred_tools_delta": "Tools available",
    "hook_additional_context": "Hook context",
    "queued_command": "Queued message",
    "edited_text_file": "File edited outside the agent",
    "nested_memory": "Memory file",
    "instructions": "Project instructions",
    "compact_file_reference": "File kept after compaction",
    "plan_mode": "Plan mode",
    "todo": "To-do list",
    "task_status": "Task status",
    "diagnostics": "Diagnostics",
    "selected_lines_in_ide": "Selected lines",
    "opened_file_in_ide": "Opened file",
}
# Codex injects these as user messages; they are context, not the user's prompt.
_CODEX_CONTEXT_PREFIXES = ("<environment_context>", "<user_instructions>", "<permissions instructions>",
                           "# AGENTS.md", "<turn_aborted>", "<subagent_notification>", "<user_shell_command>",
                           "<external_codex_apps_", "<codex_apps_")


@dataclass(frozen=True)
class TraceSource:
    """Where a runtime's native log lives: a Claude Code `projects` directory, one Codex rollout file or
    one Gemini CLI session file."""

    format: TraceFormat
    path: Path


@dataclass(frozen=True)
class TraceLog:
    """One raw log file of a conversation, offered for download under `name` (relative to `root`)."""

    root: Path
    path: Path

    @property
    def name(self) -> str:
        return self.path.relative_to(self.root).as_posix()

    def resolved(self) -> Path | None:
        """The file to read, or None when it is gone, not a regular file or (through a symlink the
        agent could have planted) outside its root: a download never reads anything else."""
        try:
            if self.path.is_symlink() or not self.path.is_file():
                return None
            path = self.path.resolve(strict=True)
            return path if path.is_relative_to(self.root.resolve(strict=True)) else None
        except OSError:
            return None


@dataclass
class Span:
    id: str
    kind: str
    name: str
    start: float
    parent: str | None = None
    title: str | None = None
    end: float | None = None
    status: str = STATUS_RUNNING
    model: str | None = None
    usage: dict[str, int] | None = None
    stop_reason: str | None = None
    preview: str | None = None
    # Bounded copies of what the step received and produced, plus provider attributes.
    input: str | None = None
    output: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    sequence: int = 0

    def close(self, at: float, status: str = STATUS_OK) -> None:
        self.end = max(at, self.start)
        if self.status in (STATUS_RUNNING, STATUS_OK):
            self.status = status


def _timestamp(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value) / (1000 if value > 1e11 else 1)
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value).timestamp()
    except ValueError:
        return None


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n… {len(text) - limit:,} more characters"


def _render(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, indent=2, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(value)


def _line(text: str | None, limit: int = _PREVIEW_CHARS) -> str | None:
    if not text:
        return None
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def _int(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _blocks_text(content: Any) -> str:
    """Text of a message content: a string, or blocks whose images and documents become markers."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return _render(content)
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            parts.append(str(block))
            continue
        kind = block.get("type")
        if kind in ("text", "input_text", "output_text"):
            parts.append(str(block.get("text") or ""))
        elif kind in ("image", "input_image"):
            parts.append("[image]")
        elif kind == "document":
            parts.append("[document]")
        elif kind == "tool_reference":
            parts.append(f"[tool {block.get('tool_name', '')}]")
        else:
            parts.append(_render(block))
    return "\n".join(part for part in parts if part)


class _Parser:
    """Turns the lines of one native log file into spans of its reader. Stateful across reads."""

    def __init__(self, reader: TraceReader, path: Path, key: str) -> None:
        self.reader = reader
        self.path = path
        self.key = key
        # Turns of the current prompt (or sub-agent): one per model call, as agent SDKs count `max_turns`.
        self.loop = 0

    def feed(self, entry: dict[str, Any]) -> None:
        raise NotImplementedError

    def _open_turn(self, span_id: str, start: float, parent: str | None) -> Span:
        """One iteration of the agent loop: a model call, then the tools it requested (its children)."""
        self.loop += 1
        return self.reader.add(Span(id=span_id, kind=KIND_TURN, name=f"Turn {self.loop}", start=start, parent=parent))

    def _describe_turn(self, call: Span) -> None:
        """A turn reads as what its model call did: the tools it requested, else its answer."""
        turn = self.reader.get(call.parent or "")
        if turn is None or turn.kind != KIND_TURN:
            return
        tools = call.metadata.get("tools") or []
        turn.title = _line(", ".join(tools), _TITLE_CHARS) if tools else call.preview
        turn.preview = turn.title


class _ClaudeParser(_Parser):
    """Claude Code transcripts: one entry per user message, model content block, attachment or system
    note. A model call is every assistant entry sharing one message id; its usage is the call's own."""

    def __init__(self, reader: TraceReader, path: Path, key: str, agent: str | None) -> None:
        super().__init__(reader, path, key)
        # A sub-agent transcript nests under the tool call that spawned it, resolved when the trace is built.
        self.agent = agent
        self.root: str | None = f"agent:{agent}" if agent else None
        self.prompt: str | None = None
        self.prompts = 0
        self.forked = False
        self.calls: dict[str, Span] = {}
        self.ready_at: float | None = None
        self.pending_input: list[str] = []
        self.open_tools: set[str] = set()

    def _parent(self) -> str | None:
        return self.prompt or self.root

    def feed(self, entry: dict[str, Any]) -> None:
        if entry.get("forkedFrom"):
            # A fork copies the conversation it starts from: that history is already traced.
            self.forked = True
            return
        kind = entry.get("type")
        at = _timestamp(entry.get("timestamp"))
        if at is None:
            if kind == "ai-title" and not self.agent and isinstance(entry.get("aiTitle"), str):
                self.reader.title = entry["aiTitle"]
            return
        if kind == "user":
            self._user(entry, at)
        elif kind == "assistant":
            self._assistant(entry, at)
        elif kind == "attachment":
            self._attachment(entry, at)
        elif kind == "system":
            self._system(entry, at)
        elif kind == "api-request":
            # Recent Claude Code versions log when the request leaves, after context is attached.
            self.ready_at = at

    def _user(self, entry: dict[str, Any], at: float) -> None:
        message = entry.get("message") or {}
        content = message.get("content")
        results = [block for block in content if isinstance(block, dict) and block.get("type") == "tool_result"] \
            if isinstance(content, list) else []
        if results:
            for block in results:
                self._tool_result(block, entry, at)
            self.ready_at = at
            return
        text = _blocks_text(content)
        if entry.get("isCompactSummary"):
            span = self.reader.last_of(KIND_COMPACTION, self.key)
            if span is not None:
                span.output = self.reader.clip(text)
            self.ready_at = at
            return
        if entry.get("isMeta"):
            self.pending_input.append(text)
            return
        if text.startswith(_INTERRUPTED_PREFIX):
            self._interrupt(at)
            return
        origin = entry.get("origin")
        if self._parent() and ((isinstance(origin, dict) and origin.get("kind") == "task-notification")
                               or text.startswith(_TASK_NOTIFICATION_PREFIX)):
            self._notification(entry, text, at)
            return
        if self.agent and self.prompts == 0:
            # A sub-agent's first message is the prompt it was given.
            self.prompts = 1
            self.reader.agent_prompts[self.agent] = text
            self.ready_at = at
            self.pending_input = [text]
            return
        self._close_prompt(at)
        self.prompts += 1
        self.loop = 0
        name = "Compaction summary" if self.forked else f"Prompt {self.reader.next_prompt()}"
        span = self.reader.add(Span(id=f"{self.key}:prompt:{self.prompts}", kind=KIND_PROMPT, name=name,
                                    title=_line(text, _TITLE_CHARS), start=at, parent=self.root,
                                    input=self.reader.clip(text), preview=_line(text)))
        span.metadata = {key: entry[key] for key in ("permissionMode", "version", "gitBranch", "cwd") if entry.get(key)}
        self.prompt = span.id
        self.ready_at = at
        self.pending_input = [text]

    def _tool_result(self, block: dict[str, Any], entry: dict[str, Any], at: float) -> None:
        tool_id = str(block.get("tool_use_id") or "")
        span = self.reader.get(tool_id)
        output = _blocks_text(block.get("content"))
        self.pending_input.append(output)
        if span is None:
            return
        self.open_tools.discard(tool_id)
        span.output = self.reader.clip(output)
        span.preview = _line(output) or span.preview
        result = entry.get("toolUseResult")
        if isinstance(result, dict):
            if span.kind == KIND_AGENT:
                self.reader.agent_tools[str(result.get("agentId") or "")] = span.id
                usage = result.get("usage")
                if isinstance(usage, dict):
                    span.usage = _claude_usage(usage)
                span.model = result.get("resolvedModel") or span.model
            span.metadata.update({key: value for key, value in result.items()
                                  if key in ("agentType", "totalDurationMs", "totalTokens", "totalToolUseCount",
                                             "status", "exitCode", "interrupted", "durationMs", "numFiles",
                                             "numLines", "truncated", "returnCodeInterpretation", "commandName",
                                             "toolStats")})
        span.close(at, STATUS_ERROR if block.get("is_error") else STATUS_OK)

    def _assistant(self, entry: dict[str, Any], at: float) -> None:
        message = entry.get("message") or {}
        message_id = str(message.get("id") or entry.get("requestId") or entry.get("uuid"))
        call = self.calls.get(message_id)
        model = message.get("model")
        if call is None:
            started = min(self.ready_at if self.ready_at is not None else at, at)
            turn = self._open_turn(f"{self.key}:turn:{message_id}", started, self._parent())
            call = self.reader.add(Span(id=f"{self.key}:llm:{message_id}", kind=KIND_LLM,
                                        name=str(model or "Model call"), start=started,
                                        parent=turn.id, model=model if model != "<synthetic>" else None,
                                        input=self.reader.clip("\n\n".join(part for part in self.pending_input if part))))
            call.metadata = {key: entry[key] for key in ("requestId", "effort") if entry.get(key)}
            call.metadata["messageId"] = message.get("id")
            self.calls[message_id] = call
            self.pending_input = []
            if len(self.calls) > 64:
                self.calls.pop(next(iter(self.calls)))
        usage = message.get("usage")
        if isinstance(usage, dict) and model != "<synthetic>":
            call.usage = _claude_usage(usage)
            for key in ("service_tier", "speed", "inference_geo"):
                if usage.get(key):
                    call.metadata[key] = usage[key]
        call.stop_reason = message.get("stop_reason") or call.stop_reason
        parts = [call.output] if call.output else []
        for block in message.get("content") or []:
            if not isinstance(block, dict):
                continue
            kind = block.get("type")
            if kind == "text" and block.get("text"):
                parts.append(block["text"])
                call.preview = _line(block["text"])
            elif kind == "thinking" and block.get("thinking"):
                parts.append(f"[thinking]\n{block['thinking']}")
                call.metadata["thinking"] = True
            elif kind == "redacted_thinking":
                parts.append("[redacted thinking]")
            elif kind in ("tool_use", "server_tool_use"):
                self._tool_use(block, call, at)
                parts.append(f"[tool call] {block.get('name')}\n{_render(block.get('input') or {})}")
        call.output = self.reader.clip("\n\n".join(parts))
        self._describe_turn(call)
        failed = entry.get("isApiErrorMessage") or entry.get("error")
        if failed:
            call.status = STATUS_ERROR
            call.metadata["error"] = entry.get("error") or entry.get("apiErrorStatus")
            call.preview = _line(_blocks_text(message.get("content"))) or "Provider error"
        call.close(at, STATUS_ERROR if failed else STATUS_OK)
        self.ready_at = at

    def _tool_use(self, block: dict[str, Any], call: Span, at: float) -> None:
        tool_id = str(block.get("id") or "")
        if not tool_id or self.reader.has(tool_id):
            return
        name = str(block.get("name") or "Tool")
        payload = block.get("input") if isinstance(block.get("input"), dict) else {}
        kind = KIND_AGENT if name in _AGENT_TOOLS else KIND_SKILL if name in _SKILL_TOOLS else KIND_TOOL
        title = _claude_tool_title(name, payload)
        label = (str(payload.get("subagent_type") or "Sub-agent") if kind == KIND_AGENT
                 else str(payload.get("skill") or "Skill") if kind == KIND_SKILL else name)
        span = self.reader.add(Span(id=tool_id, kind=kind, name=label, title=title, start=at,
                                    parent=call.parent, input=self.reader.clip(_render(payload)),
                                    preview=title))
        span.metadata = {"tool": name, "call": call.id}
        call.metadata.setdefault("tools", []).append(label)
        if block.get("type") == "server_tool_use":
            span.metadata["server"] = True
        self.open_tools.add(tool_id)

    def _attachment(self, entry: dict[str, Any], at: float) -> None:
        attachment = entry.get("attachment") or {}
        kind = str(attachment.get("type") or "")
        label = _CLAUDE_CONTEXT_ATTACHMENTS.get(kind)
        if label is None:
            if kind.startswith("hook_"):
                self._hook(attachment, entry, at)
            return
        body = attachment.get("content") or attachment.get("prompt") or attachment.get("addedLines") \
            or attachment.get("addedNames") or attachment.get("addedBlocks") or attachment
        if kind == "file":
            label = f"{label}: {Path(str(attachment.get('filename') or '')).name}"
        text = _blocks_text(body) if not isinstance(body, dict) else _render(body)
        self.pending_input.append(text)
        span = self.reader.add(Span(id=f"{self.key}:ctx:{entry.get('uuid')}", kind=KIND_CONTEXT, name=label,
                                    start=at, parent=self._parent(), output=self.reader.clip(text),
                                    preview=_line(text)))
        span.metadata = {"attachment": kind}
        span.close(at)

    def _hook(self, attachment: dict[str, Any], entry: dict[str, Any], at: float) -> None:
        duration = _int(attachment.get("durationMs")) / 1000
        tool = self.reader.get(str(attachment.get("toolUseID") or ""))
        failed = attachment.get("type") in ("hook_error", "hook_blocking_error", "hook_non_blocking_error",
                                           "hook_cancelled") or _int(attachment.get("exitCode")) != 0
        output = "\n".join(str(attachment.get(key)) for key in ("content", "stdout", "stderr") if attachment.get(key))
        span = self.reader.add(Span(id=f"{self.key}:hook:{entry.get('uuid')}", kind=KIND_HOOK,
                                    name=str(attachment.get("hookName") or attachment.get("hookEvent") or "Hook"),
                                    title=_line(str(attachment.get("command") or "")), start=at - duration,
                                    parent=tool.id if tool else self._parent(), output=self.reader.clip(output),
                                    preview=_line(output)))
        span.metadata = {key: attachment[key] for key in ("hookEvent", "command", "exitCode", "durationMs", "type")
                         if key in attachment}
        span.close(at, STATUS_ERROR if failed else STATUS_OK)

    def _system(self, entry: dict[str, Any], at: float) -> None:
        subtype = entry.get("subtype")
        if subtype == "compact_boundary":
            meta = entry.get("compactMetadata") or {}
            duration = _int(meta.get("durationMs")) / 1000
            span = self.reader.add(Span(id=f"{self.key}:compact:{entry.get('uuid')}", kind=KIND_COMPACTION,
                                        name="Compaction", title=f"{meta.get('trigger', 'auto')} compaction",
                                        start=at - duration, parent=self.root,
                                        preview=f"{_int(meta.get('preTokens')):,} tokens before compaction"))
            span.metadata = {key: meta[key] for key in ("trigger", "preTokens", "durationMs") if key in meta}
            span.close(at)
            self._close_prompt(at)
            self.prompt = None
        elif subtype == "stop_hook_summary":
            infos = entry.get("hookInfos") or []
            duration = sum(_int(info.get("durationMs")) for info in infos if isinstance(info, dict)) / 1000
            errors = entry.get("hookErrors") or []
            span = self.reader.add(Span(id=f"{self.key}:hook:{entry.get('uuid')}", kind=KIND_HOOK, name="Stop hooks",
                                        title=f"{_int(entry.get('hookCount'))} hooks", start=at - duration,
                                        parent=self._parent(), output=self.reader.clip(_render(infos))))
            span.metadata = {"hookCount": entry.get("hookCount"), "preventedContinuation": entry.get("preventedContinuation")}
            span.close(at, STATUS_ERROR if errors else STATUS_OK)
        elif subtype == "turn_duration":
            prompt = self.reader.get(self.prompt or "")
            if prompt is not None:
                prompt.metadata["durationMs"] = entry.get("durationMs")
        elif subtype:
            text = _blocks_text(entry.get("content")) or str(subtype)
            level = entry.get("level")
            span = self.reader.add(Span(id=f"{self.key}:sys:{entry.get('uuid')}", kind=KIND_EVENT,
                                        name=str(subtype).replace("_", " ").capitalize(), start=at,
                                        parent=self._parent(), output=self.reader.clip(text), preview=_line(text)))
            span.metadata = {"level": level}
            span.close(at, STATUS_ERROR if level == "error" or "error" in str(subtype) else STATUS_OK)

    def _notification(self, entry: dict[str, Any], text: str, at: float) -> None:
        """A background task (sub-agent, shell) reporting back: the platform wakes the agent with it, so it is
        an event of the prompt that started the task, not a prompt of the user's."""
        summary = re.search(r"<summary>(.*?)</summary>", text, re.DOTALL)
        status = re.search(r"<status>(.*?)</status>", text, re.DOTALL)
        state = status.group(1).strip() if status else ""
        span = self.reader.add(Span(id=f"{self.key}:notify:{entry.get('uuid')}", kind=KIND_EVENT,
                                    name="Background task finished",
                                    title=_line(summary.group(1) if summary else text, _TITLE_CHARS), start=at,
                                    parent=self._parent(), output=self.reader.clip(text), preview=_line(text)))
        span.metadata = {"origin": "task-notification", **({"status": state} if state else {})}
        span.close(at, STATUS_ERROR if state in ("failed", "error") else STATUS_OK)
        self.pending_input.append(text)
        self.ready_at = at

    def _interrupt(self, at: float) -> None:
        for tool_id in tuple(self.open_tools):
            span = self.reader.get(tool_id)
            if span is not None and span.end is None:
                span.close(at, STATUS_INTERRUPTED)
        self.open_tools.clear()
        prompt = self.reader.get(self.prompt or "")
        if prompt is not None:
            prompt.status = STATUS_INTERRUPTED
            prompt.end = at

    def _close_prompt(self, at: float) -> None:
        prompt = self.reader.get(self.prompt or "")
        if prompt is not None and prompt.status == STATUS_RUNNING:
            prompt.status = STATUS_OK


def _claude_usage(usage: dict[str, Any]) -> dict[str, int]:
    fresh, read, write = (_int(usage.get(key)) for key in
                          ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
    return {"input": fresh, "cacheRead": read, "cacheWrite": write, "output": _int(usage.get("output_tokens")),
            "reasoning": 0, "context": fresh + read + write}


def _claude_tool_title(name: str, payload: dict[str, Any]) -> str | None:
    for key in ("description", "command", "file_path", "path", "pattern", "query", "url", "skill", "prompt"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return _line(value, _TITLE_CHARS)
    return _line(_render(payload), _TITLE_CHARS) if payload else None


class _CodexParser(_Parser):
    """Codex rollouts: response items as the model produced them, event notes for turns, tools and
    token counts. A model call is everything the model emitted between two usage records."""

    _TOOL_CALLS: ClassVar[frozenset[str]] = frozenset({"function_call", "custom_tool_call", "local_shell_call", "web_search_call", "tool_search_call",
                   "image_generation_call"})
    _TOOL_OUTPUTS: ClassVar[frozenset[str]] = frozenset({"function_call_output", "custom_tool_call_output", "local_shell_call_output",
                     "tool_search_output"})

    def __init__(self, reader: TraceReader, path: Path, key: str, agent: str | None = None) -> None:
        super().__init__(reader, path, key)
        # A sub-agent thread nests under the `spawn_agent` call that started it, resolved when the trace is built.
        self.agent = agent
        self.root: str | None = f"agent:{agent}" if agent else None
        # A spawned thread's rollout starts with a copy of its parent's history: skipped up to its own first task.
        self.inherited = agent is not None
        self.prompt: str | None = None
        self.call: Span | None = None
        self.records = False
        self.ready_at: float | None = None
        self.pending_input: list[str] = []
        self.model: str | None = None
        self.effort: str | None = None
        self.tools: dict[str, Span] = {}

    def feed(self, entry: dict[str, Any]) -> None:
        at = _timestamp(entry.get("timestamp"))
        payload = entry.get("payload")
        if at is None or not isinstance(payload, dict):
            return
        kind = entry.get("type")
        if self.inherited:
            attribution = payload.get("turn_attribution") or {}
            if kind != "event_msg" or payload.get("type") != "task_started" or not attribution.get("parent_turn_id"):
                return
            self.inherited = False
        if kind == "session_meta":
            if self.agent:
                return
            self.reader.metadata.update({key: payload[key] for key in ("cli_version", "originator", "model_provider",
                                                                      "source") if payload.get(key)})
        elif kind == "turn_context":
            self.model = payload.get("model") or self.model
            settings = (payload.get("collaboration_mode") or {}).get("settings") or {}
            self.effort = payload.get("effort") or settings.get("reasoning_effort") or self.effort
            if self.prompt is None:
                self._start_prompt(str(payload.get("turn_id") or ""), at)
        elif kind == "response_item":
            self._item(payload, at)
        elif kind == "event_msg":
            self._event(payload, at)
        elif kind == "token_usage_record":
            self.records = True
            self._close_call(payload.get("usage") or {}, at, str(payload.get("response_id") or ""))
        elif kind == "compacted":
            self._compaction(at, str(payload.get("message") or ""))

    def _start_prompt(self, turn_id: str, at: float) -> None:
        self._end_prompt(at, STATUS_OK)
        self.loop = 0
        if self.root:
            # A sub-agent's task is the prompt it was given: its turns sit directly under the sub-agent.
            self.prompt = self.root
            self.ready_at = at
            self.pending_input = []
            return
        span = self.reader.add(Span(id=f"{self.key}:prompt:{turn_id or at}", kind=KIND_PROMPT,
                                    name=f"Prompt {self.reader.next_prompt()}", start=at))
        if turn_id:
            span.metadata["turnId"] = turn_id
        self.prompt = span.id
        self.ready_at = at
        self.pending_input = []

    def _end_prompt(self, at: float, status: str) -> None:
        prompt = self.reader.get(self.prompt or "")
        if prompt is not None and prompt.end is None:
            prompt.close(at, status)
        self.prompt = None
        self.call = None

    def _event(self, payload: dict[str, Any], at: float) -> None:
        kind = payload.get("type")
        if kind == "task_started":
            self._start_prompt(str(payload.get("turn_id") or ""), at)
            prompt = self.reader.get(self.prompt or "")
            if prompt is not None and payload.get("model_context_window"):
                prompt.metadata["contextWindow"] = payload["model_context_window"]
        elif kind == "task_complete":
            prompt = self.reader.get(self.prompt or "")
            if prompt is not None:
                prompt.metadata.update({key: payload[key] for key in ("duration_ms", "time_to_first_token_ms")
                                      if payload.get(key) is not None})
                if payload.get("last_agent_message"):
                    prompt.output = self.reader.clip(str(payload["last_agent_message"]))
            self._end_prompt(at, STATUS_OK)
        elif kind == "turn_aborted":
            for span in self.tools.values():
                if span.end is None:
                    span.close(at, STATUS_INTERRUPTED)
            prompt = self.reader.get(self.prompt or "")
            if prompt is not None:
                prompt.close(at, STATUS_INTERRUPTED)
            self.prompt = None
        elif kind == "user_message":
            self._prompt(str(payload.get("message") or ""), at)
        elif kind == "item_completed":
            item = payload.get("item") or {}
            if item.get("type") == "UserMessage":
                self._prompt(_blocks_text(item.get("content")), at)
            elif item.get("type") == "SubAgentActivity" and item.get("kind") == "started":
                self._spawned(item)
        elif kind == "token_count" and not self.records:
            info = payload.get("info") or {}
            if isinstance(info.get("last_token_usage"), dict):
                self._close_call(info["last_token_usage"], at, "")
        elif kind == "context_compacted":
            self._compaction(at, "")
        elif kind in ("error", "stream_error", "warning"):
            message = str(payload.get("message") or kind)
            span = self.reader.add(Span(id=f"{self.key}:evt:{at}:{kind}", kind=KIND_EVENT,
                                        name=str(kind).replace("_", " ").capitalize(), start=at, parent=self.prompt,
                                        output=self.reader.clip(message), preview=_line(message)))
            span.close(at, STATUS_OK if kind == "warning" else STATUS_ERROR)

    def _spawned(self, item: dict[str, Any]) -> None:
        """Links a spawned thread to its `spawn_agent` call, so its rollout is read and nested there."""
        thread = str(item.get("agent_thread_id") or "")
        span = self.reader.get(f"{self.key}:tool:{item.get('id')}")
        if not thread or span is None:
            return
        path = str(item.get("agent_path") or "")
        self.reader.agent_tools[thread] = span.id
        self.reader.agent_meta[thread] = {"agentType": path.rsplit("/", 1)[-1] or span.name}
        self.reader.codex_threads.setdefault(thread, None)
        span.model = item.get("model") or span.model
        span.metadata.update({"agentThreadId": thread, "agentPath": path or None,
                              "effort": item.get("reasoning_effort")})

    def _prompt(self, text: str, at: float) -> None:
        if not text or text.startswith(_CODEX_CONTEXT_PREFIXES):
            return
        if self.prompt is None:
            self._start_prompt("", at)
        prompt = self.reader.get(self.prompt or "")
        if prompt is not None and prompt.input is None:
            prompt.title = _line(text, _TITLE_CHARS)
            prompt.preview = _line(text)
            prompt.input = self.reader.clip(text)
        self.pending_input.append(text)

    def _open_call(self, at: float) -> Span:
        if self.call is None:
            if self.prompt is None:
                self._start_prompt("", at)
            started = min(self.ready_at if self.ready_at is not None else at, at)
            turn = self._open_turn(f"{self.prompt}:turn:{self.loop + 1}", started, self.prompt)
            self.call = self.reader.add(Span(id=f"{self.prompt}:llm:{self.loop}", kind=KIND_LLM,
                                             name=str(self.model or "Model call"), start=started,
                                             parent=turn.id, model=self.model,
                                             input=self.reader.clip("\n\n".join(p for p in self.pending_input if p))))
            if self.effort:
                self.call.metadata["effort"] = self.effort
            self.pending_input = []
        return self.call

    def _close_call(self, usage: dict[str, Any], at: float, response_id: str) -> None:
        call = self._open_call(at)
        cached = _int(usage.get("cached_input_tokens"))
        total_input = _int(usage.get("input_tokens"))
        call.usage = {"input": max(0, total_input - cached), "cacheRead": cached,
                      "cacheWrite": _int(usage.get("cache_write_input_tokens")),
                      "output": _int(usage.get("output_tokens")),
                      "reasoning": _int(usage.get("reasoning_output_tokens")), "context": total_input}
        if response_id:
            call.metadata["responseId"] = response_id
        call.close(at)
        self.call = None
        self.ready_at = at

    def _item(self, item: dict[str, Any], at: float) -> None:
        kind = item.get("type")
        role = item.get("role")
        if kind == "message" and role in ("user", "developer", "system"):
            text = _blocks_text(item.get("content"))
            if role == "user":
                self._prompt(text, at)
            if role != "user" or text.startswith(_CODEX_CONTEXT_PREFIXES):
                self.pending_input.append(text)
            return
        if kind in self._TOOL_OUTPUTS:
            self._tool_output(item, at)
            return
        if kind == "additional_tools":
            # Tools offered to the next request: its input, not model output (it precedes `turn_context`).
            self.pending_input.append(_render({key: value for key, value in item.items() if key not in ("type", "id")}))
            return
        call = self._open_call(at)
        parts = [call.output] if call.output else []
        if kind == "message":
            text = _blocks_text(item.get("content"))
            parts.append(text)
            call.preview = _line(text) or call.preview
            if item.get("phase"):
                call.metadata["phase"] = item["phase"]
        elif kind == "reasoning":
            summary = "\n".join(str(part.get("text") or "") for part in item.get("summary") or [] if isinstance(part, dict))
            parts.append(f"[reasoning]\n{summary}" if summary else "[encrypted reasoning]")
            call.metadata["reasoning"] = True
        elif kind in self._TOOL_CALLS:
            span = self._tool_call(item, call, at)
            parts.append(f"[tool call] {span.name}\n{span.input or ''}")
        else:
            return
        call.output = self.reader.clip("\n\n".join(part for part in parts if part))
        self._describe_turn(call)

    def _tool_call(self, item: dict[str, Any], call: Span, at: float) -> Span:
        call_id = str(item.get("call_id") or item.get("id") or f"{at}")
        name = str(item.get("name") or {"local_shell_call": "shell", "web_search_call": "web_search",
                                         "image_generation_call": "image_generation"}.get(item.get("type"), "tool"))
        namespace = item.get("namespace")
        raw = item.get("arguments") if "arguments" in item else item.get("input", item.get("action"))
        arguments: Any = raw
        if isinstance(raw, str):
            try:
                arguments = json.loads(raw)
            except ValueError:
                arguments = raw
        title = (_claude_tool_title(name, arguments) if isinstance(arguments, dict)
                 else _line(str(arguments or ""), _TITLE_CHARS))
        agent = "spawn_agent" in name or name in ("delegate", "subagent")
        span = self.reader.add(Span(id=f"{self.key}:tool:{call_id}", kind=KIND_AGENT if agent else KIND_TOOL,
                                    name=f"{namespace}.{name}" if namespace else name, title=title, start=at,
                                    parent=call.parent, input=self.reader.clip(_render(arguments)), preview=title))
        span.metadata = {"call": call.id, "callId": call_id}
        call.metadata.setdefault("tools", []).append(span.name)
        if item.get("status") in ("failed", "incomplete") and item.get("type") == "web_search_call":
            span.close(at, STATUS_ERROR)
        elif item.get("type") in ("web_search_call", "image_generation_call"):
            span.close(at)
        self.tools[call_id] = span
        if len(self.tools) > 256:
            self.tools.pop(next(iter(self.tools)))
        return span

    def _tool_output(self, item: dict[str, Any], at: float) -> None:
        span = self.tools.pop(str(item.get("call_id") or ""), None)
        raw = item.get("output")
        text = _blocks_text(raw) if isinstance(raw, list) else _render(raw)
        self.ready_at = at
        self.pending_input.append(text)
        if span is None:
            return
        span.output = self.reader.clip(text)
        span.preview = _line(text) or span.preview
        match = re.search(r'"?exit_code"?\s*[:=]\s*(-?\d+)', text[:4000]) or re.search(r"Exit code:\s*(-?\d+)", text[:4000])
        code = int(match.group(1)) if match else None
        if code is not None:
            span.metadata["exitCode"] = code
        span.close(at, STATUS_ERROR if code not in (None, 0) else STATUS_OK)

    def _compaction(self, at: float, summary: str) -> None:
        span = self.reader.add(Span(id=f"{self.key}:compact:{at}", kind=KIND_COMPACTION, name="Compaction",
                                    start=at, parent=self.prompt, output=self.reader.clip(summary) if summary else None,
                                    preview="The conversation history was compacted"))
        span.close(at)


class _GeminiParser(_Parser):
    """Gemini CLI session logs: a metadata line, then one record per message (`user`, `gemini`, `info`,
    `warning`, `error`). A message is appended again, under the same id, whenever it changes (its tokens
    or tool results arrive later), so every span is keyed by the message and updated in place. A
    `gemini` message is one model call: its text, thoughts, token usage and the tool calls it requested
    with their results. A reply without tool calls ends the prompt."""

    def __init__(self, reader: TraceReader, path: Path, key: str, agent: str | None = None) -> None:
        super().__init__(reader, path, key)
        self.agent = agent
        self.root: str | None = f"agent:{agent}" if agent else None
        self.prompt: str | None = None
        self.ready_at: float | None = None
        self.calls: dict[str, Span] = {}

    def feed(self, entry: dict[str, Any]) -> None:
        kind = entry.get("type")
        if kind is None:
            if isinstance(entry.get("sessionId"), str) and not self.agent and "$set" not in entry:
                self.reader.metadata.update({"provider": "gemini", "sessionKind": entry.get("kind") or "main"})
            return
        at = _timestamp(entry.get("timestamp"))
        message_id = str(entry.get("id") or "")
        if at is None or not message_id:
            return
        if kind == "user":
            self._user(entry, message_id, at)
        elif kind == "gemini":
            self._model(entry, message_id, at)
        elif kind in ("info", "warning", "error"):
            text = _gemini_text(entry.get("content"))
            span = self.reader.add(Span(id=f"{self.key}:evt:{message_id}", kind=KIND_EVENT, name=str(kind).capitalize(),
                                        start=at, parent=self.prompt or self.root, output=self.reader.clip(text),
                                        preview=_line(text)))
            span.close(at, STATUS_ERROR if kind == "error" else STATUS_OK)

    def _user(self, entry: dict[str, Any], message_id: str, at: float) -> None:
        text = _gemini_text(entry.get("displayContent") or entry.get("content"))
        if self.root:
            # A sub-agent's task is the prompt it was given: its turns sit directly under the sub-agent.
            self.prompt = self.prompt or self.root
            self.ready_at = self.ready_at or at
            return
        span_id = f"{self.key}:prompt:{message_id}"
        if not self.reader.has(span_id):
            self._end_prompt(at)
            self.loop = 0
            self.reader.add(Span(id=span_id, kind=KIND_PROMPT, name=f"Prompt {self.reader.next_prompt()}", start=at,
                                 title=_line(text, _TITLE_CHARS), preview=_line(text), input=self.reader.clip(text)))
            self.ready_at = at
        self.prompt = span_id

    def _end_prompt(self, at: float) -> None:
        prompt = self.reader.get(self.prompt or "")
        if prompt is not None and prompt.end is None and prompt.kind == KIND_PROMPT:
            prompt.close(at)

    def _model(self, entry: dict[str, Any], message_id: str, at: float) -> None:
        call = self.calls.get(message_id)
        if call is None:
            if self.prompt is None:
                self._user({}, f"implicit-{message_id}", at)
            started = min(self.ready_at if self.ready_at is not None else at, at)
            turn = self._open_turn(f"{self.key}:turn:{message_id}", started, self.prompt)
            model = entry.get("model") if isinstance(entry.get("model"), str) else None
            call = self.reader.add(Span(id=f"{self.key}:llm:{message_id}", kind=KIND_LLM, name=model or "Model call",
                                        start=started, parent=turn.id, model=model))
            self.calls[message_id] = call
            if len(self.calls) > 512:
                self.calls.pop(next(iter(self.calls)))
        tokens = entry.get("tokens") if isinstance(entry.get("tokens"), dict) else None
        if tokens:
            cached = _int(tokens.get("cached"))
            prompt_tokens = _int(tokens.get("input"))
            call.usage = {"input": max(0, prompt_tokens - cached), "cacheRead": cached, "cacheWrite": 0,
                          "output": _int(tokens.get("output")), "reasoning": _int(tokens.get("thoughts")),
                          "context": prompt_tokens}
        thoughts = [f"[thought] {thought.get('subject') or ''}\n{thought.get('description') or ''}".strip()
                    for thought in entry.get("thoughts") or [] if isinstance(thought, dict)]
        text = _gemini_text(entry.get("content"))
        tools = [tool for tool in entry.get("toolCalls") or [] if isinstance(tool, dict)]
        for tool in tools:
            self._tool(tool, call, at)
        call.output = self.reader.clip("\n\n".join(part for part in [*thoughts, text, *(
            f"[tool call] {tool.get('name')}" for tool in tools)] if part))
        call.preview = _line(text) or call.preview
        if thoughts:
            call.metadata["reasoning"] = True
        call.close(at)
        self._describe_turn(call)
        self.ready_at = at
        if not tools and text:
            self._end_prompt(at)

    def _tool(self, tool: dict[str, Any], call: Span, at: float) -> None:
        call_id = str(tool.get("id") or f"{call.id}:{tool.get('name')}")
        name = str(tool.get("name") or "tool")
        args = tool.get("args") if isinstance(tool.get("args"), dict) else {}
        title = _claude_tool_title(name, args) or _line(str(tool.get("description") or ""), _TITLE_CHARS)
        started = _timestamp(tool.get("timestamp")) or at
        span = self.reader.add(Span(id=f"{self.key}:tool:{call_id}", kind=KIND_AGENT if name == "invoke_agent" else KIND_TOOL,
                                    name=name, title=title, start=started, parent=call.parent,
                                    input=self.reader.clip(_render(args)), preview=title))
        span.metadata = {"call": call.id, "callId": call_id}
        if span.name not in call.metadata.setdefault("tools", []):
            call.metadata["tools"].append(span.name)
        status = tool.get("status")
        if status in ("success", "error", "cancelled"):
            display = tool.get("resultDisplay")
            output = display if isinstance(display, str) and display else _gemini_result(tool.get("result"))
            span.output = self.reader.clip(output)
            span.preview = _line(output) or span.preview
            span.close(at, STATUS_OK if status == "success" else STATUS_INTERRUPTED if status == "cancelled"
                       else STATUS_ERROR)


def _gemini_text(content: Any) -> str:
    """Text of a Gemini message: a string, or `Part`s whose inline data and file parts become markers."""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        content = [content]
    if not isinstance(content, list):
        return _render(content)
    parts: list[str] = []
    for part in content:
        if isinstance(part, str):
            parts.append(part)
        elif isinstance(part, dict):
            if isinstance(part.get("text"), str):
                parts.append(part["text"])
            elif "inlineData" in part:
                parts.append("[image]" if str((part["inlineData"] or {}).get("mimeType", "")).startswith("image/")
                             else "[file]")
            elif "fileData" in part:
                parts.append("[file]")
    return "\n".join(item for item in parts if item)


def _gemini_result(result: Any) -> str:
    """A tool call's recorded result: the `functionResponse` parts sent back to the model."""
    texts = []
    for part in result if isinstance(result, list) else [result]:
        response = part.get("functionResponse") if isinstance(part, dict) else None
        if isinstance(response, dict):
            body = response.get("response")
            texts.append(_render(body.get("output") if isinstance(body, dict) and "output" in body else body))
        elif part is not None:
            texts.append(_gemini_text(part))
    return "\n".join(text for text in texts if text)


@dataclass
class _File:
    path: Path
    parser: _Parser
    offset: int = 0
    inode: int | None = None


class TraceReader:
    """One conversation's trace: the spans parsed so far from its sources, extended on each `sync`.

    Not thread-safe: `SessionTrace` serializes every access, and runs `sync` off the event loop.
    """

    def __init__(self, sources: Callable[[], Sequence[TraceSource]] | None, index: int) -> None:
        self.sources = sources
        self.prefix = f"c{index}"
        self.spans: dict[str, Span] = {}
        self.agent_tools: dict[str, str] = {}
        # Codex threads spawned by this conversation and their rollout, once it exists.
        self.codex_threads: dict[str, Path | None] = {}
        self.agent_meta: dict[str, dict[str, Any]] = {}
        self.agent_prompts: dict[str, str] = {}
        self.metadata: dict[str, Any] = {}
        self.title: str | None = None
        self.files: dict[Path, _File] = {}
        # Raw log files discovered so far (`TraceLog`s by path): what a log download streams.
        self.logs: dict[Path, TraceLog] = {}
        self.revision = 0
        self.prompts = 0
        self.truncated = False
        settings = get_settings()
        self._limit = settings.trace_max_spans
        self._clip = settings.trace_detail_chars
        self._sequence = 0

    # --- span table, used by the parsers ---

    def add(self, span: Span) -> Span:
        span.id = f"{self.prefix}:{span.id}"
        if span.parent is not None and not span.parent.startswith(self.prefix + ":") and not span.parent.startswith("agent:"):
            span.parent = f"{self.prefix}:{span.parent}"
        existing = self.spans.get(span.id)
        if existing is not None:
            return existing
        if len(self.spans) >= self._limit:
            self.truncated = True
            return span  # Detached: still updated by its parser, never published.
        self._sequence += 1
        span.sequence = self._sequence
        self.spans[span.id] = span
        return span

    def _key(self, span_id: str) -> str:
        return span_id if span_id.startswith(self.prefix + ":") else f"{self.prefix}:{span_id}"

    def get(self, span_id: str) -> Span | None:
        """A span by its parser-local id or its published one."""
        return self.spans.get(self._key(span_id)) if span_id else None

    def has(self, span_id: str) -> bool:
        return self._key(span_id) in self.spans

    def last_of(self, kind: str, key: str) -> Span | None:
        marker = f"{self.prefix}:{key}:"
        return next((span for span in reversed(self.spans.values())
                     if span.kind == kind and span.id.startswith(marker)), None)

    def next_prompt(self) -> int:
        self.prompts += 1
        return self.prompts

    def clip(self, text: str | None) -> str | None:
        return _clip(text, self._clip) if text else None

    # --- reading ---

    def sync(self) -> bool:
        """Parses what the sources appended since the last call; True when anything changed."""
        if self.sources is None:
            return False
        changed = False
        for source in self.sources():
            for path, root, parser in self._discover(source):
                self.logs.setdefault(path, TraceLog(root, path))
                changed |= self._read(path, parser)
        if changed:
            self.revision += 1
        return changed

    def _discover(self, source: TraceSource) -> Iterable[tuple[Path, Path, Callable[[], _Parser]]]:
        """Each log file under `source` with the root its download name is relative to, and its parser."""
        if source.format == "gemini":
            # `<GEMINI_CLI_HOME>/.gemini/tmp/<project>/chats/session-….jsonl`; a sub-agent's log sits in a
            # folder named after its parent conversation. Names keep the project folder.
            root = source.path.parents[2]
            yield source.path, root, lambda: _GeminiParser(self, source.path, "gemini")
            prefix = source.path.stem.rsplit("-", 1)[-1]
            for folder in sorted(source.path.parent.glob(f"{prefix}*")):
                if not folder.is_dir():
                    continue
                for path in sorted(folder.glob("*.jsonl")):
                    yield path, root, lambda path=path: _GeminiParser(self, path, f"a{path.stem[:8]}", path.stem)
            return
        if source.format == "codex":
            # `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-….jsonl`: names keep the date folders.
            sessions = source.path.parents[3]
            yield source.path, sessions, lambda: _CodexParser(self, source.path, "codex")
            # Threads spawned by the ones read so far (deeper spawns are found on the following reads).
            for thread, path in list(self.codex_threads.items()):
                if path is None:
                    path = next(iter(sorted(sessions.glob(f"*/*/*/rollout-*{thread}.jsonl"))), None)
                    self.codex_threads[thread] = path
                if path is not None:
                    yield path, sessions, lambda path=path, thread=thread: _CodexParser(
                        self, path, f"x{thread[-8:]}", thread)
            return
        if not source.path.is_dir():
            return
        mains: list[Path] = []
        agents: list[Path] = []
        for project in sorted(source.path.iterdir()):
            if not project.is_dir():
                continue
            mains.extend(sorted(project.glob("*.jsonl")))
            agents.extend(sorted(project.glob("*/subagents/agent-*.jsonl")))
        for path in mains:
            yield path, source.path, lambda path=path: _ClaudeParser(self, path, path.stem[:8], None)
        for path in agents:
            agent = path.stem.removeprefix("agent-")
            meta_path = path.with_name(f"{path.stem}.meta.json")
            self.logs.setdefault(meta_path, TraceLog(source.path, meta_path))
            if agent not in self.agent_meta:
                try:
                    self.agent_meta[agent] = json.loads(meta_path.read_text())
                except (OSError, ValueError):
                    pass
            yield path, source.path, lambda path=path, agent=agent: _ClaudeParser(
                self, path, f"a{agent[:8]}", agent)

    def _read(self, path: Path, make: Callable[[], _Parser]) -> bool:
        try:
            stat = path.stat()
        except OSError:
            return False
        tracked = self.files.get(path)
        if tracked is None or (tracked.inode is not None and tracked.inode != stat.st_ino) or stat.st_size < tracked.offset:
            tracked = self.files[path] = _File(path=path, parser=make(), inode=stat.st_ino)
        if stat.st_size == tracked.offset:
            return False
        with path.open("rb") as handle:
            handle.seek(tracked.offset)
            chunk = handle.read(stat.st_size - tracked.offset)
        end = chunk.rfind(b"\n")
        if end < 0:
            return False  # A line still being written.
        tracked.offset += end + 1
        for raw in chunk[: end + 1].splitlines():
            if not raw.strip():
                continue
            try:
                entry = json.loads(raw)
            except ValueError:
                continue
            if isinstance(entry, dict):
                tracked.parser.feed(entry)
        return True

    def freeze(self, keep: Path | None = None) -> None:
        """Keeps what was parsed and stops reading: the provider files may be deleted from now on.
        With `keep`, the raw logs are hard-linked (copied across file systems) there first, so they
        stay downloadable; without it they are no longer offered."""
        self.sources = None
        self.files.clear()
        logs, self.logs = self.logs, {}
        if keep is None:
            return
        for log in logs.values():
            source = log.resolved()
            if source is None:
                continue
            target = keep / log.name
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    os.link(source, target)
                except OSError:
                    shutil.copyfile(source, target)
            except OSError:
                continue
            self.logs[target] = TraceLog(keep, target)


class SessionTrace:
    """Every conversation one session held, oldest first: clearing a chat freezes its trace and starts
    the next one, so a platform chat's whole history stays inspectable for as long as the session lives."""

    def __init__(self) -> None:
        self._readers: list[TraceReader] = []
        self._lock = asyncio.Lock()
        self._cache: tuple[str, dict[str, Any]] | None = None

    def follow(self, sources: Callable[[], Sequence[TraceSource]]) -> None:
        self._readers.append(TraceReader(sources, len(self._readers) + 1))

    async def archive(self, keep: Path | None = None) -> None:
        """Freezes the current conversation before its runtime deletes its logs; `keep` is a directory the
        session owns (removed with it) where the raw logs stay downloadable."""
        async with self._lock:
            if self._readers and self._readers[-1].sources is not None:
                reader = self._readers[-1]
                target = keep / f"conversation-{len(self._readers)}" if keep is not None else None
                try:
                    await asyncio.to_thread(reader.sync)
                finally:
                    await asyncio.to_thread(reader.freeze, target)

    async def log_files(self) -> list[tuple[str, Path]]:
        """Every raw log the trace was built from as `(download name, file)`, oldest conversation first,
        names prefixed with `conversation-<n>/` when the session held several. Only regular files under the
        roots `trace_sources()` returned (or the archive copies made from them) are listed."""
        async with self._lock:
            readers = list(self._readers)
            if readers and readers[-1].sources is not None:
                await asyncio.to_thread(readers[-1].sync)
            entries = [(index, log) for index, reader in enumerate(readers, start=1)
                       for log in list(reader.logs.values())]

        def resolve() -> list[tuple[str, Path]]:
            files: list[tuple[str, Path]] = []
            for index, log in entries:
                path = log.resolved()
                if path is not None:
                    files.append((f"conversation-{index}/{log.name}" if len(readers) > 1 else log.name, path))
            return files

        return await asyncio.to_thread(resolve)

    async def snapshot(self, *, live: bool) -> dict[str, Any]:
        async with self._lock:
            readers = list(self._readers)
            if readers and readers[-1].sources is not None:
                await asyncio.to_thread(readers[-1].sync)
            revision = f"{len(readers)}.{sum(reader.revision for reader in readers)}.{int(live)}"
            if self._cache is not None and self._cache[0] == revision:
                return self._cache[1]
            payload = _build(readers, live=live, revision=revision)
            self._cache = (revision, payload)
            return payload

    async def detail(self, span_id: str) -> dict[str, Any] | None:
        async with self._lock:
            for reader in self._readers:
                span = reader.spans.get(span_id)
                if span is not None:
                    return {"id": span.id, "input": span.input, "output": span.output,
                            "metadata": {key: value for key, value in span.metadata.items() if value is not None}}
        return None


def _build(readers: Sequence[TraceReader], *, live: bool, revision: str) -> dict[str, Any]:
    """The published trace: spans in start order, sub-agents nested under the call that spawned them,
    each container stretched over its children. Stored spans are never mutated here."""
    spans = [span for reader in readers for span in reader.spans.values()]
    by_id = {span.id: span for span in spans}
    agent_parents: dict[str, str] = {}
    agent_meta: dict[str, dict[str, Any]] = {}
    for reader in readers:
        for agent, meta in reader.agent_meta.items():
            if isinstance(meta.get("toolUseId"), str):
                agent_parents[f"agent:{agent}"] = f"{reader.prefix}:{meta['toolUseId']}"
        for agent, tool in reader.agent_tools.items():
            if agent:
                agent_parents.setdefault(f"agent:{agent}", tool)
        for agent, meta in reader.agent_meta.items():
            tool = agent_parents.get(f"agent:{agent}")
            if tool:
                agent_meta[tool] = meta

    def parent_of(span: Span) -> str | None:
        parent = span.parent
        if parent and parent.startswith("agent:"):
            parent = agent_parents.get(parent)
        return parent if parent in by_id else None

    parents = {span.id: parent_of(span) for span in spans}
    reach: dict[str, float] = {}
    prompt_of: dict[str, str | None] = {}
    for span in spans:
        point = span.end if span.end is not None else span.start
        ancestor, prompt = parents[span.id], span.id if span.kind == KIND_PROMPT else None
        while ancestor is not None:
            if reach.get(ancestor, 0) < point:
                reach[ancestor] = point
            if by_id[ancestor].kind == KIND_PROMPT:
                prompt = ancestor
            ancestor = parents.get(ancestor)
        prompt_of[span.id] = prompt
    last_prompt = max((span for span in spans if span.kind == KIND_PROMPT and parents[span.id] is None),
                    key=lambda span: (span.start, span.sequence), default=None)
    current_prompt = last_prompt.id if last_prompt is not None and live else None
    children: dict[str, list[Span]] = {}
    for span in spans:
        if parents[span.id] is not None:
            children.setdefault(parents[span.id], []).append(span)

    def status(span: Span) -> str:
        if span.kind == KIND_TURN:
            # A turn lasts while its model call or any tool it requested does; a failed tool stays its own error.
            states = {status(child) for child in children.get(span.id, ())}
            for state in (STATUS_RUNNING, STATUS_INTERRUPTED, STATUS_INCOMPLETE):
                if state in states:
                    return state
            failed = any(child.kind == KIND_LLM and child.status == STATUS_ERROR for child in children.get(span.id, ()))
            return STATUS_ERROR if failed else STATUS_OK
        if span.status != STATUS_RUNNING:
            return span.status
        if span.kind == KIND_PROMPT:
            return STATUS_RUNNING if span.id == current_prompt else STATUS_OK
        if span.end is not None:
            return STATUS_OK
        return STATUS_RUNNING if current_prompt and prompt_of.get(span.id) == current_prompt else STATUS_INCOMPLETE

    rows: list[dict[str, Any]] = []
    for span in sorted(spans, key=lambda item: (item.start, item.sequence)):
        current = status(span)
        end = span.end
        if span.id in reach and (span.kind in (KIND_PROMPT, KIND_TURN, KIND_AGENT, KIND_SKILL) or end is None):
            end = max(end or span.start, reach[span.id])
        if span.kind in (KIND_PROMPT, KIND_TURN) and end is None:
            end = span.start
        row: dict[str, Any] = {"id": span.id, "parentId": parents[span.id], "kind": span.kind, "name": span.name,
                               "status": current, "startMs": round(span.start * 1000),
                               "endMs": None if current == STATUS_RUNNING or end is None else round(end * 1000)}
        meta = agent_meta.get(span.id)
        if meta and meta.get("agentType"):
            row["name"] = str(meta["agentType"])
        for key, value in (("title", span.title), ("model", span.model), ("usage", span.usage),
                           ("stopReason", span.stop_reason), ("preview", span.preview)):
            if value:
                row[key] = value
        rows.append(row)
    return {"revision": revision, "live": live,
            "title": next((reader.title for reader in reversed(readers) if reader.title), None),
            "conversations": len(readers), "truncated": any(reader.truncated for reader in readers),
            "metadata": {key: value for reader in readers for key, value in reader.metadata.items()},
            "summary": _summary(rows), "spans": rows}


def _summary(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    totals = {"input": 0, "cacheRead": 0, "cacheWrite": 0, "output": 0, "reasoning": 0}
    models: dict[str, dict[str, Any]] = {}
    tools: dict[str, dict[str, Any]] = {}
    counts = {kind: 0 for kind in (KIND_PROMPT, KIND_TURN, KIND_LLM, KIND_TOOL, KIND_AGENT, KIND_SKILL, KIND_HOOK,
                                   KIND_CONTEXT, KIND_COMPACTION, KIND_EVENT)}
    errors = 0
    peak = 0
    starts = [row["startMs"] for row in rows]
    ends = [row["endMs"] for row in rows if row.get("endMs")]
    by_id = {row["id"]: row for row in rows}

    def nested(row: dict[str, Any]) -> bool:
        parent = row.get("parentId")
        while parent:
            ancestor = by_id.get(parent)
            if ancestor is None:
                return False
            if ancestor["kind"] == KIND_AGENT:
                return True
            parent = ancestor.get("parentId")
        return False

    for row in rows:
        kind = row["kind"]
        counts[kind] = counts.get(kind, 0) + 1
        if row["status"] == STATUS_ERROR and kind != KIND_TURN:  # A failed turn is its failed model call.
            errors += 1
        usage = row.get("usage")
        if kind == KIND_LLM and usage:
            for key in totals:
                totals[key] += usage.get(key, 0)
            model = row.get("model") or "unknown"
            stats = models.setdefault(model, {"model": model, "calls": 0, "input": 0, "cacheRead": 0,
                                              "cacheWrite": 0, "output": 0})
            stats["calls"] += 1
            for key in ("input", "cacheRead", "cacheWrite", "output"):
                stats[key] += usage.get(key, 0)
            if not nested(row):
                peak = max(peak, usage.get("context", 0))
        if kind in (KIND_TOOL, KIND_AGENT, KIND_SKILL):
            name = row["name"] if kind == KIND_TOOL else f"{'Sub-agent' if kind == KIND_AGENT else 'Skill'}: {row['name']}"
            stats = tools.setdefault(name, {"name": name, "kind": kind, "calls": 0, "errors": 0, "durationMs": 0})
            stats["calls"] += 1
            stats["errors"] += row["status"] == STATUS_ERROR
            if row.get("endMs"):
                stats["durationMs"] += max(0, row["endMs"] - row["startMs"])
    prompt = totals["input"] + totals["cacheRead"] + totals["cacheWrite"]
    return {
        "startMs": min(starts) if starts else None,
        "endMs": max(ends) if ends else None,
        "counts": counts,
        "errors": errors,
        "tokens": {**totals, "total": prompt + totals["output"]},
        "cacheHitRate": totals["cacheRead"] / prompt if prompt else None,
        "peakContext": peak or None,
        "models": sorted(models.values(), key=lambda item: -item["calls"]),
        "tools": sorted(tools.values(), key=lambda item: (-item["calls"], item["name"]))[:40],
    }


def codex_rollout(home: Path, thread_id: str, known: str | None = None) -> Path | None:
    """The rollout file of one Codex thread: the path the app-server reported, else found by its id."""
    if known and os.path.isfile(known):
        return Path(known)
    sessions = home / "sessions"
    if not thread_id or not sessions.is_dir():
        return None
    return next(iter(sorted(sessions.glob(f"*/*/*/rollout-*{thread_id}.jsonl"), reverse=True)), None)
