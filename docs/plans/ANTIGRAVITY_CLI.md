# PLAN — Antigravity CLI (`agy`) replaces the Gemini CLI integration

> Status: **F0 done: GO**, **F1 done**, **F2 done** (see *F1* / *F2 implementation notes*; Linux sign-in
> checks A–C still pending the user), next step F3.
> Base commit: `509fcb4` (`main`).
> Goal: drive Google's Antigravity CLI (`agy`) natively, the same way the Claude CLI adapter drives
> `claude`, and remove the current `@google/gemini-cli` integration (ACP + headless adapters).
> Scope: **one adapter only, the CLI** (`agy` stream-json); **no ACP adapter**. Sign-in **only with
> Google OAuth** done by `agy` itself; no API key, no ADC.

---

## 1. What exists today (to be replaced)

| Layer | Current Gemini integration |
| --- | --- |
| mic-sessions transport | `shared/gemini.py`: `gemini --acp` client (`Acp`), headless `gemini --prompt --output-format stream-json` (`Headless`), private `GEMINI_CLI_HOME`, `oauth_creds.json` written from the platform grant, quota via Code Assist API |
| mic-sessions runtimes | `shared/agents.py`: `_GeminiRuntime`, `GeminiAcpAgentRuntime` (adapter `acp`), `GeminiCliAgentRuntime` (adapter `cli`), provider `gemini` in `PROVIDERS` |
| mic-sessions traces | `shared/traces.py`: Gemini session-log parsing |
| mic-mooi | `shared/Agents.java`: provider `gemini`, modes `OAUTH` (Gemini CLI installed-app client, PKCE, Code Assist redirect) + `API_KEY`, `GoogleOAuthClient`, platform-side token renewal; `AgentConnectionFeature.java`; migration `035-gemini-engine-defaults.yaml`; `AGENT_GEMINI_*` settings |
| SPA | `AddAgentAccountDialog.tsx`, `AuthorizationCodePairing.tsx`, `agentProviderCopy.ts`, `AgentConnectionMode.ts`, `AgentConnectionsCard.tsx` |
| Ops | `mic-sessions/Dockerfile` (`npm i -g @google/gemini-cli@0.68.0`), `.env.example` files, `README.md`, `AGENTS.md` |

`features/sessions.py` has no Gemini-specific code: the provider-agnostic `AgentRuntime` contract is
kept untouched, so the change lives in adapters, linking, catalogue and copy.

## 2. What `agy` offers (probed locally on `agy 1.5.3`, macOS; re-probed on 1.5.5 in *F0 findings*)

**Two programmatic interfaces; Mooi uses only the second one (stream-json). ACP is documented here only
as reference (it is how the probe listed models/modes) and as a possible login helper (`agy acp --login`,
§F0), never as a session adapter:**

1. `agy acp` — Agent Client Protocol over stdio (JSON-RPC 2.0, one object per line). Probed
   `initialize` + `session/new`:
   - `agentCapabilities`: `loadSession`, `sessionCapabilities.{resume,close,load,list,additionalDirectories}`,
     `promptCapabilities.{image: true, embeddedContext: true}`, `auth.logout`,
     `_meta.antigravity.systemPrompt.append` (inject Mooi instructions without touching repo files),
     `_meta.antigravity.tier`.
   - `authMethods`: `oauth-personal` (Google), `oauth-business` (Gemini Enterprise), `gemini-api-key`,
     `agent-platform` (Vertex / ADC).
   - `session/new` returns `models.availableModels` (Gemini 4 Argon, Gemini 3.8 Flash, **Claude Opus 5.5,
     Claude Sonnet 5.5, GPT-OSS 120B**, each `-low|-medium|-high`), `configOptions` `model` +
     `thought_level` (low/medium/high) + `mode` (`default`, `accept-edits`, `plan`; `auto` since 1.5.4),
     and `_meta.antigravity.tier` (e.g. `Google AI Pro`).
   - `available_commands_update` lists `compact`, `goal`, `plan`, `browser`, `teamwork`… → compaction is
     a `/compact` prompt.
   - Permissions arrive as `session/request_permission` (same as the Gemini ACP adapter handles today).
   - Login from a terminal without a browser: `agy acp --login` (paste-code flow).
2. `agy -p= --input-format stream-json --output-format stream-json` — long-lived headless process, one
   turn per stdin line `{"event":"user","message":{"content":"..."}}`. Probed output:
   `init` (`conversation_id`, `cwd`, `tools`, `permission_mode`), `step_update` (`step_index`, `state`
   `ACTIVE|DONE`, `step_type` `user_input|agent_response|tool|checkpoint`, `text_delta`, `tool_info`,
   `subagent_info`, `usage`), `result` (`status`, `response`, cumulative `usage`, `num_turns`,
   `finished_reason`). Resume with `--conversation <id>`. Limits: **text-only input**, **no permission
   prompts** (unapproved actions are soft-denied → needs allow rules; `--mode auto` is not available
   on the probed account), **slash commands and `control_request` end the session** (exit 2).
   F0 found workarounds: permission and question cards through a blocking `PreToolUse` hook, images
   through a file path the agent opens with `read_file` (see *F0 findings*).

**Usage KPIs:** `agy -p=/usage --output-format json` returns `command.data.groups[].buckets[]`
(`window: weekly|5h`, `remaining_fraction`, `reset_time`) per model group (`Gemini Models`,
`Claude and GPT models`, and since 1.5.5 a weekly-only `Gemini 4 Argon` group) → maps 1:1 to
session (5h) and weekly limit KPIs. Context size from `usage` in `step_update`.

**Isolation knobs:** in print mode (the mode Mooi uses) only `HOME`, `--log-file` and `--settings`
(inline JSON, never saved). `--app-data-dir`, `--gemini-dir`, `--cli_dir_name` and
`--disable-telemetry` exist only on `agy acp` (print mode rejects them, exit 2). Conversations are
stored as `$HOME/.gemini/antigravity-cli/conversations/<id>.db`; logs under `…/log/`; JSONL
transcripts under `…/brain/<id>/.system_generated/logs/` → trace sources and *Download log*.

**Auth model (docs):** Google sign-in is stored in the OS keyring (macOS Keychain, Linux Secret
Service/dbus, Windows Credential Manager); agy renews it itself. Without a D-Bus session bus (our
container) it uses file-based token storage under `$HOME/.gemini/antigravity-cli` (F0). API key mode needs
`"modelProvider": "gemini"` in `settings.json` **and** `GEMINI_API_KEY`. ADC with `AGY_ADC_AUTH=true`.

## 3. Decisions

| # | Decision | Status |
| --- | --- | --- |
| D1 | Provider identity | Proposed: new provider **`antigravity`** ("Antigravity") replacing `gemini`: models are multi-vendor and quotas are Antigravity's, so "Gemini" would mislead. |
| D2 | Adapters | **Confirmed: only Antigravity CLI** (`cli`, `agy -p= --input-format stream-json --output-format stream-json`), the native terminal driver like the Claude CLI adapter. **No ACP adapter.** One adapter → the adapter picker shows nothing to choose for this provider. |
| D3 | Sign-in modes | **Confirmed: only Google OAuth, done by `agy` itself** (Codex-like: the binary owns the login and its token; Mooi stores the opaque bundle encrypted). No Gemini API key, no ADC, no Enterprise. If F0 proves OAuth impossible in the container, stop and decide again (no silent fallback to API key). |
| D4 | Existing `gemini` connections | Neither Gemini OAuth nor Gemini API key links work for this provider → all removed by migration; the UI asks to link an Antigravity account again. |
| D5 | Token renewal | agy renews its own sign-in inside the session (platform cannot, it never sees a usable grant); the refreshed bundle is written back to mic-mooi so later sessions start fresh. Context (`AGENTS.md`) is updated to state this exception. |
| D6 | Gemini CLI | Removed completely (npm package, `gemini.py`, both Gemini adapters, Google OAuth client, `AGENT_GEMINI_*`). |

**Consequences of CLI-only (stream-json), to resolve in F0/F2:**

- **Permissions (F0: bridge found):** stream-json has no approval prompt (unapproved actions are
  soft-denied) and `--mode auto` is not available on the probed account. Sessions allow every action
  class with `permissions.allow` rules (`--settings`), and a `PreToolUse` hook in the private
  `$HOME/.gemini/config/hooks.json` blocks on a mic-sessions callback and answers `allow`/`deny`
  → Mooi's permission cards **are** offered (like the Claude CLI `can_use_tool`). A hook `allow`
  alone does not lift the soft-deny, so the allow rules are required; a failing or timed-out hook
  fails the tool (fail-closed).
- **Questions (`ask_question`, F0: bridge found):** the same hook receives the questions and answers
  with `deny` + a reason carrying the user's answer, which the agent reads as the reply. Without the
  hook, headless agy auto-skips the question.
- **Images (F0: by path):** input stays text-only; Mooi writes the attachment to a private directory
  outside the repository, allows `read_file(<dir>)` and names the path in the prompt; the agent opens
  it with `read_file` and sees the image.
- **Compaction / usage / models:** slash commands end a stream-json session, so they run as separate
  one-shot processes on the same private home while no stream process holds the conversation:
  `agy -p=/compact --conversation <id> --output-format json`, `agy -p=/usage --output-format json`,
  `agy models`.
- **Interrupt (F0 confirmed):** `SIGINT` (or `SIGTERM`) → `result` with `finished_reason:
  "interrupted"`, exit 1 in < 0.3 s; resume with `--conversation <id>` keeps the context.

**Risk to accept explicitly:** Google's guidance on wrapping `agy` with consumer (Free/Pro/Ultra)
accounts is contradictory (forum says launching the official binary over stdio is supported and
extracting tokens for custom HTTP clients is not; the FAQ is reported to say wrapping is unsupported on
consumer plans). Mooi only launches the official binary, each user signs in with their own account and
Mooi never calls Google with the token — but moving the credential bundle between homes must be
validated against the terms (§F0).

## 4. Phases

Each phase ends with type checks / linters / builds green. No programmatic tests (AGENTS.md).

### F0 — Linux spike (go / no-go, nothing merged)

Run the pinned Linux `agy` inside the `mic-sessions` image (throw-away branch / container) and answer:

1. Install: official installer with `--dir`, pinned version + SHA512, `linux/amd64` and `arm64`; disable
   the self-updater (`updater/`) and telemetry.
2. Credential storage **without a Secret Service** in the container: does agy fall back to a file under
   the app-data dir (reported: `antigravity-oauth-token`)? Is it honoured with `--app-data-dir`/`HOME`?
3. Portability: does a bundle produced by one login work when written into a fresh private home? Does a
   refresh rotate the refresh token (concurrent sessions of one account)?
4. OAuth login without a browser in the container (paste-code flow): interactive `agy` under a PTY
   vs the login-only helper `agy acp --login` (a one-shot login command that exits, not the ACP
   adapter); how the URL is printed and the code read, so mic-sessions can relay both; personal Google
   account only (skip the Enterprise / Cloud choices).
5. stream-json turn: tool steps (`tool_info`), thinking deltas, subagents, usage/context, `finished_reason`.
6. Permissions: `--mode auto` + allow rules; whether agy hooks (`PreToolUse`) can block on a Mooi
   callback to bring back permission cards; soft-deny notices on stderr.
7. Interrupt (SIGINT vs kill) and resume with `--conversation <id>` after a process restart.
8. `agy -p=/compact --conversation <id>`, `/usage`, `agy models` on the private home while no turn runs.
9. Issue #1456 (stdin deadlock in `run_command`): run with stdin of commands closed / timeout.
10. Model ids: `gemini-4-argon-medium` style ids vs `--model` + `--effort` (low…max) mapping.

Output: a short findings section appended here; adjust D3/D5 and the capability matrix if needed.

### F1 — mic-sessions transport `shared/antigravity.py` (replaces `gemini.py`)

- `executable()`, `prepare_home()` (a private `HOME`, the only data-dir knob of print mode:
  `.gemini/antigravity-cli/` with the credential bundle and `settings.json` (Playwright MCP, no
  `modelProvider` override so only the OAuth sign-in is used), `.gemini/config/hooks.json` (the Mooi
  permission/question hook) and `.gemini/GEMINI.md` (Mooi instructions)); allow rules passed with
  `--settings`; minimal process env (`AGY_CLI_DISABLE_AUTO_UPDATE=true`, no Mooi secrets, no
  `GEMINI_API_KEY`/`AGY_ADC_AUTH`; commands and hooks inherit it). Telemetry has no CLI switch.
- `write_credential()` / `read_credential()` for the opaque sign-in bundle (write-back after refresh).
- `Stream`: long-lived stream-json process per session (stdin turns, stdout events), restart with
  `--conversation <id>`. No ACP client: `Acp` and `Headless` from `gemini.py` are deleted.
- One-shot helpers on the same home: `models()` (`agy models`, cached per account), `usage()`
  (`agy -p=/usage --output-format json`), `compact()` (`agy -p=/compact --conversation <id>`).

### F2 — runtime in `shared/agents.py`

- `AntigravityCliAgentRuntime` (catalogue, configure model + effort, quota/context KPIs, credential
  refresh + write-back, trace sources, home cleanup), modelled on `ClaudeCliAgentRuntime`.
- Event mapping `init` / `step_update` / `result` → existing `AgentEvent`s (assistant/thinking deltas,
  tool use/result, subagents, turn result, changes).
- Instructions via the private `$HOME/.gemini/GEMINI.md` (never in the repository).
- `PROVIDERS["antigravity"] = (cli: "Antigravity CLI",)`; drop `gemini` and both Gemini runtimes.
- `AgentCapabilities` honest to F0: permissions and questions through the hook bridge, images by
  path; thinking from the transcript file (no thinking deltas in the stream).

### F3 — traces (`shared/traces.py`)

- Build the trace from the stream-json events Mooi already receives (turns, tools, subagents,
  compactions, errors, usage), enriched by `brain/<id>/.system_generated/logs/transcript_full.jsonl`
  (thinking text, full tool args) and each subagent's `brain/<sub-id>/…/transcript.jsonl`.
- *Download log*: `brain/<id>/.system_generated/logs/*.jsonl` (+ subagents), `conversations/<id>.db`
  (SQLite with protobuf blobs, raw only), `log/*.log` and Mooi's own frame transcript, kept for
  cleared conversations. Remove Gemini log parsing.

### F4 — linking (mic-sessions + mic-mooi)

- mic-sessions `features/agent_connections.py`: an `antigravity` OAuth attempt (same owner-bound,
  expiring pattern as Codex): start the `agy` login in a temp home → return the Google authorization URL
  → accept the pasted code → capture the bundle and the account identity (email / tier) →
  `link_antigravity` to mic-mooi.
- mic-mooi `Agents.java`: provider `antigravity` with a single mode `AGENT_OAUTH` (CLI-owned OAuth
  bundle, like Codex `DEVICE_OAUTH`); no `API_KEY`; remove `GoogleOAuthClient`, Gemini OAuth constants
  and `AGENT_GEMINI_*`; service endpoint for credential write-back (owner + connection checked).
- `AgentConnectionFeature.java`: link / list / write-back for the new mode.
- Migration `036-antigravity-provider.yaml`: engine defaults row `gemini` → `antigravity` (adapter
  `cli`); delete every `gemini` connection (OAuth and API key); sessions referencing them fail cleanly.

### F5 — SPA

- `AddAgentAccountDialog.tsx`: Antigravity → only "Sign in with Google" (open URL, paste code, reuse
  `AuthorizationCodePairing.tsx`); no API-key field.
- `agentProviderCopy.ts`, `AgentConnectionMode.ts`, `AgentConnectionsCard.tsx`: provider name, icon,
  copy; relink notice for removed Gemini connections.
- Model picker: multi-vendor labels from the catalogue; KPIs: show both quota groups (Gemini / Claude &
  GPT, 5h + weekly). Admin **Agents** defaults pick up the new provider automatically.

### F6 — ops and docs

- `mic-sessions/Dockerfile`: install pinned `agy` from the versioned release tarball (URL + SHA512
  per arch, not the installer script, which edits shell profiles), remove the npm Gemini CLI.
- `mic-sessions/.env.example`, `env.py`: `AGENT_ANTIGRAVITY_CLI=agy`, default model; remove
  `AGENT_GEMINI_*`. Same in `mic-mooi/.env.example` / `application.yml`.
- `README.md`, `AGENTS.md` *Context*: providers "Claude, Codex and Antigravity"; Antigravity has one
  adapter, **Antigravity CLI** (drives `agy` stream-json natively); linking by agy's own Google OAuth
  only; token-renewal exception (D5); remove the Gemini ACP / Gemini CLI / Gemini API key wording.
- `deploy/production/*` is owned by the Mooi production feature: the env changes there go through a Mooi
  production chat, not this change.

### F7 — verification

`uv run ruff` / type check (mic-sessions), `./mvnw -q compile` (mic-mooi), `tsc`, lint and build (SPA).
Review for regressions in Claude/Codex adapters. Manual app test by the user.

## 5. Open risks

- Terms for consumer accounts (§3).
- Closed-source binary: event schema can change → pin the version, upgrade deliberately.
- Linux credential file name, bundle portability and refresh-token rotation: pending user check (F0).
- ~226 MB binary (70 MB tarball) added to the `mic-sessions` image.
- Known upstream issue #1456 (stdin deadlock): not reproduced on 1.5.5 (the command runs in a PTY and
  goes to the background; the turn ends, slowly).

---

## F0 findings

Probed 2026-11-11 on `agy 1.5.5` (the macOS install self-updated from 1.5.3 during the spike): macOS
behaviour probes in a scratch repository with a private `HOME`, and Linux probes in a throw-away
`python:3.13-slim-trixie` container (arm64, user `mooi` uid 1001, no D-Bus), never signed in.
Prompts used `gemini-3.8-flash-low`.

### Answers per question

**1. Install (Linux).**
- Official script: `curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir <dir>`.
  Only flags: `-d|--dir`, `-h`. It always installs the **latest** version: it reads
  `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/<platform>.json`
  (`linux_amd64`, `linux_arm64`, `linux_amd64_musl`, `darwin_arm64`, …) =
  `{"version","url","sha512"}`, downloads `url`, verifies SHA512, extracts the single file
  `antigravity`. Side effects: it runs `agy install --dir <dir>`, which appends
  `export PATH="<dir>:$PATH"` to `~/.bashrc` and `~/.profile` (and prints a wrong install path).
- **Pinning:** the tarball URL is versioned and public, e.g.
  `https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.5-6740358537805824/linux-x64/cli_linux_x64.tar.gz`
  (sha512 `746a2bd7…a277`) and `…/linux-arm/cli_linux_arm64.tar.gz` (sha512 `eb3e025c…2d59`).
  The bucket is not listable and older builds need their build id, so pins are taken from the
  manifest at upgrade time. Installer binary == tarball binary (byte-identical).
- Arch: `linux/amd64` and `linux/arm64` (glibc, dynamic: libresolv/libpthread/libm/libdl; musl variant
  exists). Size: arm64 binary 236,540,280 bytes (~226 MB), tarball 70 MB; macOS binary 200 MB.
- Self-updater: on by default (checks every 15 min, spawns a background update process that replaces
  the binary). Disabled by env **`AGY_CLI_DISABLE_AUTO_UPDATE=true`** (exactly `true`; `1`, `TRUE`,
  `yes` are ignored). Log: `Auto-update disabled via environment variable AGY_CLI_DISABLE_AUTO_UPDATE`.
- Telemetry: no flag, env var or `settings.json` key in print mode (`--disable-telemetry` is
  ACP-only). It is an **account-level** toggle ("Enable Telemetry" in the TUI `/config`, always off for
  business accounts). Mooi cannot force it off per session.

**2. Credential storage without Secret Service.** Every container run logs
`composite_token_storage.go] Using file-based token storage because no D-Bus session bus detected`
(or `…because container environment detected` under a PTY); nothing is printed on stdout/stderr.
Storage lives in the app data dir, which print mode derives from `HOME` only
(`$HOME/.gemini/antigravity-cli`). The exact file name appears only after a real login → pending
user check A. On macOS the Keychain is used and is found only with the real `HOME` (a private `HOME`
lost the sign-in); irrelevant for the container.

**3. Bundle portability / refresh rotation.** Needs a real Google sign-in inside Linux → pending user
checks A–C. agy refreshes its access token (~1 h lifetime) itself (`Auto-saving refreshed token from
token source callback` in the binary).

**4. OAuth login without a browser.** Use **`agy acp --login`** (works with plain pipes, no TTY):
- stdout: `Open this link in a browser to log in with Google:` / blank / `  <URL>` / blank /
  `Then paste the authorization code, or the full URL of the page you land on, and press Enter:`.
- Reads one line from stdin (code or the full landing URL); empty lines are ignored; stdin EOF →
  `login cancelled: no authorization code was entered`, exit 1. No timeout seen within 20 s.
  `xdg-open` missing is only a log warning. Writes `log/acp-login-*.log`.
- URL: `https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com&code_challenge=…&code_challenge_method=S256&prompt=consent&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&scope=…cloud-platform+…userinfo.email+…userinfo.profile+…cclog+…experimentsandconfigs+…aicode+openid&state=…`
  (personal Google account flow; no Enterprise/Cloud choice is asked).
- Alternatives (not to use): interactive `agy` under a PTY first shows a menu
  (`Select login method: > 1. Google OAuth  2. Use a Google Cloud project`), then a scrolling pane
  with the URL wrapped over many lines; `agy -p=x` (text input, no TTY) prints `Authentication
  required. Please visit the URL to log in:` + URL + `Waiting for authentication (timeout 60s)...` /
  `Or, paste the authorization code here and press Enter:` on stderr (60 s is too short);
  stream-json input with no sign-in fails immediately: stderr `Error: authentication required. Run
  'agy' to log in, then retry.`, result `{"status":"ERROR","error":"authentication failed or timed
  out","finished_reason":"error"}`, exit 1.

**5. stream-json turn.** Command: `agy -p= --input-format stream-json --output-format stream-json
--model <m> [--effort <e>] [--conversation <id>] --settings '<json>' --log-file <f>`; one stdin line
per turn `{"event":"user","message":{"content":"…"}}`; the next line is sent after `result`; closing
stdin ends the process after the current turn (exit 0). Startup to `init`: 2–7 s (once > 12 s).
- `init`: `{"event":"init","conversation_id":"…","init":{"model":"…","cwd":"…","tools":[…62 names…],"permission_mode":"request-review"}}`.
- `step_update` (all carry `conversation_id`, `step_index`, `state`, `step_type`):
  - `user_input` `DONE`; `system_message` `DONE` (injected notices, e.g. after resume or background
    task completion); `checkpoint` (compaction); `unknown` (`ask_question`).
  - `agent_response`: `ACTIVE` with `text_delta` chunks, then `DONE` with the last `text_delta`,
    `duration_seconds` and per-call `usage {input_tokens, output_tokens, thinking_tokens,
    cache_read_tokens, total_tokens}`. A response that only calls tools has no `text_delta`.
  - `tool`: `ACTIVE` `{"tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"ls -la"}}}`
    then `DONE` with `tool_info.output` (string) or `ERROR` with
    `tool_info.error {"type":"TOOL_ERROR","message":"…"}`. Parameters are abridged (`write_file`
    shows only `Path`, no content). Names seen: `write_file`, `read_file`, `run_command`,
    `manage_task`, `schedule`, `manage_subagents` (the `init.tools` list uses other names, e.g.
    `write_to_file`, `view_file`). No tool-call id; correlate by `step_index`.
  - `subagent`: `{"tool_name":"invoke_subagent","subagent_info":{"subagents":[{"type_name":"research","role":"Pong Replier","initial_prompt":"…","conversation_id":"<sub-id>","log_uri":"file://…/brain/<sub-id>/.system_generated/logs/transcript.jsonl","workspace_uris":[…]}]}}`
    `ACTIVE` then `DONE` (immediately: subagents run asynchronously). Their steps are **not** in the
    parent stream; the parent polls them with `manage_subagents`/`schedule`.
  - Events sometimes arrive in bursts (several steps with one timestamp).
- **Thinking:** no thinking text in the stream (only `thinking_tokens`). The text is in
  `brain/<id>/.system_generated/logs/transcript_full.jsonl` (`{"step_index","source":"MODEL","type":"PLANNER_RESPONSE","status","created_at","input_tokens","cache_read_tokens","output_tokens","thinking","tool_calls":[{"name","args"}]}`),
  written per completed step.
- `result`: `{"conversation_id","status":"SUCCESS|ERROR|…","response","duration_seconds","num_turns","usage":{…},"denied_actions":[{"action":"write_file","display_name":"WriteFile"}],"error"?, "finished_reason"?}`.
  `response` = all text of the current turn; `usage`, `num_turns`, `duration_seconds` are
  **cumulative over the conversation** (persisted, also across processes). `finished_reason` only
  appears on failures (`"error"`, `"interrupted"`).
- Context KPI: `usage.input_tokens` of the latest `agent_response` step (base prompt ≈ 8.4k). The
  context window size is not exposed by print mode (`/context` is refused in print mode; `agy models`
  has no JSON) → static per-model value in the catalogue.
- A long command goes to the background after `WaitMsBeforeAsync`; the agent waits for it and the
  same turn's `result` arrives after it finishes.

**6. Permissions.**
- Default (`request-review`): any write/command/web/MCP action without an allow rule is soft-denied:
  tool `ERROR` (`permission check failed for write_file "…": user denied permission …`), the turn ends,
  `result.denied_actions` lists it, stderr: `jetski: no output produced — a tool required the
  "write_file" permission that headless mode cannot prompt for, so it was auto-denied. Add an
  allow-rule under permissions.allow in settings.json (e.g. write_file(<target>)). …`. Exit 0.
- `--mode auto`: stderr `warning: --mode auto is not available for this account; continuing in the
  default mode.` (rollout flag; also needs the terminal sandbox). Not usable.
- Allow rules via inline `--settings '{"permissions":{"allow":["read_file(*)","write_file(*)","command(*)","read_url(*)","execute_url(*)","mcp(*)"]}}'`
  work (log: `CLI settings initialized: permissions=&{Allow:[…]}`). Syntax `action(target)`, actions
  `read_file`, `write_file`, `read_url`, `execute_url`, `command` (prefix or `regex:`), `unsandboxed`
  (business only), `mcp(server/tool)`; deny > ask > allow. `toolPermission: always-proceed` exists as
  an alternative (not needed).
- **Hooks bridge works.** `hooks.json` is read from `$HOME/.gemini/config/hooks.json` (global) and
  `<workspace>/.agents/hooks.json` (repository: never used by Mooi); `settings.json`/`--settings`
  cannot hold hooks. Format:
  `{"mooi":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"/abs/hook","timeout":600}]}]}}`
  (`timeout` in s, default 30; cwd = the directory of `hooks.json`; env = agy's env plus
  `ANTIGRAVITY_CONVERSATION_ID`). stdin: `{"conversationId","workspacePaths","transcriptPath","artifactDirectoryPath","modelName","lastUserInput","hookEventName":"PreToolUse","cwd","stepIdx","toolCall":{"id":"call_…","name":"write_file","args":{"Path":"…","Content":"bye"}}}`
  (full args; `stepIdx` == stream `step_index`). stdout `{"decision":"allow"}` or
  `{"decision":"deny","reason":"…"}`. The agent loop blocks while the hook runs (35 s wait verified).
  `deny` → tool `ERROR` `tool call denied by pre-tool hook: <reason>`. `allow` (even with
  `permissionOverrides`) does **not** lift the headless soft-deny → allow rules + hook together.
  Hook timeout or non-zero exit → tool `ERROR` `JSON hook "…" failed: …` (fail-closed).
  `PostToolUse` (adds `error`) and `Stop` (`terminationReason`, `fullyIdle`, `executionNum`) also fire.

**7. Interrupt / resume.** `SIGINT` mid-tool: stderr `error: interrupted`, `result
{"status":"ERROR","error":"interrupted","finished_reason":"interrupted"}`, exit 1 after ~0.2 s; the
running command is killed (no orphan). `SIGTERM` behaves the same (log `Got signal terminated,
shutting down`); before `init` it yields `error: context canceled` with an empty `conversation_id`.
A new process with `--conversation <id>` keeps the context (the agent knew the command was
cancelled); step indexes continue; a `system_message` step is injected. Switching `--model` on resume
works, also across vendors (Gemini → Claude).

**8. One-shot helpers** (each a separate process on the session's `HOME`, ~3 s startup):
- `agy -p=/usage --output-format json` (no LLM call, `conversation_id` ""):
  `command.data.groups[] {name, description, buckets[] {id, name, description?, window: "weekly"|"5h",
  remaining_fraction, reset_time}}`; groups `Gemini Models` (`gemini-weekly`, `gemini-5h`),
  `Claude and GPT models` (`3p-weekly`, `3p-5h`), `Gemini 4 Argon` (`gemini-argon-wtu-weekly`). Text
  mode prints `group\tname\tpercent\treset` lines.
- `agy -p=/compact --conversation <id> --output-format json`: 12–23 s (an LLM call), `response` "",
  stderr `warning: run ended with no output and no recorded error`, exit 0; it appends a `CHECKPOINT`
  step (`# Resuming from a compaction …`), seen by later processes. agy also auto-compacts by itself
  (`checkpoint` step; env `AGY_CLI_AUTO_COMPACT_OVERRIDE` exists).
- `agy models`: tab-separated `id\tlabel` lines (no JSON flag), e.g. `gemini-4-argon-medium\tGemini
  4 Argon (Medium)`; 13 models: Gemini 4 Argon, Gemini 3.8 Flash, Claude Opus 5.5, Claude Sonnet 5.5
  (each `-low|-medium|-high`), `gpt-oss-120b-medium`.
- **No conversation locking:** `presence/<id>.lock` is held open by the running process, but a second
  process on the same conversation is **not** blocked: it ran a turn and appended it to the same
  conversation while the first was mid-turn. Mooi must serialize all processes per conversation.

**9. Issue #1456 (stdin).** Not reproduced on 1.5.5: `read x; echo "got-[$x]"` runs in a PTY (output
has `\r\n`), blocks until `WaitMsBeforeAsync`, goes to the background; the agent fed it with
`manage_task send_input` and the turn completed (~50 s); the next stdin turn worked. Agy's own stdin
is not given to commands. Mitigation only: a Mooi instruction to prefer non-interactive commands.

**10. Model ids vs `--model` + `--effort`.** Ids are `<base>-<effort>`. `--model <base> --effort
low|medium|high` resolves to `<base>-<effort>` (log `model alias "gemini-3.8-flash" resolved to
"gemini-3.8-flash-high"`); `--model <base>` alone = medium; `--model <full-id>` with any `--effort`
→ `conflicts with --effort=…`; `xhigh`/`max` (accepted by the flag) exist on no current model → `…
has no "max" effort (available: low, medium, high)`; `gpt-oss-120b` has only `medium`; unknown model →
error with the list. All errors: exit 1, `result.status` `ERROR`, nothing is run. Default without
`--model`: Gemini 4 Argon (Medium).

**Other isolation facts.**
- Print mode honours `HOME`, `--log-file`, `--settings`; rejects `--app-data-dir`, `--gemini-dir`,
  `--cli_dir_name`, `--disable-telemetry`, `--include-default-customizations` (exit 2). Env
  `GEMINI_DIR`, `ANTIGRAVITY_GEMINI_DIR`, `ANTIGRAVITY_APP_DATA_DIR` are not honoured (the latter also
  made the process hang 60 s after `result`). Env var names in the binary (names only):
  `AGY_CLI_DISABLE_AUTO_UPDATE`, `AGY_CLI_AUTO_COMPACT_OVERRIDE`, `AGY_CLI_NONINTERACTIVE_HEADLESS`,
  `AGY_CLI_INTERACTIVE_HEADLESS`, `AGY_CLI_MODEL_API_MAX_RETRIES`, `AGY_ACCOUNT`, `AGY_ADC_AUTH`,
  `AGY_CA_CERTS`, `AGY_PROXY_STRICT_SSL`, `AGY_ALLOWED_DOMAINS`, `AGY_LLM_GATEWAY_*`,
  `ANTIGRAVITY_APP_DATA_DIR`, `ANTIGRAVITY_GEMINI_DIR`, `ANTIGRAVITY_CONFIG_REL_DIR`,
  `ANTIGRAVITY_CONVERSATION_ID`, `ANTIGRAVITY_PROJECT_ID`, `GEMINI_API_KEY`, `GEMINI_BASE_URL`,
  `GEMINI_DIR`, `GEMINI_DEFAULT_PROJECT`.
- A fresh `HOME` gets `.gemini/antigravity-cli/{builtin/,bin/,brain/,cache/,conversations/,crashes/,implicit/,log/,presence/,updater/,conversation_summaries.db*,installation_id,jetski_state.pbtxt,last_check.timestamp,cli.log}`
  and `.gemini/config/{config.json,mcp_config.json,projects/default-cli-project.json,.migrated}`.
- **Instructions:** `$HOME/.gemini/GEMINI.md` and `$HOME/.gemini/AGENTS.md` are both injected as
  global rules (verified by marker tokens, also inherited by subagents), plus the repository's
  `GEMINI.md`/`AGENTS.md` walking up from the cwd. `.gemini/config/rules/*.md` without frontmatter is
  rejected (`Invalid rule trigger`). Limits: 24 KB per file, 20k-token rules budget.
- Commands and hooks inherit agy's environment (verified) → the process env must stay minimal.
- **Images:** `read_file` of a PNG (in the workspace, or outside it with `read_file(<dir>)` allowed)
  gives the model the image (correct colour, +~1.5k input tokens).
- **Questions:** headless `ask_question` is auto-skipped (`step_type: "unknown"`, the agent says the
  user skipped it). With the hook: args `{"questions":[{"question","options":[…],"is_multi_select"}]}`;
  `deny` + reason `The user's answer: blue` → the agent replied "You answered … blue".
- **Conversation files:** `conversations/<id>.db` is SQLite (tables `steps`, `gen_metadata`,
  `executor_metadata`, `parent_references`, `trajectory_meta`, `trajectory_metadata_blob`,
  `battle_mode_infos`; payloads are protobuf blobs) → raw download only. Readable traces:
  `brain/<id>/.system_generated/logs/transcript.jsonl` and `transcript_full.jsonl` (+ `chunks/`), one
  JSON per step (`USER_INPUT`, `PLANNER_RESPONSE`, `SYSTEM_MESSAGE`, `CHECKPOINT`; interrupted tool
  steps are missing), and `brain/<sub-id>/…` for subagents.

### Capability matrix — Antigravity CLI adapter

| Feature | Support | How |
| --- | --- | --- |
| Streaming | Yes | `agent_response` `ACTIVE` `text_delta` |
| Thinking | Partial | no deltas; `thinking` text per completed step from `transcript_full.jsonl`; `thinking_tokens` in usage |
| Tools | Yes | `tool` steps `ACTIVE` → `DONE`/`ERROR` with `tool_info` (abridged params; full args in hook payload / transcript) |
| Subagents | Yes (start + transcript) | `subagent` step `subagent_info`; inner steps from `brain/<sub-id>/…/transcript.jsonl` |
| Permissions | Yes (bridge) | allow-all rules + blocking `PreToolUse` hook → Mooi card → `allow`/`deny` |
| Questions | Yes (bridge) | hook on `ask_question` → Mooi card → `deny` + reason carrying the answer |
| Images | Yes (by path) | attachment in a private dir, `read_file(<dir>)` allowed, path in the prompt |
| Interrupt | Yes | `SIGINT`, then resume with `--conversation` |
| Compaction | Yes | one-shot `agy -p=/compact --conversation <id>` with no stream process alive; auto-compaction shows as `checkpoint` |
| Model / effort | Yes | `--model <base> --effort <low/medium/high>`; change = restart with `--conversation` |
| Context KPI | Yes | last `agent_response` `usage.input_tokens`; window size from a static catalogue |
| Limit KPIs | Yes | `agy -p=/usage --output-format json` (5h + weekly per group) |
| Resume | Yes | `--conversation <id>`; conversation persists in the private `HOME` |

### Design choices F1/F2 must follow

1. One private `HOME` per session (print mode has no other data-dir knob); write the credential
   bundle there before start, read it back after each process exit for the D5 write-back.
2. Install from the pinned tarball (`ARG AGY_VERSION`, per-arch URL + SHA512, `sha512sum -c`, extract
   `antigravity` → `/usr/local/bin/agy`); never the installer script; process env
   `AGY_CLI_DISABLE_AUTO_UPDATE=true`.
3. Long-lived `agy -p= --input-format stream-json --output-format stream-json --model <base>
   --effort <e> [--conversation <id>] --settings <allow rules> --log-file <home>/…`; one turn per
   stdin line after the previous `result`; Mooi's queue stays the only queue.
4. Permission + question cards through `$HOME/.gemini/config/hooks.json` → a tiny hook command that
   talks to mic-sessions over a per-session channel (e.g. a Unix socket path in the env) and blocks
   until the user answers; hook `timeout` above Mooi's own card timeout; Mooi answers `deny` on
   timeout/stop. "Allow all" session settings answer `allow` without a card.
5. Mooi instructions in `$HOME/.gemini/GEMINI.md`, never in the repository.
6. Serialize per conversation: `/compact`, model changes and restarts only after the stream process
   exited (close stdin or SIGINT, wait), then restart with `--conversation <id>`. `/usage` and
   `agy models` need no conversation and can run any time on the account's home.
7. Interrupt = `SIGINT`, wait for exit, keep the conversation id; `finished_reason: "interrupted"`
   maps to an interrupted turn.
8. Map `step_update` by `step_index`; turn usage = difference of cumulative `result.usage`; context =
   last `agent_response.usage.input_tokens`; thinking and subagent detail from the `brain/` JSONL
   files.
9. Images: write attachments to a private dir outside the repository, allow `read_file(<dir>)`, name
   the paths in the prompt.
10. Sign-in (F4): `agy acp --login` in a temp `HOME` with pipes: parse the URL line from stdout, return
    it, write the pasted code (or full URL) + `\n` to stdin, wait for exit 0, then capture the
    credential file(s) named by check A plus the account email/tier.
11. Do not rely on `--mode auto`, telemetry control or ACP-only flags.

### Pending user checks (need a real Google sign-in inside Linux)

Run on the Mac (Docker via colima), with your own Google account; never paste credential contents
anywhere, the commands print only file names and hashes:

```bash
docker run --rm -it --name agy-check -v agy-check:/data python:3.13-slim-trixie bash -c '
set -e; apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
A=$(uname -m | sed "s/x86_64/amd64/;s/aarch64/arm64/")
M=$(curl -fsSL https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_$A.json)
U=$(echo "$M" | sed -n "s/.*\"url\"[^\"]*\"\([^\"]*\)\".*/\1/p"); S=$(echo "$M" | sed -n "s/.*\"sha512\"[^\"]*\"\([^\"]*\)\".*/\1/p")
curl -fsSL "$U" -o /tmp/a.tgz && echo "$S  /tmp/a.tgz" | sha512sum -c - && tar -xzf /tmp/a.tgz -C /usr/local/bin antigravity && mv /usr/local/bin/antigravity /usr/local/bin/agy
export AGY_CLI_DISABLE_AUTO_UPDATE=true; mkdir -p /data/h1 /data/h2 /data/ws && cd /data/ws
HOME=/data/h1 agy acp --login            # open the URL, sign in, paste the code
echo "--- A: files (names only)"; find /data/h1 -type f -newer /tmp/a.tgz | grep -v -E "builtin/|/log/" | sort
hashf() { python3 -c "import json,hashlib,sys
p=sys.argv[1]
try: d=json.load(open(p)); print(p, {k: hashlib.sha256(json.dumps(v).encode()).hexdigest()[:10] for k,v in d.items()})
except Exception: print(p, hashlib.sha256(open(p,\"rb\").read()).hexdigest()[:10])" "$1"; }
echo "--- A: works in its own home"; HOME=/data/h1 agy -p "Reply ok" --model gemini-3.8-flash-low --output-format json </dev/null
export -f hashf; exec bash'
```

- **A — where the credential lands:** note the file name(s) the `find` lists under
  `/data/h1/.gemini/antigravity-cli/` (expected: one token file; check `log/cli-*.log` for
  `Using file-based token storage`). Then run `hashf <file>` (prints only keys + short hashes).
- **B — portability:** in the same shell copy only those file(s) into `/data/h2` at the same relative
  path (`mkdir -p` the parents), then `HOME=/data/h2 agy -p "Reply ok" --model gemini-3.8-flash-low
  --output-format json </dev/null` must succeed without a login prompt. Repeat in a **new** container
  (`docker run --rm -it -v agy-check:/data python:3.13-slim-trixie bash`, reinstall as above, use a
  fresh `/data/h3`) to confirm it does not depend on hostname/`installation_id`.
- **C — refresh rotation:** record `hashf` of the file in h1 and h2, wait > 1 h (access-token expiry),
  run one prompt in h1, then `hashf` again: if only the access-token/expiry fields change, the refresh
  token is stable (concurrent sessions of one account are safe; D5 write-back is a nicety). If the
  refresh-token field changes, run a prompt in h2 (still holding the old bundle): success = old refresh
  tokens stay valid; failure = Mooi must serialize refreshes per account and always write back (D5
  becomes mandatory and needs a per-account lock).
- Afterwards: `docker volume rm agy-check` and revoke the test sign-in at
  https://myaccount.google.com/permissions if wanted.

### Verdict: **GO**

Sign-in by agy's own Google OAuth works headless in the container (`agy acp --login`, file storage
without D-Bus), so D3 stands; every session feature has a CLI-only path, and permission/question
cards come back through hooks. Not blocking but to confirm before F4: checks A–C (credential file
name, portability, refresh rotation → D5 shape) and the consumer-terms risk (§3), which F0 cannot
settle.

---

## F1 implementation notes

Delivered: `mic-sessions/src/mic_sessions/shared/antigravity.py` (transport only, no session contracts) and
`env.py` settings `agent_antigravity_cli = "agy"`, `agent_antigravity_model = "gemini-4-argon"`,
`agent_antigravity_effort = "medium"`. `gemini.py` and the Gemini settings stay until F2. Sanity-run on the
macOS `agy 1.5.5` (scratch dirs only, `gemini-3.8-flash` low): home preparation, bundle round trip, hook
bridge end to end through the generated hook script, `models()`, `usage()`, a stream turn, an interrupt
and `compact()` all behaved as below.

### Public API (`antigravity.py`)

Layout / isolation
- `DATA_DIR` `.gemini/antigravity-cli`, `CONFIG_DIR` `.gemini/config`, `INSTRUCTIONS_FILE` `.gemini/GEMINI.md`, `MOOI_DIR` `.mooi` — paths relative to the private `HOME`.
- `AntigravityError(cause, detail="")` — `cause` user-safe, `detail` diagnostic (exit code; last stderr line).
- `executable(configured: str) -> str` — resolved binary or `AntigravityError`.
- `prepare_home(home, credential, *, instructions="", browser=True, hooks=True) -> None` — dirs 0700 / files 0600, idempotent (agy state kept): `.mooi/settings.json` (allow rules), `.gemini/GEMINI.md`, `.gemini/config/hooks.json` + `.mooi/pretooluse_hook.py`, `.gemini/config/mcp_config.json` (`{"mcpServers":{"playwright":{command,args,disabled:false}}}`, same server as `browser.playwright_server()`), credential bundle.
- `data_dir(home)`, `settings_path(home)`, `attachments_dir(home)`, `hook_script(home)` — path helpers.
- `save_attachment(home, data: bytes, suffix=".png") -> Path` — private file under `.mooi/attachments/` (allowed by `read_file(<dir>)`); name the returned path in the prompt.
- `environment(home, extra=None, *, hook_socket=None) -> dict[str, str]` — the whole process env: `_INHERITED` basics + session variables minus reserved ones (`AGY_*`, `ANTIGRAVITY_*`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_DIR`, `GEMINI_DEFAULT_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_ACCESS_TOKEN`, `HOME`, `MOOI_HOOK_SOCKET`) + `HOME`, `AGY_CLI_DISABLE_AUTO_UPDATE=true`, `TERM=dumb`, `MOOI_HOOK_SOCKET`.
- `ALLOW_RULES` — `read_file(*) write_file(*) command(*) read_url(*) execute_url(*) mcp(*)`.

Credential
- `CREDENTIAL_MODE = "agent_oauth"`, `CREDENTIAL_FILES` (pending check A, see below).
- `write_credential(home, credential) -> None` — restores the bundle from `credential.token`; validates every entry; removes listed credential files the bundle lacks.
- `read_credential(home) -> str | None` — current bundle (canonical JSON) or None when signed out; refuses links / files leaving the home.

Hook bridge
- `HOOK_SOCKET_VARIABLE = "MOOI_HOOK_SOCKET"`, `QUESTION_TOOL = "ask_question"`, `HOOK_TIMEOUT_SECONDS = 86400`, `DECISION_TIMEOUT_SECONDS = 86100`.
- `HookHandler = Callable[[dict], Coroutine[..., dict]]` — receives agy's `PreToolUse` input, returns a decision.
- `allow()`, `deny(reason)`, `answer(text)` (= `deny("The user's answer: <text>")`) — decisions.
- `tool_call(payload) -> (name, args, call_id, step_index)`, `questions(payload) -> list[dict] | None` — input helpers.
- `HookBridge(handler, *, timeout=DECISION_TIMEOUT_SECONDS)`: `await start() -> Path` (socket), `path`, `deny_pending(reason=None)`, `await close()`.

Stream
- `stream_arguments(binary, home, *, model, effort, conversation_id=None, log_file=None) -> list[str]`.
- `Stream(binary, home, *, cwd, env, model, effort, conversation_id=None)`: `await start()`, `await ready(timeout=120) -> init dict`, `await send(text)`, `turn(text) -> AsyncIterator[event]` (until its `result`, included; raises if the process dies first), `events() -> AsyncIterator[event]`, `await interrupt(timeout=10) -> exit code`, `await close(timeout=10)`, properties `conversation_id`, `init`, `alive`, `pid`, `returncode`, `stderr_tail`, `failure`, `log_file`.

One-shot helpers (each a separate `agy` process with stdin closed; the caller serialises them per conversation)
- `models(binary, home, *, key=None, env=None, refresh=False, timeout=60) -> list[{"id","label","efforts","defaultEffort","contextWindow","images"}]` — `agy models` grouped by base id, cached 5 min per `key`. `parse_models(text)`, `context_window(model)` (static `CONTEXT_WINDOWS` by prefix; adjust when Google publishes windows), `EFFORTS`, `DEFAULT_EFFORT`.
- `usage(binary, home, *, key=None, model=None, env=None, refresh=False, timeout=60) -> dict` — `agy -p=/usage --output-format json`, buckets cached 1 min per `key`, best effort (last reading or `{}`). `usage_windows(buckets, model=None)` builds the KPI dict.
- `compact(binary, home, conversation_id, *, cwd, env=None, model=None, effort=None, timeout=600) -> result dict` — `agy -p=/compact --conversation <id> --output-format json`; raises unless `status == "SUCCESS"`.

Transcripts / logs
- `brain_dir(home)`, `transcript(home, conversation_id, *, full=True) -> Path` (`transcript_full.jsonl` or `transcript.jsonl`; also for a subagent id), `subagent_transcript(home, log_uri) -> Path | None` (only inside this home's `brain/`).
- `TranscriptReader(path, *, max_bytes=16 MiB)`: `read() -> list[dict]` new complete records since the last call (blocking: `asyncio.to_thread`), `restarted` after truncation/replacement.
- `session_logs(home) -> list[Path]` — `conversations/*.db(-wal|-shm)`, `log/*.log`, `cli.log`, `brain/*/.system_generated/logs/*.jsonl` and `chunks/*`.

### Credential bundle contract (F4 must match)

- mic-mooi provider `antigravity`, single mode `AGENT_OAUTH`; mic-sessions sees `Credential.mode == "agent_oauth"`.
- `Credential.token` **is the bundle**: a JSON object string `{"<path relative to HOME>": "<standard base64 of the
  file bytes>"}`; every path is relative, has no `..`, and lies strictly under `.gemini/antigravity-cli/`; each
  file ≤ 1 MiB. Mooi never interprets the files. `expires_at` and `refresh_token` are `None` (agy owns renewal).
- Canonical form: `json.dumps(bundle, sort_keys=True, separators=(",", ":"))`, exactly what `read_credential`
  returns. F4 captures the bundle after `agy acp --login` with `read_credential(<temp home>)` (None = login
  failed) and sends it as `token` to `link_antigravity`. mic-mooi stores it encrypted as one opaque string
  (like Codex `auth.json`), never logs it.
- Write-back (D5): after each stream/one-shot process exits, F2 calls `read_credential(home)`; when it differs
  from `credential.token` (and is not None) it calls `credential.save(bundle)`, i.e. `PUT
  /me/agents/antigravity/credential {"token": <bundle>, "connectionId"}`. F4: `mooi.fetch_agent_credential`
  must wire `save` for `antigravity` too (today only `codex`), and mic-mooi must accept the PUT for the new mode
  (owner + connection checked). A `None` read (agy signed out) must not overwrite the stored bundle.
- **Pending check A:** `CREDENTIAL_FILES` holds the file name(s) agy writes; today
  `(".gemini/antigravity-cli/antigravity-oauth-token",)`, the name reported upstream, unverified. Update that one
  constant after check A; the bundle format does not change. If check C shows refresh-token rotation, F2 needs a
  per-account lock around process runs + write-back.

### Hook bridge contract

- `prepare_home` writes `$HOME/.gemini/config/hooks.json`:
  `{"mooi":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"<sys.executable> -I <home>/.mooi/pretooluse_hook.py","timeout":86400}]}]}}`
  (agy runs it with `sh -c`, cwd = `.gemini/config`, agy's env). The matcher covers every tool, `ask_question` included.
- The hook script (stdlib only) reads all of stdin, connects to `$MOOI_HOOK_SOCKET` (AF_UNIX), sends the bytes,
  half-closes, reads the reply until EOF and prints it if it is `{"decision":"allow"|"deny",...}`; otherwise
  (no variable, no socket, bad reply) it prints `{"decision":"deny","reason":"Mooi could not be reached…"}`
  (fail closed). Exit 0 always.
- `HookBridge` socket lives in `mkdtemp("mooi-agy-")` (0700, socket 0600; short path because of the 104/108-byte
  limit), one connection per call, calls concurrent. The handler result is reduced to `allow` or `deny`+reason
  (headless agy cannot `ask`). Handler timeout (`DECISION_TIMEOUT_SECONDS`, 5 min under the hook's 24 h) →
  deny "No answer arrived in time"; handler error → deny; `deny_pending(reason)` / `close()` → deny with the stop
  reason; after `close()` hooks fail closed. Mooi's cards have no timeout of their own, so the 24 h hook
  timeout is the effective card limit.
- Questions: `questions(payload)` gives `[{question, options, is_multi_select}]`; reply `answer("<text>")`.
  Permissions: `tool_call(payload)` gives full args (the stream's `tool_info.parameters` are abridged) and
  `stepIdx` == stream `step_index` (correlate the card with the tool step). "Allow all" sessions: handler
  returns `allow()` without a card.
- The socket path is in the env of the agent's own commands (same uid): a command could raise a card, never answer one.

### What F2 must know

- Order per session: `prepare_home` → `HookBridge.start()` → `Stream(..., env=environment(home, vars, hook_socket=bridge.path))`
  → `start()` → `ready()` (init comes before any input, ~2.4 s observed) → `turn()` per queued message. Keep the
  bridge across stream restarts; `close()` it with the session; clean the home on session close.
- Events are nested: `{"event":"step_update","step_update":{…}}`, `{"event":"result","result":{…}}`; `init`
  carries `conversation_id` at the top level. `result.status` `SUCCESS|ERROR`; `result.error` `"interrupted"` on
  interrupt (F0 saw `finished_reason` too).
- Stream flags include `--disable-slash-commands` (a player message starting with `/` stays text instead of
  ending the session). `--settings` is the file `.mooi/settings.json`; `--log-file` is a fresh
  `log/mooi-stream-*.log` per process (collected by `session_logs`).
- `interrupt()` sends SIGINT to agy only, then SIGTERM/SIGKILL to the group if needed; the process **exits**
  (exit 1): F2 must restart with `conversation_id=stream.conversation_id`. Observed ~4 s mid-`run_command`
  (F0: 0.2 s), so keep the 10 s budget. Call `bridge.deny_pending()` on interrupt/stop.
- Model change, compaction, restart: only after the stream process exited (`close()`), then
  `compact(...)` / new `Stream(..., conversation_id=…)`. `models()` / `usage()` may run any time (no
  conversation). `usage(model=<base>)` sets `five_hour` / `seven_day` from the model's quota family (the
  Argon-specific weekly bucket for Argon, if most used); other buckets stay as extras keyed
  `Claude_and_GPT_models_5h` etc.
- Context KPI = latest `agent_response` `usage.input_tokens`; window = catalogue `contextWindow`
  (static, `CONTEXT_WINDOWS`). `images` is False for `gpt-oss-*`.
- `write_credential` raises for a non-`agent_oauth` credential (old Gemini links): surface "sign in again".
- `gemini.py`, the Gemini runtimes and `agent_gemini_*` settings are still in place: F2 swaps the runtime and deletes them.

---

## F2 implementation notes

Delivered in `mic-sessions` (no commit): `shared/agents.py` gains `AntigravityCliAgentRuntime` and the provider
`PROVIDERS["antigravity"] = ProviderDescriptor("antigravity", "Antigravity", (AdapterDescriptor("cli",
"Antigravity CLI", AntigravityCliAgentRuntime),))`; the `gemini` provider, `_GeminiRuntime`, `_GeminiStream`,
`GeminiAcpAgentRuntime`, `GeminiCliAgentRuntime` and every `_gemini_*` helper are gone, and so are
`shared/gemini.py` (nothing imported it any more: `traces.py` only *parses* Gemini logs, it never imported the
module) and the `agent_gemini_cli` / `agent_gemini_model` settings in `env.py` (`extra="ignore"`, so a stale
`AGENT_GEMINI_*` in an `.env` is harmless). `mooi.fetch_agent_credential` wires `save` for `antigravity` too
(D5 write-back). `traces.py`: only `"antigravity"` added to `TraceFormat`. `features/sessions.py`,
`workspaces.py` and `agent_connections.py` had no Gemini- or provider-specific runtime branches: unchanged.

Sanity-run on the macOS `agy 1.5.5` (`gemini-3.8-flash`, scratch workspace, the real `HOME` only for the
Keychain sign-in with Mooi's home files redirected to scratch, so no hooks there): start + quota + context,
a turn with a file write and a command (tool use/result, deltas, message, turn usage), an effort change
(relaunch with `--conversation`), an interrupt mid-`sleep` (0.6 s, open step failed, `interrupted` turn),
a resumed turn, `/compact` (8 s) and a follow-up that still knew the earlier file, `close()`. One conversation.
Offline (recorded F0 transcripts / fake frames): thinking from `transcript_full.jsonl`, a subagent's
delegation + nested message + completion, deferred file edits with hook arguments, a question card answered
and one denied by an interrupt, the user-facing error mapping.

### Capability matrix as implemented

| Feature | `AgentCapabilities` | How |
| --- | --- | --- |
| Streaming | `streaming` | `agent_response` `text_delta` → `assistant.delta`; `DONE` (its delta is the last chunk) → `assistant.message` |
| Thinking | `thinking` | `thinking.message` per completed step from `brain/<id>/…/transcript_full.jsonl` (`PLANNER_RESPONSE.thinking`), read on each finished response, every 1 s during a turn and at its end; records left over when the next message is sent are dropped (never attributed to the wrong turn). No thinking deltas. Lands after the step's text. `gemini-3.8-flash-low` wrote no thinking text in the sanity run. |
| Tools | always | `tool` steps keyed by `step_index`: `ACTIVE` → `tool.use`, `DONE`/`ERROR` → `tool.result`. Names mapped to the shared vocabulary (`run_command`→`Bash`, `read_file`/`view_file`→`Read`, `write_file`/`write_to_file`→`Write`, `replace_file_content`/`edit_file`/`sed_file`→`Edit`, `ReplacementChunks`→`MultiEdit`, `list_dir`→`LS`, `grep_search`→`Grep`, `find_by_name`→`Glob`, `search_web`→`WebSearch`, `read_url_content`→`WebFetch`; others keep agy's name). File tools defer their `tool.use` to the step's end and use the full arguments the hook saw (`(conversationId, stepIdx)`), so edits carry content/diffs; without a hook call they fall back to the abridged stream parameters. An image file opened with `read_file`/`view_file` (not the player's own attachment) is stored and shown on the result. |
| Changes | (platform) | nothing adapter-specific: every `tool.result` / `turn.result` already schedules the git-based changes refresh in `sessions.py`. |
| Subagents | always | `subagent` step → one `Agent` `tool.use` per `subagent_info.subagents[]` (`prompt`, `description`=role, `subagent_type`, `run_in_background`) + `subagent.updated` `started`, `detached: true`, `agentId` = sub conversation id. The sub's `transcript_full.jsonl` is polled (during turns, and between turns while it still works, up to 15 min idle): thinking, messages, `tool_calls` → nested `tool.use`, following `GENERIC` records → nested `tool.result` (all with `parentToolUseId`), `working` + `lastToolName`; a response without tool calls = its report → `completed` + summary. |
| Permissions | off | like every other adapter, tools run without a card: the hook answers `allow` for every non-question call (after an interrupt / during close: `deny`). |
| Questions | `questions` | hook on `ask_question` → `question.request` (`header` "Question", `multiSelect` = `is_multi_select`, string options → `{label, description: ""}`) + `ask(QuestionRequest)`; `resolve()` → `antigravity.answer(text)` (one question: its answer; several: `question: answer` lines; `response` appended). Deny/interrupt/turn end/close → `deny`; a call the bridge abandons (24 h, stop) resolves its card as denied. The stream's `unknown` step for the question shows nothing. |
| Images | `images` | `save_attachment` per image, the prompt gets a note listing the paths to open with `view_file`. |
| Interrupt | `interrupt` | Mooi cards + bridge denied, `Stream.interrupt()` (SIGINT), the `result` (`error: "interrupted"`) or, if none came, the process exit ends the turn `interrupted`; open steps fail; the next process is launched in the background with `--conversation`. |
| Compaction | manual + auto | `compact()` under the stream lock: retire the process, `antigravity.compact()` one-shot, write back, then relaunch in the background; emits `context: None` (sessions.py emits the `session.compaction` phases). **Instructions are ignored** (agy's `/compact` takes none in F1's helper). agy's own `checkpoint` step → `agent.activity` `compact_boundary`. |
| Model / effort | always | catalogue from `antigravity.models()` in a throwaway home (cached 5 min per connection), `configure()` like Codex (base id + one of its efforts; `defaultEffort` per entry); `set_configuration()` relaunches with `--conversation` before the next turn (a failing launch surfaces through `_prepare_turn`), and re-reads the quota for the new model's family. |
| Context KPI | always | `input_tokens + output_tokens` of the latest `agent_response` usage; window `antigravity.context_window(model)` (static). `0` after start, `None` after `/compact` until the next response. |
| Limit KPIs | always | `antigravity.usage(..., model=<base>)` at start, after each turn, after compaction/model change and on `refresh_usage()`; emitted only when a reading changed (same `{percent, window, resetsAt, updatedAt}` shape as Gemini's quota, keys `five_hour`/`seven_day` + extras). |
| Turn usage | always | difference of the cumulative `result.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `thinking_tokens`); the compaction result's totals are taken over. Duration measured locally. No cost. |
| Recover | always | `recover()` keeps a live process on the current configuration, else launches one with `--conversation`; an unexpected exit is recovered on the pump with the shared backoff (`agent_recovery_attempts`), `turn.result` `error`/`stream_interrupted` for a turn it cut, `failed` + `RECOVERABLE_DETAIL` when every attempt fails. |
| Asides | off | `aside()` raises `ApiException.conflict` (print mode has no tool-less fork). |
| Credential | — | `refresh_credential()` keeps a different platform bundle for the next launch (`write_credential` only when it differs from what the home holds); after every process exit (stream, compaction, `/usage`, the catalogue's throwaway home), after each turn and on close, `read_credential()` → `credential.save(bundle)` when agy renewed it; `None` never overwrites. Save failures are logged only. |

### Things F3–F6 must know

- **Trace source shape (F3):** `trace_sources()` returns `[TraceSource("antigravity", <home>/.mooi/stream.jsonl)]`
  as soon as the home exists. That file is Mooi's own frame record (append-only, 0600, capped at 64 MiB): every
  frame agy printed, as received, plus `mooiAt` (epoch seconds), and Mooi records `{"event": "mooi.user",
  "text"}` (the exact prompt sent, attachment note included), `{"event": "mooi.process", "phase":
  "started"|"exited", "conversation_id", "model", "effort", "resumed" | "returncode", "expected"}` and
  `{"event": "mooi.compact", "phase": "started"|"completed", "conversation_id" | "result"}`. The home is
  `path.parents[1]`; conversation ids come from the frames; brain transcripts via
  `antigravity.transcript(home, id)` (subagent ids from `subagent_info`), raw files via
  `antigravity.session_logs(home)`. Today `_discover` yields nothing for it (a file is no Claude `projects`
  directory), so Trace and *Download log* are empty for Antigravity until F3 adds the branch. The Gemini parser
  and `"gemini"` literal are still in `traces.py` (F3 removes them).
- **F4:** `mooi.fetch_agent_credential` already wires `save` for `antigravity`; mic-mooi must accept `PUT
  /me/agents/antigravity/credential` for `AGENT_OAUTH` and send `mode: "agent_oauth"`. An old Gemini connection
  (`mode` `oauth`/`api_key`) fails at start with "The Antigravity sign-in is no longer valid. Sign in with Google
  again…" (an `error` event) and in the model picker with the same text (502).
- **F5:** the provider id is `antigravity`, label `Antigravity`, one adapter `cli` / `Antigravity CLI`; catalogue
  entries carry `id` (base model), `label`, `efforts`, `defaultEffort`, `contextWindow`, `images` (False for
  `gpt-oss-*`); `capabilities.permissions` and `asides` are False, so no permission cards and no `/btw`.
- **F6:** still referencing Gemini: `mic-sessions/.env.example` (`AGENT_GEMINI_CLI`, `AGENT_GEMINI_MODEL`),
  `mic-sessions/Dockerfile` (npm `@google/gemini-cli`, comment), `traces.py` (F3), mic-mooi, SPA, README,
  AGENTS.md. `env.py` already has only the `agent_antigravity_*` settings.
- Instructions go to `$HOME/.gemini/GEMINI.md`: the shared conduct rules (edit tools named `write_to_file`,
  `replace_file_content`, `multi_replace_file_content`), image delivery through `view_file`, a
  non-interactive-commands rule (F0 #9), then the session's instructions.
- Every process is serialized per conversation by one stream lock (launch, relaunch, compaction); `/usage`
  runs beside the stream. If check C shows refresh-token rotation, the write-back needs a per-account lock
  across sessions (not done).

---

## F4a implementation notes (mic-mooi)

Delivered in `mic-mooi` (compiles: `JAVA_HOME=<temurin-25> ./mvnw -q -DskipTests compile`; the default JDK 27
breaks Lombok's annotation processor, unrelated to this change).

### Provider and mode

- `Agents.Mode.AGENT_OAUTH` (wire `agent_oauth`) and `Mode.agentOwned()` (true for `device_oauth` and
  `agent_oauth`: the provider's binary signs in and renews, mic-mooi only stores the written-back copy).
- Provider `antigravity` ("Antigravity"), modes `["agent_oauth"]`, `oauthEnabled: false` in
  `GET /me/agents/providers` (like Codex: the platform's own PKCE sign-in is not offered; the SPA links it
  through mic-sessions). `Provider.agentOwnedMode()` picks the mode for link and write-back.
- `Agents.AgentOAuthBundle.isValid(token)` checks the shape only (never decodes a file, never logs): ≤ 256 KiB,
  a non-empty JSON object of ≤ 32 entries, every key a relative path under `.gemini/antigravity-cli/` (segments
  `[A-Za-z0-9._-]+`, no `.`/`..`, ≤ 255 chars), every value a string in the standard base64 alphabet (length
  multiple of 4). Stored exactly as received (sealed by `Crypto.SecretBox` in `access_token`), so the session's
  byte-for-byte comparison with `read_credential()` stays meaningful.
- Removed: `Mode.API_KEY`, `Dialect`, `GoogleOAuthClient`, `Provider.clientSecret/tokenRefreshSkew/
  sharesRefreshToken/dialect`, the Gemini OAuth constants, `app.agents.gemini.*` and `AGENT_GEMINI_ENABLED`,
  `AGENT_GEMINI_CLIENT_ID`, `AGENT_GEMINI_CLIENT_SECRET`, `AGENT_GEMINI_TOKEN_REFRESH_SKEW`
  (`application.yml`, `mic-mooi/.env.example`). No Antigravity setting was added.
- Renewal: only `oauth` rows are renewed (lazily in `credential()`; there is no scheduled job), so `agent_oauth`
  (like `device_oauth`) is never refreshed by the platform.

### HTTP contracts mic-sessions calls

All three are service-only: `Authorization: Bearer <player access token>` **and** `X-Service-Token`
(`_service_headers(caller)`); the player comes from the bearer token, never from the body.

1. **Link** — `POST /me/agents/antigravity/agent-connection`
   - Request: `{"token": "<bundle, canonical JSON string>", "accountLabel": "<email or 'email · tier'>|null",
     "name": "<display name, required, ≤ 100>"}`. `accountLabel` is stripped, blank → null, ≤ 255.
   - 200: `AgentConnectionPayload` `{"id","provider":"antigravity","label":"Antigravity","name","mode":"agent_oauth",
     "accountLabel","scope":null,"connectedAt","expiresAt":null,"stale":false,"defaultAccount"}`.
   - 400 `Invalid token` for a bad bundle/label/name; 400 validation error for a blank token/name; 401/403 without
     a player token or the service token. Suggested helper (mirrors `link_codex`):
     `link_antigravity(caller, token, account_label, name)` posting to that path, error message
     "Could not save the Antigravity connection".
2. **Credential** (unchanged, generic) — `GET /me/agents/connections/{connectionId}/credential` → 
   `{"provider":"antigravity","mode":"agent_oauth","token":"<bundle>","expiresAt":null,
   "connectionId":"<credential id>","sessionModel","sessionEffort","sessionAdapter"}`.
   `connectionId` is the connection's **credential id** (not the row id); it is what the write-back must send.
   **`refreshToken` is no longer in the payload** for any provider (it existed only for Gemini):
   `body.get("refreshToken")` yields `None`; F2 may drop `Credential.refresh_token`.
3. **Write-back (D5)** (unchanged path, now generic over agent-owned modes) — `PUT /me/agents/antigravity/credential`
   - Request: `{"token": "<renewed bundle>", "connectionId": "<credential id from the credential payload>"}`.
   - 204 on success. 409 (`reauthorize`) when the connection is no longer the caller's / of this provider and
     mode / of that credential id (relinked or dropped: never overwrites another link), or for a provider with
     no agent-owned mode (e.g. `claude`). 400 `Invalid token` when the bundle shape is invalid (Codex: blank or
     > 64 KiB; before, Codex answered 409 for an oversized token). The update is one atomic `UPDATE … WHERE
     player, provider, mode, credential_id`. Already matches `mooi.fetch_agent_credential`'s `save`
     (wired for `("codex", "antigravity")`). Never call it with a `None` bundle.

Codex is unchanged on the wire (`POST /me/agents/codex/device-connection`, same body); both link endpoints share
`AgentConnectionService.connectAgentOwned`.

### Migration `036-antigravity-provider.yaml`

- Deletes `agent_account_preferences` rows pointing at `gemini` connections (the FK would only `SET NULL`), then
  every `gemini` row of `agent_connections` (OAuth and API key), then the `gemini` row of
  `agent_engine_defaults`; inserts `('antigravity', session_adapter 'cli')` with model/effort NULL.
  No other table references `agent_connections`; sessions live in mic-sessions memory, so a running session
  on a removed link fails on its next credential fetch (409 `reauthorize`, "connect again").
- Rollback (like 035): removes Antigravity connections, their preferences and defaults row, re-inserts the
  `gemini` defaults row. Deleted Gemini links are not restored (players relink).
- No entity/column change: `mode` is `varchar(16)` (`agent_oauth` fits), `access_token` is `text`.

### Left for other phases

- `deploy/production/.env.example` and `deploy/production/compose.prod.yml` still pass `AGENT_GEMINI_*` to
  mic-mooi (now ignored) and `AGENT_GEMINI_MODEL` to mic-sessions: owned by the Mooi production feature (F6).
- SPA (F5): `api_key` mode and the Gemini PKCE pairing no longer exist server-side; Antigravity links through
  mic-sessions only.

---

## F3 implementation notes

Delivered in `mic-sessions/src/mic_sessions/shared/traces.py` only (no commit; `agents.py` / `antigravity.py` untouched:
`trace_sources()` and `session_logs()` were already what F3 needs). `_GeminiParser`, `_gemini_text`, `_gemini_result`, the
`gemini` branch of `_discover` and the `"gemini"` literal of `TraceFormat` are gone; `traces.py` now imports `antigravity`.

### Trace model

- **Source:** `TraceSource("antigravity", <home>/.mooi/stream.jsonl)`; `_discover` yields `_AntigravityParser` for it, then one
  `_AntigravityTranscript` per conversation id the frames named (`brain/<id>/.system_generated/logs/transcript_full.jsonl`) and
  per delegated agent (`transcript_full.jsonl`, else the stream's `log_uri` transcript). Incremental reading is the shared
  `TraceReader._read` (byte offset per file); both files are read in either order (shared `reader.agy` state, idempotent
  `_agy_refresh` joins a model call with its transcript record).
- **Prompt** = `mooi.user` up to its `result` (ok / `interrupted` / error; `result.response` = output, cumulative usage, `num_turns`
  in metadata). Work with no `mooi.user` before it (background task waking the agent) gets an implicit prompt.
- **Turn** = one `agent_response` step: LLM span (usage: `input` = prompt tokens minus `cache_read_tokens`, `cacheRead`, `output`,
  `reasoning` = `thinking_tokens` which agy counts inside `output_tokens`, `context` = `input_tokens`; model/effort from `init` /
  `mooi.process`; start = DONE time minus `duration_seconds`), then the `tool` steps after it (keyed by `step_index`;
  `tool_info.output` / `error {type,message}`; `run_command` non-zero exit = error). Streamed `text_delta`s form the call's text;
  the transcript adds `[thinking]` and replaces abridged stream parameters with the full `tool_calls[].args` (matched by name, then order).
- **Sub-agents:** each `subagent_info.subagents[]` entry = one `agent` span under the requesting turn (role / type, `initial_prompt`
  as input), linked via `reader.agent_tools`; its own turns / LLM calls / tools are built from its transcript (`PLANNER_RESPONSE`
  with `tool_calls`, following `GENERIC` records close the tools in order) and nested there. The agent span closes when the
  sub-agent answers without tool calls (output = its report); until then it is running / incomplete as for other providers.
- **Compactions:** `mooi.compact` started/completed = one span (between prompts); the transcript `CHECKPOINT` summary is joined to it
  by time window, or to the stream's `checkpoint` step (auto compaction) by step index, else a span of its own.
- **Context:** `system_message` steps (text from the transcript) and `USER_SETTINGS_CHANGE` blocks of the prompt's `USER_INPUT`.
- **Hooks:** the frame record holds no hook calls, so: `result.denied_actions` -> `hook` spans "Permission denied: ..." (error) and
  the `unknown` (`ask_question`) step -> `hook` span "Question" lasting until answered.
- **Errors:** `result` with status != SUCCESS (not `interrupted`) -> `event` "Error" (`error`, `finished_reason`) + prompt error;
  `mooi.process exited` with `expected: false` -> `event` "Process exited" + error; an expected exit with a prompt still open ->
  `interrupted`. Open LLM / tool / question spans close with the prompt's status.
- Metadata: `provider: antigravity`, `permissionMode` (from `init`).

### Download log

`session_logs(home)` is added to `reader.logs` on every sync (names relative to `<home>/.gemini/antigravity-cli`: `brain/...`,
`conversations/*.db(-wal|-shm)`, `log/*.log`, `cli.log`), plus Mooi's `stream.jsonl` (relative to `<home>/.mooi`). Retention is the
shared mechanism: `SessionTrace.archive` syncs and `freeze(keep)` hard-links (copies) every discovered file before the runtime
deletes the home on clear, so cleared conversations stay downloadable. Each runtime owns its home, so a conversation's logs never mix.

### Verification

`uvx ruff check` clean; `uvx pyright traces.py`: 7 baseline errors -> 3 (all pre-existing, Codex / `_build`; three Claude
`block.get("input")` ones disappeared by using the new `_mapping` helper); `mic_sessions.shared.traces` and
`mic_sessions.features.sessions` import. Offline run on the F0 / F2 recordings (scratch only): prompts, turns with usage, tools,
interrupted prompt (tool + prompt `interrupted`), compaction, system-message context, a delegated agent with nested transcript turns
and thinking, 66 log files archived with `freeze(keep)`. Not exercised: live incremental append (generic reader), a thinking-bearing
main-conversation record, a `hook` question, an unexpected process exit.

### Assumptions to confirm against a live run

- `input_tokens` includes cached tokens (`total_tokens == input + output`; `cache_read_tokens` was 0 in every sample).
- `unknown` step = `ask_question` (F0); a question's content is not in the frames, only its duration.

## F6 implementation notes

- `mic-sessions/Dockerfile`: the `@google/gemini-cli` block (`GEMINI_CLI_VERSION`) is gone; nothing else
  depended on it. `agy` is installed pinned: `ARG AGY_VERSION=1.5.5`, `AGY_BUILD=6740358537805824`,
  `AGY_SHA512_AMD64` / `AGY_SHA512_ARM64` (read from the public updater manifests `linux_amd64` /
  `linux_arm64`, both reporting version 1.5.5). Per-arch URL
  `https://storage.googleapis.com/antigravity-public/antigravity-cli/${AGY_VERSION}-${AGY_BUILD}/linux-x64/cli_linux_x64.tar.gz`
  (`linux-arm/cli_linux_arm64.tar.gz` on arm64), `sha512sum -c`, the tarball's single file `antigravity`
  installed as `/usr/local/bin/agy`, `agy --version`, `ENV AGY_CLI_DISABLE_AUTO_UPDATE=true`. Never the
  installer script. Not built (docker off) and `hadolint` is not installed: checked by inspection only.
  **Bump:** fetch both manifests, set `AGY_VERSION`, `AGY_BUILD` (the segment after the version in the
  `url`) and both SHA512s together.
- `mic-sessions/.env.example`: Gemini section replaced by `AGENT_ANTIGRAVITY_CLI=agy`,
  `AGENT_ANTIGRAVITY_MODEL=gemini-4-argon`, `AGENT_ANTIGRAVITY_EFFORT=medium` (names/defaults match
  `shared/env.py`), with the local install hint.
- `README.md` (badge, provider list, connect step) and `AGENTS.md` *Context* (providers, single Antigravity
  CLI adapter on stream-json, sign-in by agy's own OAuth with pasted code and no API key, agy self-renewal
  exception, Trace log kinds) now state Antigravity.
- Remaining Gemini CLI mentions are code, not edited: `spa-mooi/src/features/agents/components/AuthorizationCodePairing.tsx`
  and `spa-mooi/src/features/agents/lib/agentProviderCopy.ts` (SPA phase).
- **Production channel (not edited, owned by the Mooi production feature):** `deploy/production/.env.example`
  and `compose.prod.yml` still reference `AGENT_GEMINI_*`; a Mooi production chat must drop them and wire
  the `AGENT_ANTIGRAVITY_*` settings.

---

## F4b implementation notes (mic-sessions)

Delivered in `mic-sessions` (no commit): `shared/antigravity.py` gains the sign-in helper (appended at the end),
`features/agent_connections.py` the Antigravity linking endpoints next to Codex's, `shared/mooi.py`
`link_antigravity()`; `Credential.refresh_token` is dropped (nothing read it; mic-mooi no longer sends it). The
write-back `save` already matched F4a (`PUT /me/agents/antigravity/credential {"token","connectionId"}`, service
token + bearer): unchanged. Sanity-run on the macOS `agy 1.5.5`: `Login.start()` in a scratch root printed the
URL in 0.3 s (`https://accounts.google.com/o/oauth2/auth?…redirect_uri=https://antigravity.google/oauth-callback…`),
`close()` ended agy (exit 1) and removed the home; no code was submitted (submit/identity paths are unverified
until a real sign-in, which also settles check A).

### Transport (`antigravity.py`)

- `Login(binary, *, root=None)`: `await start(timeout=45) -> url` spawns `agy acp --login` (one-shot login helper,
  not the ACP adapter) in `mkdtemp("mooi-agy-login-")` (0700) with `environment(home)` (minimal env,
  `AGY_CLI_DISABLE_AUTO_UPDATE=true`), pipes only, own process group; the URL is the first stdout token accepted
  by `login_url()` (https, host exactly `accounts.google.com`, no userinfo/port, path `/o/oauth2/…`).
  `await submit(code, timeout=120) -> (bundle, account | None)` validates with `login_code()`, writes
  `code + "\n"` once, **closes stdin** (a refused code that re-prompts reads EOF and exits instead of hanging),
  waits for exit, then `read_credential(home)` (None → failure). `await close()` (idempotent) cancels the login
  (stdin EOF, then TERM/KILL of the group) and removes the home. One code per attempt.
- `LoginError(kind, cause, detail)` (subclass of `AntigravityError`): `invalid` (bad paste, attempt kept),
  `rejected` (Google refused: wrong/expired; detected from agy's output: `invalid_grant`/`invalid`/`expired`/
  `malformed`), `ended` (no code reached agy, already used, helper exited), `timeout`, `failed`. `cause` is a
  user-facing sentence; `detail` (exit code + last stderr line, with the pasted code and every URL redacted) is
  logged only.
- **Account label source:** agy prints/logs `Logged in as %s.`, `Successfully authenticated as %s.`,
  `Print mode: authenticated as %s` (strings in the 1.5.5 binary). `login_account()` takes only an email address
  from such a line: first from the login's own stdout/stderr; if none, one best-effort `agy -p=/usage
  --output-format json --log-file <home>/…/log/mooi-identity-*.log` (no LLM call, 30 s) on the new home and the
  same scan over its stderr and log tail. No token file is ever read for it. When still nothing: the label is
  **`"Google account"`** (the tier is only exposed through ACP `session/new`, not used). Unverified until a real
  sign-in shows which line agy prints.

### Browser-facing HTTP contract (SPA, F5)

All on mic-sessions (`sessionsFetch`), `Authorization: Bearer <player access token>`; errors use the shared
`ApiError` JSON (`{"status","message",…}`), `message` user-safe. Attempts are in memory, bound to the caller's
player (another player gets 404), one per player (a new start replaces and closes the previous), at most 32
live, closed after **600 s** if no code arrived, and on cancel / any submit outcome except `invalid`.

1. **Start** — `POST /agents/antigravity/authorization?name=<account title, 1–100 chars>`
   - 200 `{"attemptId": "<32 hex>", "authorizationUrl": "https://accounts.google.com/o/oauth2/auth?…",
     "expiresIn": 600}`. Open the URL in a new tab; Google's page ends on `antigravity.google/oauth-callback`,
     which shows the code to paste.
   - 400 blank title (validation error for a missing/oversized `name`); 429 too many attempts; 502 agy could not
     start / is not installed; 504 agy printed no URL within 45 s; 410 cancelled while starting.
2. **Submit the code** — `POST /agents/antigravity/authorization/{attemptId}/code`, body `{"code": "<the code
   Google showed, or the full URL of the page landed on>"}` (1–4096 chars).
   - 200: mic-mooi's `AgentConnectionPayload` as is (`{"id","provider":"antigravity","label":"Antigravity",
     "name","mode":"agent_oauth","accountLabel":"<email>|"Google account"","scope":null,"connectedAt",
     "expiresAt":null,"stale":false,"defaultAccount"}`) → `upsertConnection` like `AuthorizationCodePairing`.
     Takes a few seconds (token exchange, optional identity probe, link).
   - 400 `invalid` (empty, several lines, control characters, too long: the attempt **stays usable**, fix and
     resend) or `rejected` (Google refused the code: the attempt is gone, start again); 404 unknown/foreign/expired
     attempt; 409 a code for this attempt is already being redeemed; 410 the sign-in ended (start again); 504 agy
     did not finish within 120 s; 502 agy failed or stored no sign-in; mic-mooi's 4xx from the link (e.g. 400
     `Invalid token`) and 502 when it is unreachable. Every outcome but `invalid` closes the attempt.
3. **Cancel** — `DELETE /agents/antigravity/authorization/{attemptId}` → 204 (kills agy, removes the temporary
   home); 404 unknown/foreign attempt. Call it when the dialog closes before a successful submit.

The bundle, the pasted code and agy's output never reach the browser or the logs (only lengths, exit codes and
redacted last lines). Service shutdown closes every attempt (`close_all`).

### mic-mooi call

`mooi.link_antigravity(caller, token, account_label, name) -> dict`: `POST /me/agents/antigravity/agent-connection`
`{"token","accountLabel","name"}` with `_service_headers(caller)` (bearer + `X-Service-Token`), the caller renewed
first (`mooi.renewed`, since the exchange may outlast the request's token); network errors → 502; 4xx re-raised
with mic-mooi's message ("Could not save the Antigravity connection" by default); answers the payload.

## F5 implementation notes

Delivered in `spa-mooi` (no commit). `npm run typecheck` and `npm run build` pass (the >500 kB chunk warning is
pre-existing); the project has no lint script. Nothing was run in a browser.

- **Types/copy**: `AgentConnectionMode` is `oauth | setup_token | device_oauth | agent_oauth` (`api_key` gone).
  `agentProviderCopy.ts`: `gemini` entry replaced by `antigravity` (Google sign-in copy; the models/limits follow
  the Antigravity plan). Provider list, labels and ids come from the API (`antigravity` / "Antigravity"); no
  Gemini id, model or quota label is hardcoded anywhere in `spa-mooi/src` (usage windows and the model picker
  read the catalogue/quota payload; the adapter pickers already hide for a single adapter). A stale `gemini`
  connection or provider id simply falls back to the generic copy/labels.
- **API**: `features/agents/api/antigravityApi.ts` (sessions API: start / complete / cancel) with
  `AntigravityAuthorizationError(status)`; 404/409/410/429/502/504 map to friendly copy, 400 keeps the server's
  wording. Type `AntigravityAuthorization`.
- **UI**: new `AntigravityPairing.tsx` (starts the attempt deferred so a dev double mount never starts two, opens
  Google's URL in a new tab, paste field, submit; 400 and 409 keep the attempt and the field editable, any other
  error closes it and offers "Start the sign-in again"; cancels via DELETE on unmount/close unless linked).
  `AddAgentAccountDialog` routes providers with mode `agent_oauth` to it; the "Connect with" method picker and
  the API-key form were removed (only a setup-token paste remains for a provider whose OAuth is off).
  `AuthorizationCodePairing` stays Claude-only; `AgentConnectionsCard` empty-state text names Antigravity.
- No icon change: provider buttons are text-only in this SPA, no brand assets added.

## F7 verification

Static checks only (no stack, browser, Docker build or commit). Baselines taken from `main` in a scratch dir.

### Commands and results

| Check | Result |
| --- | --- |
| `uvx ruff check src` (mic-sessions) | 26 findings vs 33 on `main`: all pre-existing styles (I001, BLE001, ...); the only new one is one `BLE001` in `antigravity.py` (same kind as the Gemini ones it replaces). No new F401 or E-class. PASS |
| `uvx pyright --pythonpath .venv/bin/python src` | 131 errors vs 142 on `main`; per-file diff shows no new error. PASS (baseline noise) |
| `python3 -m compileall -q src` | OK |
| import `mic_sessions.main` with `uv run --no-sync`; `app.app.openapi()` paths | `POST /agents/antigravity/authorization`, `POST .../{key}/code`, `DELETE .../{key}` registered next to the Codex ones. PASS |
| `JAVA_HOME=temurin-25 ./mvnw -q -DskipTests compile` (mic-mooi) | no errors. PASS |
| Liquibase 036 | well-formed YAML (parsed), included last in `db.changelog-master.yaml`, SQL matches tables of 029 (`agent_engine_defaults(provider, session_model, session_effort[, adapter])`, `agent_account_preferences`). PASS |
| `npm run typecheck`, `npm run build` (spa-mooi) | both pass; only the pre-existing >500 kB chunk warning. PASS |

### Contract review

| Contract | Verdict |
| --- | --- |
| SPA `antigravityApi.ts` <-> sessions routes (POST `?name=`, POST `/{id}/code` `{code}`, DELETE; `{attemptId, authorizationUrl, expiresIn}`; connection payload) | OK |
| Sessions `rejected` answered 400 but closes the attempt, while the SPA keeps the attempt on any 400 (retry would 404 "expired") | fixed: `rejected` now 422 in `agent_connections._LOGIN_STATUS`; the SPA closes the attempt and shows the server message with "Start the sign-in again" |
| `link_antigravity` <-> `POST /me/agents/antigravity/agent-connection` (path, bearer + `X-Service-Token`, `{token, accountLabel, name}`, 200 payload, 400 `Invalid token`) | OK |
| Write-back `PUT /me/agents/{provider}/credential {token, connectionId}`; `save` wired for codex + antigravity; any 4xx surfaces as `ApiException` (400 vs old 409 is not branched on: callers in `codex.py`/`agents.py` only call `save`) | OK |
| Credential payload (`refreshToken` gone) <-> `Credential` (field removed, no remaining reader) | OK |
| Bundle from `read_credential` <-> `AgentOAuthBundle.isValid` (relative path under `.gemini/antigravity-cli/`, standard base64, JSON object) | OK; note size limits differ: Python allows 1 MiB per file, mic-mooi 256 KiB for the whole bundle (real token file is a few KB, risk only if agy stores large data) |
| Ids `antigravity` / adapter `cli` / mode `agent_oauth`: sessions PROVIDERS, `Agents.Provider`/`Mode`, migration defaults row, SPA type and dialog | OK |
| Remaining `gemini` references | only `.gemini` agy data dir, `gemini-*` model ids and quota family, the SPA copy listing Gemini models, migrations 035/036 |
| Claude/Codex regressions (`Mode.API_KEY`, `Dialect`, `refreshToken`, `Credential.refresh_token`, setup_token paste, Codex device link and write-back) | OK: everything compiles and typechecks, no leftover callers; Codex oversized token now 400 instead of 409 (no client depends on it) |

### Fixes made
- `mic-sessions/.../features/agent_connections.py`: `rejected` login failure 400 -> 422 (see table).

### Remaining risks
- Check A (credential file name, `CREDENTIAL_FILES`), B (portability) and C (refresh rotation, per-account lock) are unverified: the sign-in submit path, identity label and write-back have never run with a real Google sign-in.
- mic-mooi answering 400 `Invalid token` on link keeps the SPA attempt open while sessions already closed it (rare; retry shows "expired", start again).
- The new `BLE001` and pyright noise are the repo's existing style; the pinned `agy` tarball SHA512s in the Dockerfile were not rebuilt/verified here.

### User manual steps
1. Run pending Linux checks A-C from "Pending user checks" with a real Google account; update `CREDENTIAL_FILES` after A.
2. Production channel: through a Mooi production chat, replace `AGENT_GEMINI_*` with `AGENT_ANTIGRAVITY_CLI`/`AGENT_ANTIGRAVITY_MODEL` in `deploy/production/.env.example` and `compose.prod.yml` (not edited here).
3. Build the mic-sessions image, deploy, link an Antigravity account, run a session (chat, tool permission, question, compaction, Trace download) and confirm Claude and Codex still work; the 036 migration drops existing Gemini links.
