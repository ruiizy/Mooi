# Plan: Agent traces (observability tab)

Self-contained implementation plan. A fresh session resumes from this file **alone**: trust it, do not
re-analyze what is already decided here, do not re-read files beyond the anchors a task names.

## How to work with this plan (session protocol)

1. Read this file, then go straight to the first task in *Task board* that is not `done`.
2. Work tasks in order. After each task: set its status, add one line to *Progress log* (what changed,
   files, anything the next task must know). Keep the file truthful at every moment: a session may be
   stopped at any time.
3. When the user stops the session (context budget reached), first bring this file up to date, then
   commit all work of the session (one commit, conventional message `feat(traces): …`, ending with the
   attribution lines the system reminder gives). The next fresh session starts from that commit.
4. Decisions already made are in *Decisions*: never reopen them. A new decision goes there with its reason.
5. When every task is `done`: remove the *Current work* section from `AGENTS.md`, and update the
   *Context* section of `AGENTS.md` with the trace capability (one bullet under *Development sessions*).

## Goal

Debugging an agent must be easy everywhere Mooi runs one: development sessions, the first dev
deployment setup (it runs in the session chat), production deployment chats and backup chats. Each
gets a **Trace** tab that shows, like Langfuse / LangSmith, every internal step of the agent: turns,
LLM calls with input/output/cache/reasoning tokens per request, context size per request, tool calls
with input/output and duration, sub-agents (nested), skills, hooks, context injected into the model,
compactions and errors. It works with every adapter: Claude SDK, Claude CLI and Codex SDK.

## Functional requirements

- FR1 **Trace tab** next to the existing tabs:
  - Development session (`SessionWorkspace`): tabs Conversation · Changes · Files · Preview → add **Trace**.
  - Production page and Backup page: add **Trace** whenever their chat exists (same rule as the Chat tab).
- FR2 **Summary strip** (KPIs): duration, prompts, turns, tool calls, sub-agents, errors, total tokens
  (input / cache read / cache write / output / reasoning), cache-hit rate, peak context.
- FR3 **Timeline** (default view): an expandable tree of spans (prompt → turns, hooks, context, events; turn →
  its one LLM call and the tools / sub-agents / skills it requested; sub-agent → its own turns) with a waterfall bar per row on a shared time axis, kind icon
  and colour, status (running spinner / ok / error / interrupted / incomplete), duration, token badge
  on LLM rows, model badge.
- FR4 **Filters**: chips per kind (LLM, Tools, Sub-agents, Skills, Hooks, Context, Events), "Errors only",
  text search (name, title, preview). Expand all / collapse all.
- FR5 **Inspector**: selecting a span shows its header (kind, name, status, start offset, duration),
  metrics (model, stop reason, every token count, context), **Input**, **Output** and **Metadata**
  sections with copy buttons and pretty JSON. Full detail loads on demand.
- FR6 **Insights** view: context size per LLM call (stacked bars: cache read / cache write / new input,
  plus output), tokens per model, tools ranked by calls and by time, errors.
- FR7 **Live**: while the agent works the trace updates by itself (new spans appear, running spans tick).
- FR8 A cleared conversation's trace stays visible (conversations are listed oldest first); the trace
  lives as long as the session.
- FR9 Empty / unavailable states: no steps yet; adapter without a log; trace truncated (limit reached).
- FR10 **Download log**: the Trace header downloads the raw agent session logs the trace was built from (one
  `.jsonl` as-is, several in one `.zip` keeping relative paths), for every adapter and every conversation shown.

## Non-functional requirements

- **Efficiency**: zero cost while nobody looks (parse on request only); each request parses only bytes
  appended since the last one; payload cached per revision; unchanged revision answers `204` without a
  body; span list stays light (full input/output only through the detail endpoint).
- **Scalability**: bounded memory (`TRACE_MAX_SPANS`, `TRACE_DETAIL_CHARS`); the SPA renders thousands
  of rows smoothly (windowed list, fixed row height); refetch throttled.
- **Security / isolation**: endpoints go through `get_registry().get_for(caller, id)` (404 for other
  players); nothing new reaches the repository; no secret is added to a payload (logs hold the agent's
  own content only; tokens/credentials are env, never in the logs).
- **Maintainability**: provider-neutral contract; a provider adds a `TraceSource` + a parser, nothing else.
  The sessions feature stays one file (`features/sessions.py`) importing only `shared/` aspects.
- **No regressions**: existing tabs, streams and runtimes behave the same; type check, ruff and build pass.
- **UX**: enterprise, modern, a bit interactive; desktop and phone first-class: no horizontal page
  overflow, compact pills (`formatCount`), long names truncated with full text in titles, safe-area
  insets, touch targets ≥ 44px, bottom-sheet inspector with swipe-down to dismiss and swipe left/right
  for previous/next span; keyboard on desktop (↑/↓ select, ←/→ collapse/expand, Enter open, Esc close).
  Light and dark themes through existing tokens only.

## Decisions (do not reopen)

- D1 **Source = the provider's native JSONL session log**, not instrumentation of the event stream: it
  holds per-request usage, sub-agent work, hooks and injected context that the domain events never carry.
- D2 Log locations (verified):
  - Claude SDK and Claude CLI adapters both pass `CLAUDE_CONFIG_DIR = self._config_dir` (a temp dir in
    the session directory). The CLI writes `<config_dir>/projects/<cwd-slug>/<session-id>.jsonl` and
    sub-agents in `<…>/<session-id>/subagents/agent-<agentId>.jsonl` + `agent-<agentId>.meta.json`
    (`{"agentType","description","toolUseId"}`). The SDK's `session_store` is only a mirror; local files
    are always written. SDK compaction (`compact()`) forks into a new file whose copied entries carry
    `forkedFrom` (skipped; the new part is shown as a "Compaction summary" turn).
  - Codex: per-account `CODEX_HOME` (`codex.Account.home`, shared by sessions of the account, deleted on
    last release) holds `sessions/YYYY/MM/DD/rollout-<ts>-<thread_id>.jsonl`. `thread_start` returns
    `thread.path` ([UNSTABLE] field); fallback glob via `traces.codex_rollout(home, thread_id, known)`.
- D3 Runtime contract: every `AgentRuntime` gets `trace_sources() -> Sequence[TraceSource]` (cheap, called
  on each sync; may return `[]` before the conversation exists).
- D4 Session keeps a `SessionTrace` (list of conversations). Replacing the runtime (clear conversation)
  calls `await session.trace.archive()` **before** `previous.close()` (files are deleted on close), then
  `session.trace.follow(new_runtime.trace_sources)`.
- D5 Live updates reuse the existing session SSE: the SPA refetches `GET …/trace?revision=<last>`
  (throttled ≈1.2 s) when the session's `lastSeq` changes while the Trace tab is visible; one more fetch
  when the session becomes idle. No new stream.
- D6 Cost is not shown (OAuth subscription accounts; not in the logs). Tokens are.
- D7 Tab label **Trace**, icon `Activity` (lucide). Feature folder `spa-mooi/src/features/traces/`.
- D8 Verification without credentials: there is no `MOOI_DEVELOPMENT_CLAUDE_TOKEN` / `CODEX_AUTH_JSON` in
  `.env.local` and Docker is not running, so the full stack cannot run an agent locally. Verify with a
  **temporary dev harness** (removed afterwards, never committed): a script runs the real `traces.py`
  over real local logs (`~/.claude/projects/<project>/<session>.jsonl` for Claude, `~/.codex/sessions/**`
  for Codex) and writes JSON to the scratchpad; a DEV-only page renders the real `TracePanel` with that
  JSON in the browser pane, desktop and mobile (375×812), light and dark. The user asked for this visual
  test explicitly (overrides the default "do not drive the app" rule for this feature). Full end-to-end
  needs `MOOI_DEVELOPMENT_CLAUDE_TOKEN` (from `claude setup-token`) in `.env.local` + `make up`; offer it
  to the user, never invent it. Point the harness at **one session file's directory copy**, not a whole
  projects folder (a whole folder hits `TRACE_MAX_SPANS`).
- D9 Filter semantics (F1): an active filter (kinds / errors / search) shows matches plus their ancestors and
  ignores the collapsed set on that path, so a match is never hidden; without a filter, collapse applies.
  Orphan spans (parent cut by the span cap) become roots. Reason: search must always reveal its hits.
- D10 Hooks (F2): span detail is cached per `spanId@revision`; callers pass the trace revision only while the
  span runs and `null` once finished (read once, never on every trace refresh). The swipe hook needs
  `touch-action: pan-y` on the sheet (`none` on the grabber) or the browser cancels horizontal swipes to
  scroll. A `useTraceClock(running)` hook ticks `now` each second for running spans (FR7) without
  re-rendering finished traces. Reason: light payloads and smooth gestures (NFR efficiency / UX).
- D11 Timeline interaction (F3): clicking a row selects it **and** opens the inspector; ↑/↓ only move the
  selection (an open inspector follows it). The **Events** chip filters `event` + `compaction`; turns have no chip
  (they show as parents of matches). While a filter is active rows render expanded and chevrons/←/→ do nothing
  (D9 ignores the collapsed set). Rows stay 40px on every screen (fixed height keeps windowing exact; the whole
  full-width row is the touch target). Reason: one predictable model for pointer, touch and keyboard.
- D12 Inspector (F4): pane vs sheet is chosen in JS (`useWideLayout`, `lg` = 64rem), not CSS, so only one copy
  mounts and the span detail is read once. Previous/next = neighbouring `rows` (buttons ↑/↓ in the header + swipe
  right/left on phones). The sheet's header is `touch-none` (swipe down always works there); its content is
  `touch-pan-y` and closes on swipe down only when scrolled to the top. Metadata starts collapsed. Reason: one
  mounted inspector, predictable gestures that never fight scrolling.
- D13 Insights (F5): the context chart shows **main-conversation** requests by default (a Main / With sub-agents
  switch appears when the trace has sub-agents), matching `peakContext`; above 240 requests consecutive ones are
  bucketed and each bar is the bucket's largest request. Bars are plain SVG (no chart dependency) filled with
  tokens: cache read `info-dot`, cache write `accent-dot`, new input `brand`, output `success-dot` (same parts in the
  model table). Hover previews, click/tap pins, ←/→ move; "Open in timeline" (and every error row) switches to the
  Timeline, expands the span's ancestors and opens the inspector. Reason: sub-agent prompts would distort the main
  context curve; bucketing by peak keeps thousands of calls light without hiding spikes.
- D14 Claude background tasks (E2E): a `<task-notification>` user entry (`origin.kind = task-notification`,
  e.g. a background sub-agent finishing) is an `event` span "Background task finished" inside the current prompt,
  not a new prompt; its text feeds the next model call's input. A model call starts at Claude Code's `api-request`
  entry when the log has one (after context is attached), else at the previous user/tool-result entry. Reason: the
  user typed one prompt, so the trace shows one prompt; model latency excludes context assembly.
- D15 Prompt / turn model (user decision, supersedes "turn = user message"): a **prompt** (`kind: prompt`) is one
  user request (Langfuse trace); a **turn** (`kind: turn`) is one agent-loop iteration, the unit agent SDKs count in
  `max_turns`: exactly one LLM call (Langfuse generation) plus the tool, sub-agent and skill calls it requested,
  nested under the turn. Turns are numbered per prompt (per sub-agent inside a sub-agent); hooks, context and
  events stay at prompt level, tool hooks under their tool. A turn has no data of its own: it lasts from its call's
  start to its last child's end, is running / interrupted / incomplete when a child is, else errors only when its
  model call failed. Claude: one turn per assistant `message.id`; Codex: one per response (closed by its
  `token_usage_record`, or `token_count` before records exist). The LLM call's output lists each tool call with its
  arguments. Summary strip: Prompts and Turns (= LLM calls, so no separate LLM KPI); error totals skip turns (a
  failed turn is its failed call). Reason: the user's definition, matching OpenAI / Claude Agent SDK turns and
  Langfuse observation types.
- D16 Codex sub-agents: `spawn_agent` starts a thread with its own rollout. The parent's `SubAgentActivity`
  (`kind: started`, `id` = the spawn call id, `agent_thread_id`) links them; the child rollout is found by thread id
  in the same `sessions/` tree and read like Claude's sub-agent transcripts: its copy of the parent's history is
  skipped up to its first `task_started` carrying `turn_attribution.parent_turn_id`, and its turns nest under the
  spawn span, named after the `agent_path` leaf.
- D17 Raw log download (FR10): `GET /sessions/{id}/trace/logs` (owner-checked like the other trace endpoints; the
  SPA calls `mic-sessions` directly through `sessionsFetch`, so there is no `mic-mooi` proxy). A `TraceReader` records
  every file its `_discover` found (`TraceLog(root, path)`: Claude main + sub-agent `.jsonl` and `.meta.json` relative
  to the `projects` dir, Codex rollouts relative to `sessions/`); only regular, non-symlink files resolving under their
  root are served. Clearing a chat hard-links (copies across file systems) the frozen conversation's logs to
  `<session dir>/trace-logs/conversation-<n>/` before the runtime deletes them, so they are removed with the
  workspace. One file streams as-is (`application/x-ndjson`), several as one deflated `.zip` built while sent
  (`conversation-<n>/` prefixes when the session held several); each file is read up to its size when opened (live
  logs grow). Name `mooi-trace-<session id 8>-<UTC yyyymmdd-hhmmss>.<ext>`; `Content-Disposition` is exposed by CORS.
  The SPA fetches it as a blob (token never in a URL): header button icon + "Download log" from `sm`, icon only on
  phones, spinner while downloading, dismissible error banner. Reason: study the exact source, no new storage beyond
  the session's own directory.

## Technical specification

### Backend — `mic-sessions` (Python 3.13, FastAPI)

**`src/mic_sessions/shared/traces.py`** — DONE (lint clean, verified on real Claude and Codex logs).
Public API:
- `TraceSource(format: "claude" | "codex", path: Path)` — Claude: the `projects` dir; Codex: the rollout file.
- `SessionTrace()`: `follow(sources_callable)`, `await archive()`, `await snapshot(live: bool) -> dict`,
  `await detail(span_id) -> dict | None`. Serialized by an `asyncio.Lock`; file reads run in `asyncio.to_thread`.
- `codex_rollout(home, thread_id, known=None) -> Path | None`.
- Internals: `TraceReader` (per conversation, prefix `c<n>:`, incremental offsets per file, inode/size
  reset detection, partial last line kept), `_ClaudeParser`, `_CodexParser`, `_build`, `_summary`.

Settings added in `shared/env.py` (DONE): `trace_max_spans=5000`, `trace_detail_chars=8000`
(env `TRACE_MAX_SPANS`, `TRACE_DETAIL_CHARS`). Added to `mic-sessions/.env.example` (B1, DONE).

Wire contract — `GET /sessions/{id}/trace?revision=<str>`:
- `204` when `revision` equals the current one; else `200`:
```json
{
  "revision": "1.42.1", "live": true, "title": "…|null", "conversations": 1, "truncated": false,
  "metadata": {"cli_version": "…"},
  "summary": {
    "startMs": 0, "endMs": 0,
    "counts": {"turn":0,"llm":0,"tool":0,"agent":0,"skill":0,"hook":0,"context":0,"compaction":0,"event":0},
    "errors": 0,
    "tokens": {"input":0,"cacheRead":0,"cacheWrite":0,"output":0,"reasoning":0,"total":0},
    "cacheHitRate": 0.93, "peakContext": 120000,
    "models": [{"model":"…","calls":0,"input":0,"cacheRead":0,"cacheWrite":0,"output":0}],
    "tools":  [{"name":"Bash","kind":"tool|agent|skill","calls":0,"errors":0,"durationMs":0}]
  },
  "spans": [{
    "id": "c1:…", "parentId": "c1:…|null",
    "kind": "turn|llm|tool|agent|skill|hook|context|compaction|event",
    "name": "…", "status": "running|ok|error|interrupted|incomplete",
    "startMs": 0, "endMs": 0,
    "title": "?", "model": "?", "stopReason": "?", "preview": "? ≤160 chars",
    "usage": {"input":0,"cacheRead":0,"cacheWrite":0,"output":0,"reasoning":0,"context":0}
  }]
}
```
Spans are sorted by `startMs`; `endMs` is `null` while running. `usage.input` is non-cached input;
`usage.context` is the whole prompt (input + cache read + cache write) = context size of that request.

`GET /sessions/{id}/trace/spans/{span_id}` → `{"id","input": str|null, "output": str|null, "metadata": {}}`
or 404. `span_id` contains `:` — declare the path param as `{span_id:path}`.

`live` = `session.status in (STATUS_WORKING, STATUS_WAITING, STATUS_COMPACTING)`.

**Runtime wiring — `src/mic_sessions/shared/agents.py`** (task B2):
- Protocol `AgentRuntime` (≈ line 273): add `def trace_sources(self) -> Sequence[TraceSource]: ...` with a
  docstring; mention it in the module docstring's "Adding a provider" list. `from mic_sessions.shared.traces import TraceSource`.
- `ClaudeAgentRuntime` and `ClaudeCliAgentRuntime`: `return [TraceSource("claude", self._config_dir / "projects")] if self._config_dir else []`.
- `CodexAgentRuntime`: store `self._thread_path = None` in `__init__`; in `_load_thread` (≈ line 2118)
  keep `thread = (await client.call("thread_start", params)).thread`, set `self._thread_id = thread.id`
  and `self._thread_path = getattr(thread, "path", None)`; `trace_sources()` returns
  `[TraceSource("codex", path)]` with `path = traces.codex_rollout(self._account.home, self._thread_id, self._thread_path)`
  when account and thread exist (cache the found path in `self._thread_path`), else `[]`.

**Session wiring — `src/mic_sessions/features/sessions.py`** (task B3):
- `from mic_sessions.shared import traces` (shared import list ≈ line 63).
- `Session` dataclass (≈ line 689): `trace: traces.SessionTrace = field(default_factory=traces.SessionTrace, repr=False)`.
- `_provision` (≈ line 1316): after `session.runtime = runtime` → `session.trace.follow(runtime.trace_sources)`.
- `_reset_conversation` (≈ line 2053): before `await previous.close()` → `await session.trace.archive()`;
  after `session.runtime = runtime` → `session.trace.follow(runtime.trace_sources)`.
- Endpoints next to `get_changes` (≈ line 1944), same style (`Annotated[Caller, Depends(current_caller)]`),
  returning `dict[str, Any]` / `Response(status_code=204)`; detail 404 via `ApiException.not_found("Span not found")`.
- Check other places that create or close runtimes: `rg -n "create_runtime\(|runtime.close\(" features/sessions.py`
  (known: `_provision`, `_reset_conversation`, `_cleanup_workspace` — the last one needs no archive: the session is going away).

### Frontend — `spa-mooi` (React 19, TS, Tailwind v4, zustand, lucide)

Conventions (follow strictly): one type per file in `types/`, one function per file in `lib/`, API in
`api/`, hooks in `hooks/`, components in `components/`; `@/` alias; `cn()` from `@/shared/utils/cn`;
tokens only (`bg-surface`, `bg-surface-2`, `text-ink`, `text-ink-muted`, `text-ink-subtle`, `border-line`,
`bg-brand-soft`, `*-success|warning|danger|info|accent` + `-soft` / `-dot`, `rounded-chip|control|card|panel`,
`shadow-raised|pop`, `animate-fade-up|sheet-in`); `sessionsFetch` for calls; `apiErrorMessage` for errors;
`formatCount` for compact pills; existing `Tabs`, `SegmentedControl`, `EmptyState`, `CopyButton`, `IconButton`.

Kind palette: turn = ink, llm = brand/info, tool = success, agent = accent, skill = warning,
hook = ink-subtle, context = info (muted), compaction = warning, event = danger if error else ink-subtle.

Files to create in `src/features/traces/`:
- `types/`: `AgentTrace.ts`, `TraceSpan.ts`, `TraceSpanKind.ts`, `TraceSpanStatus.ts`, `TraceUsage.ts`,
  `TraceSummary.ts`, `TraceModelStat.ts`, `TraceToolStat.ts`, `TraceSpanDetail.ts`, `TraceFilter.ts`, `TraceNode.ts`.
- `api/tracesApi.ts`: `fetchTrace(sessionId, revision?) → AgentTrace | null` (null on 204),
  `fetchTraceSpan(sessionId, spanId) → TraceSpanDetail` (encode the id with `encodeURIComponent`).
- `hooks/useAgentTrace.ts(sessionId, active)`: initial fetch when active; watches
  `useSessionsStore(s => s.byId[sessionId]?.lastSeq)` and session status; throttled refetch with
  `revision`; keeps last data on error; `useTraceSpanDetail.ts(sessionId, spanId, revision)`;
  `useTraceKeyboard.ts`; `useSwipeGestures.ts` (pointer events, threshold 60px, vertical vs horizontal lock).
- `lib/`: `buildTraceTree.ts` (spans → nodes with depth, children, descendant counts),
  `flattenTraceTree.ts` (visible rows given collapsed set + filters + search; ancestors of matches stay),
  `traceKindStyle.ts` (icon + classes per kind), `formatTokens.ts`, `formatSpanDuration.ts` (ms → "820ms", "4.2s", "3m 05s"),
  `spanDuration.ts` (uses now for running), `traceTimeScale.ts`.
- `components/`: `TracePanel.tsx` (root, lazy-loaded; header with summary + view switch Timeline/Insights,
  filters, body, inspector), `TraceSummaryStrip.tsx` (horizontal scroll on phones, KPI cards),
  `TraceToolbar.tsx` (search, kind chips with counts, errors toggle, expand/collapse),
  `TraceTimeline.tsx` (windowed list, row height 40px, overscan 8, time axis header),
  `TraceRow.tsx` (indent guides, chevron, icon, name + title, badges, duration; desktop: waterfall
  column 38% wide; phone: 3px bar under the label), `TraceInspector.tsx` (desktop right pane 420px,
  `lg:` breakpoint; phone bottom sheet portal with grabber, swipe down to close, swipe left/right = next/prev),
  `TraceDetailSection.tsx` (collapsible Input/Output/Metadata, monospace, copy), `TraceInsights.tsx`
  (`ContextChart` SVG bars per LLM call with tooltip/tap, model table, tool bars), `TraceEmptyState.tsx`.
- Integration:
  - `features/sessions/types/WorkspacePane.ts`: add `'trace'`; `SessionWorkspace.tsx`: add tab item and a
    lazy `TracePanel` section (mount once visited, `active` prop = visible), extend `selectPane` guard.
  - `features/production/types/ProductionTab.ts` and `features/backups/types/BackupTab.ts`: add `'trace'`;
    `pages/ProjectDeploymentPage.tsx` and `pages/ProjectBackupPage.tsx`: tab `{ id: 'trace', label: 'Trace', icon: Activity }`
    when `chat` exists, render `<TracePanel sessionId={chat.id} active={tab === 'trace'} />` lazily.

## Task board

Status: `todo` · `doing` · `done`. Exactly one `doing` at a time.

| # | Task | Status |
|---|------|--------|
| B0 | `shared/traces.py` + settings in `env.py` | done |
| B1 | Add `TRACE_MAX_SPANS` / `TRACE_DETAIL_CHARS` to `mic-sessions/.env.example` | done |
| B2 | `trace_sources()` on the protocol and the 3 runtimes (`agents.py`) | done |
| B3 | Session wiring + 2 endpoints (`features/sessions.py`) | done |
| B4 | Backend checks: `uvx ruff check src` (only new findings matter; `env.py` has a pre-existing I001), import check `python -c "import mic_sessions.main"` with 32-byte `SERVICE_TOKEN`/`JWT_SECRET` env | done |
| F1 | Traces types + API + `lib/` helpers | done |
| F2 | `useAgentTrace`, `useTraceSpanDetail`, keyboard + swipe hooks | done |
| F3 | `TracePanel`, summary strip, toolbar, timeline + rows (windowed) | done |
| F4 | Inspector (desktop pane + phone bottom sheet with gestures) + detail sections | done |
| F5 | Insights view (context chart, models, tools) | done |
| F6 | Tab integration: session workspace, production page, backup page | done |
| F7 | `cd spa-mooi && bun run build` (tsc + vite) passes | done |
| V1 | Temporary harness (see D8): JSON from real logs → DEV page; check desktop + mobile, light + dark, gestures, overflow; fix issues | done |
| V2 | Remove harness, final build/lint, update `AGENTS.md` Context, remove *Current work* pointer, report | done |

## Progress log

- Session 1: analysis done; `shared/traces.py` written (≈1000 lines) and `env.py` settings added.
  Verified on real logs: a Codex rollout → 263 spans (8 turns, 132 LLM calls, 123 tools, 25.9M tokens);
  a whole Claude projects folder → hit the 5000-span cap (1,756 LLM calls, 1,865 tools, 934 hooks,
  5 skills, 3 compactions). Sub-agent nesting not yet confirmed on a real sub-agent log (V1 must check it:
  use `~/.claude/projects/-Users-mydherin-projects-mydherin-MyBank/02f0db88-575b-424e-b869-98f76a631140*`,
  which has one sub-agent). Nothing else wired; not committed.
- B1: `TRACE_MAX_SPANS=5000` / `TRACE_DETAIL_CHARS=8000` added to `mic-sessions/.env.example` under
  *Sessions* (after `SSE_HEARTBEAT_SECONDS`, same order as `env.py`). Next: B2.
- B2: `agents.py` — `AgentRuntime.trace_sources()` (docstring + step 6 of "Adding a provider"),
  top-level `from mic_sessions.shared.traces import TraceSource, codex_rollout` (no cycle: traces imports
  only `env`). Claude SDK/CLI return `[TraceSource("claude", _config_dir / "projects")]` or `[]` (after
  `close()` `_config_dir` is `None`, so archive must run before close — D4). Codex keeps `_thread_path`
  from `thread_start` (`getattr(thread, "path", None)`), `trace_sources()` caches the found path as str;
  `[]` without account/thread. Ruff: same 9 pre-existing findings as HEAD; module imports. Next: B3.
- B3: `features/sessions.py` — `traces` imported; `Session.trace` (default `SessionTrace`); `_provision` and
  `_reset_conversation` call `session.trace.follow(runtime.trace_sources)` after `session.runtime = runtime`;
  `_reset_conversation` archives before `previous.close()` (archive errors logged, never block the clear).
  Endpoints (after `get_changes`, both owner-checked via `get_registry().get_for(caller, id)`):
  `GET /sessions/{id}/trace?revision=` → `200` snapshot dict (wire contract above) or `204` when `revision`
  matches; `GET /sessions/{id}/trace/spans/{span_id:path}` → `{"id","input","output","metadata"}` or `404
  "Span not found"`. SPA calls them through the same sessions API base as `…/changes` (F1). Ruff: no new
  findings in `sessions.py` (6 before, 6 after); `import mic_sessions.main` OK. Next: B4.
- B4: `uvx ruff check src` → 25 findings, identical (file + rule + message) to the pre-B0 baseline `aeb37ab`;
  `shared/traces.py` clean. `import mic_sessions.main` (+ `shared.traces`) OK with 32-byte env. Review of
  B0–B3 diffs: signatures match (`follow`/`archive`/`snapshot(live=)`/`detail`, `codex_rollout`,
  `codex.Account.home`), file I/O runs in `asyncio.to_thread`; no fixes needed, no code changed. Next: F1.
- F1: `spa-mooi/src/features/traces/` — `types/` (one per file): `AgentTrace`, `TraceSpan`, `TraceSpanKind`,
  `TraceSpanStatus`, `TraceUsage`, `TraceSummary` (startMs/endMs/cacheHitRate/peakContext nullable),
  `TraceModelStat`, `TraceToolStat`, `TraceSpanDetail`, `TraceFilter` `{kinds, errorsOnly, query}`, `TraceNode`
  `{span, depth, children, descendants}`, + `TraceTimeScale`, `TraceKindStyle`. `api/tracesApi.ts`:
  `fetchTrace(sessionId, revision?) → AgentTrace | null` (204 → null), `fetchTraceSpan(sessionId, spanId)`.
  `lib/`: `buildTraceTree(spans) → TraceNode[]` (roots), `flattenTraceTree(roots, collapsed: ReadonlySet<string>,
  filter) → TraceNode[]` (D9), `spanMatchesFilter`, `isTraceFilterActive`, `traceKindStyle(kind, status?) →
  {icon, label, text, chip, bar}`, `formatTokens(n|null)`, `formatSpanDuration(ms)`, `spanDuration(span, now)`,
  `traceTimeScale(startMs, endMs, tickCount=5) → {startMs, endMs, durationMs, percent(ms), ticks}` (ticks = offsets
  from start). `bunx tsc -b` passes (no ESLint config in `spa-mooi`). Next: F2.
- F2: `spa-mooi/src/features/traces/hooks/` — `useAgentTrace(sessionId, active) → {trace, error, loading, live,
  refresh}` (fetch on show, throttled 1.2 s refetch with `revision` on `lastSeq` / live↔idle change, last data
  kept on error, reset per session, nothing while hidden); `useTraceSpanDetail(sessionId, spanId|null,
  revision|null) → {detail, loading, error, retry}` (D10); `useTraceClock(running, intervalMs=1000) → now`;
  `useTraceKeyboard({enabled, rows, selectedId, collapsed, onSelect, onCollapsedChange(id, collapsed), onOpen,
  onClose})` (window keydown, skips fields/modifiers); `useSwipeGestures(element|null, {onSwipeLeft,
  onSwipeRight, onSwipeDown, onDrag(axis, offset), onDragEnd, canSwipeDown, threshold=60})` (axis lock at
  10px, pointer capture only once locked). `bunx tsc -b` passes. Next: F3.
- F3: `components/` — `TracePanel({sessionId, active})` (named export only; F6 lazy-loads it with
  `lazy(() => import(…).then((m) => ({ default: m.TracePanel })))`; keyed by session so state resets) = header (title,
  live dot, conversations, `SegmentedControl` Timeline/Insights, refresh) → `TraceSummaryStrip({summary, live, now})`
  → truncated / error banners → body grid. `TraceToolbar({filter, onFilterChange, counts, errors, onExpandAll,
  onCollapseAll})`, `TraceTimeline({rows, scale, now, selectedId, collapsed, onSelect, onToggle})` (windowed, 40px,
  overscan 8, sticky axis from `lg`, keeps selection in view), `TraceRow` (+ `TRACE_ROW_HEIGHT`), `TraceEmptyState({kind:
  'loading'|'empty'|'error'|'noMatch', message?, onAction?})`; new `types/TraceView.ts`, `lib/collectParentIds.ts`.
  **F4 slot**: in `TracePanel`, replace the module-level `inspectorSlot(span)` placeholder by `<TraceInspector …/>`
  (state available: `sessionId`, `selectedSpan`, `trace.revision`, `live`, `now`, `rows`, `setSelectedId`,
  `closeInspector`); when it renders non-null the body grid gets the `lg:` 420px column; the phone sheet is a portal.
  **F5 slot**: replace the `insights` placeholder (an `EmptyState`) with `<TraceInsights trace={trace} … />`
  (`openSpan(id)` + `setView('timeline')` to jump to a span). `bunx tsc -b` passes. Next: F4.
- F4: `components/TraceInspector({sessionId, span, revision, traceStartMs, now, rows, onSelect, onClose})` — header
  (kind + status chips, name, title, start offset `+4.2s`, duration, `n / total`, prev/next/close), metrics grid
  (model, stop reason, context/input/cache read/cache write/output/reasoning via `formatTokens`, exact in titles),
  detail error banner with retry, then `TraceDetailSection({title, value, loading, emptyLabel, defaultOpen})`
  (collapsible, copy, pretty JSON, wrapped, max 22rem scroll) for Input / Output / Metadata. Desktop: `<aside>` in the
  420px column; phones: portal sheet (backdrop, grabber, body scroll lock, focus, drag follow, D12). New
  `hooks/useWideLayout.ts`, `lib/prettyTraceText.ts`, `lib/formatSpanOffset.ts`; `TracePanel` renders the inspector
  in the F4 slot (placeholder removed). `bunx tsc -b` passes. Next: F5.
- F5: `components/TraceInsights({trace, onOpenSpan})` (cards: Context per request full width, Tokens per model + Tools
  side by side from `xl`, Errors full width; scrolls, safe-area bottom) with `TraceContextChart({bars, onOpenSpan})`,
  `TraceModelTable({models})`, `TraceToolRanking({tools})` (Calls / Time switch), `TraceErrorList({errors, traceStartMs,
  onOpenSpan, limit=50})`; new `types/TraceContextBar.ts`, `lib/traceContextBars.ts` (D13), `lib/formatTokenShare.ts`.
  `TracePanel` renders it in the F5 slot (`openFromInsights` = expand ancestors + Timeline + inspector; placeholder and
  `EmptyState` import removed). `bunx tsc -b` passes. Next: F6.
- F6: `WorkspacePane` += `'trace'`; `SessionWorkspace` — Trace tab (`Activity`) last (after Preview), lazy `TracePanel`
  section mounted once visited and kept hidden (`active` = visible, like Files), `selectPane` guard extended.
  `ProductionTab` / `BackupTab` += `'trace'`; `ProjectDeploymentPage` / `ProjectBackupPage` — tab after Changes when
  `chat` exists, lazy `<TracePanel key={chat.id} sessionId={chat.id} active />` rendered only while that tab is open
  (same pattern as their Changes tab). `bunx tsc -b` passes. Next: F7.
- F7: `bun run build` (tsc -b + vite) passes unchanged (`TracePanel` lazy chunk ~48 kB; only the pre-existing >500 kB main-chunk warning). The SPA has no linter configured. Reviewed traces hooks/API and the F6 integration (no hidden pane whitelists): no fixes needed. `dist/` is git-ignored. Next: V1.
- V1: harness ran the real `traces.py` on real logs → Claude MyBank `02f0db88…` (564 spans; **sub-agent nesting
  confirmed**: the `Explore` agent span holds its 11 child spans, shown indented in the timeline), Codex rollouts
  `2026-10-26T11-17-00` (18 spans) and `2026-10-26T10-38-50` (263 spans). Checked in the browser pane via the SPA dev
  server: desktop 1440×900 + phone 375×812, dark + light; timeline (windowing, search with ancestors, chips, keyboard
  ↓/Enter/Esc), desktop inspector, phone sheet (open, swipe left/right = next/prev, swipe down = close, body lock
  released), Insights (context chart, Main/With sub-agents switch 239→243 requests, model table, tools, "Open in
  timeline" → timeline + sheet), no horizontal page overflow (only the summary strip / chips scroll sideways by design).
  **Fixed (real code)**: `shared/traces.py` — Codex `additional_tools` response items became input of the next call
  instead of opening a model-less "Model call" span before `turn_context`; `<external_codex_apps_…>` / `<codex_apps_…>`
  user messages are context, not the turn prompt (ruff clean). `TraceTimeline.tsx` — axis tick labels `whitespace-nowrap`,
  labels hidden past 80% (last tick wrapped to two lines). `TraceInsights.tsx` — scope switch `whitespace-nowrap`
  ("With sub-agents" wrapped). `TraceModelTable.tsx` — legend columns by container (`@container` + `@lg:grid-cols-4`)
  instead of viewport `sm:`, so it no longer truncates in the half-width card. Not changed (judged fine): phone header
  truncates the trace title beside the Timeline/Insights switch; on long traces waterfall bars are thin ticks.
  `bunx tsc -b` passes. **Harness paths for V2 to delete** (no existing file edited; untracked, never stage):
  `spa-mooi/trace-harness.local.html`, `spa-mooi/src/traceHarness.local.tsx`, `spa-mooi/public/trace-harness.local/`
  (JSON copies; git-ignored by `*.local`); outside the repo: `.claude/launch.json` entry `spa-vite`
  (pre-existing, untracked, reused) and the scratchpad generator. Next: V2.
- V2: stopped the V1 harness dev server (vite :5199); deleted `spa-mooi/trace-harness.local.html`,
  `spa-mooi/src/traceHarness.local.tsx`, `spa-mooi/public/trace-harness.local/` and the V1 scratchpad generator +
  JSON; kept the pre-existing `.claude/launch.json` entry `spa-vite`. `bun run build` passes (only the pre-existing
  >500 kB main-chunk warning); `uvx ruff check src` → 25 findings, the pre-feature baseline (none in traces);
  `import mic_sessions.main` + `shared.traces` OK. `AGENTS.md`: *Current work* section removed, Trace bullet added
  under *Development sessions*. All tasks done.
- E2E (live stack via `make up`, project Leffi, Sonnet 5.5 low): Claude SDK and Claude CLI sessions each ran
  "list root, read README, summarize with a sub-agent". Checked live updates while running (FR7), timeline tree +
  waterfall, token/model badges, sub-agent nesting with its own model call, filters (kind chip, errors only, search,
  expand/collapse all), inspector (metrics, Input/Output/Metadata, copy, sheet ≤ lg / side pane on desktop),
  Insights (context chart, tokens per model, tool ranking, errors), summary strip; 375×812 and 1440×900, light and
  dark; no page overflow. Fixed in `shared/traces.py` (D14): background sub-agent notification showed as a raw-XML
  "Turn 2"; model calls started before their context attachments. Not checked: Codex adapter, production/backup
  Trace tabs (no production chat locally), compaction and interrupted turns. ruff 25 (baseline), `bun run build` OK.
- D15 prompt/turn model: `traces.py` (kind `prompt` + loop `turn` spans in both parsers, turn status/stretch in
  `_build`), SPA kind/style/strip/empty-state labels, `AGENTS.md`. Checked on real logs: a Claude Code CLI log with a
  sub-agent (122 assistant message ids → 122 turns = 122 LLM calls, 134 tool_use → 134 tool/agent/skill spans, 0
  structure violations) and a Codex rollout (136 calls = 135 `token_usage_record` + 1 aborted call with only
  `token_count`, 129 function calls → 129 tools). Provider differences are native: Claude logs context attachments,
  hooks and sub-agent transcripts; Codex logs reasoning items and no hooks/context; SDK and CLI share Claude Code's
  log. ruff 25 (baseline), `bun run build` OK.
- D16 + live check (stack via `make up`, project Leffi): Codex session (MyCodex, GPT-6.1-Sol low) with a spawned
  sub-agent → Prompt 1 › 5 turns, `readme_summary` sub-agent nested with its own 2 turns (= its 2 usage records).
  Claude could not be rerun live (temporary token removed); checked offline on a real Claude Agent SDK (`sdk-py`)
  log: a failed `<synthetic>` call → one errored turn, counted once.
- FR10/D17 raw log download: `GET /sessions/{id}/trace/logs` in `features/sessions.py` (`TraceLog`, reader `logs`,
  `freeze(keep)`, `SessionTrace.log_files` in `shared/traces.py`; `Content-Disposition` exposed in `shared/web.py`),
  SPA `downloadTraceLogs` + `useTraceLogDownload` + `saveBlob`, header button in `TracePanel` (session, production and
  backup Trace tabs share it). Checked: scratch smoke run (live listing, planted symlink excluded, archive copies,
  valid zip), ruff 25 (baseline), `import mic_sessions.main` OK, `bun run build` OK. Not checked in the running app.
