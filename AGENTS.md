# Context

Full product vision of Mooi: what it is and is going to be. Apply it to **every** request: design, name and
structure each change for the whole platform described here. Never build something that blocks or
contradicts a capability below.

The vision runs ahead of the code: many capabilities are not implemented yet, and existing ones may differ
from it. Where they differ, this context wins over the current implementation (see *Source of truth*).

## What Mooi is

- An AI-native **development platform**: take a GitHub project from first prompt to dev preview, production
  deployment and backups, driven by coding agents (Claude Code, Codex).
- Desktop and mobile application (responsive web, mobile shell). Enterprise-grade, startup-modern: awesome
  design, excellent by default in every aspect.
- Multi-user, multi-tenant: users and tenants are fully isolated; every resource is owned and access-checked.
- Engineering bar: efficient, scalable, maintainable, secure, built on proven design patterns.

## What Mooi is not

- Not a single-provider wrapper: providers are pluggable behind one compatible contract.
- Not tied to one hosting target: production and backups work on any platform the user describes.
- Not a public host for dev previews: previews are reachable only through Mooi.
- Not a secret store in Git: development, production and backup variables never reach the repository.
- Not nested virtualization: dev deployments run on the host Docker engine, isolated by network and naming.
- Not two parallel systems for UI and chat: both converge on one mechanism (see *Core principles*).

## Core principles

- **Convergence**: every capability is reachable from UI buttons *and* from the chat; both run the same
  low-level operation. Changes made from one side appear live on the other (deployment setup, variables,
  KPIs, files, status).
- **Real time everywhere**: agent activity, file changes, context/limits KPIs, deployment progress and logs,
  production and backup status stream live to every connected device.
- **Agent writes once, platform reuses**: an LLM turns a free-text description into a deterministic,
  tested script; later runs execute that script without the LLM.
- **Dev ↔ local ↔ production compatibility**: any deployment setup works in Mooi dev sessions, in local
  sessions without Mooi (e.g. Claude Code directly) and in production. Setup prompts enforce it.
- **Isolation by default**: sessions, deployments, tenants and secrets never overlap or leak.

## Identity and projects

- Sign in with Google. Link a GitHub account to list public and private repositories.
- Signed-in devices stay signed in while used: a 30-day sliding refresh token in an `HttpOnly` cookie is
  renewed on every use; 30 days without use requires signing in again.
- Add repositories to Mooi as projects; iterate on them from there.

## Development sessions

- Many sessions per project, technically independent: each has its own branch and its own repository copy
  (worktree/clone), so features progress in parallel without interfering.
- Chat UX like Claude Code / Codex. Supported providers: **Claude** and **Codex**.
- Live view of what the agent does and of changed files on the session branch.
- **Message queue**: messages sent while the agent is busy (a turn, a compaction, a deployment start) wait
  in the chat's queue, kept by the platform and shown live on every device. Each turn's end delivers the
  next one, in order, until the queue is empty, even with no device connected. Queued messages can be
  edited or removed until they go out; stopping a turn keeps the queue, and a failed session holds it until
  it reconnects. Same in development, production and backup chats.
- Provider integration through **adapters** behind one provider-agnostic API: a provider may offer
  several (Claude: **Claude SDK**, the default, and **Claude CLI**, which drives the Claude Code CLI
  natively; Codex: its SDK). Each adapter supports every session feature (streaming, questions,
  interrupt, compaction, model/effort, context and limit KPIs) in its own way; a session picks one with
  its model and effort and keeps it.
- A **Files** tab, always visible in a development session: a project view of the session's working tree
  (folders of folders, search, changed and unsaved markers) beside a plain-text editor. Saving writes into
  the session's own workspace, so edits show up live in Changes and travel with the merge; a save names the
  revision it read, so a concurrent agent edit is reported, never overwritten. Desktop shows tree and editor
  side by side, phones show them one after the other.
- KPIs per session and provider account: context size, session limits, weekly limits, other usage metrics.
- Model and thinking-effort selection per session.
- A **Trace** tab, like Langfuse / LangSmith, shows every internal step of the agent: prompts, turns (one
  agent-loop iteration each: an LLM call with tokens, cache and context size, then the tools it requested),
  nested sub-agents, skills, hooks, injected context, compactions and errors, as a live timeline with an
  inspector and usage insights. **Download log** saves the raw agent session logs the trace was built from
  (Claude transcripts and sub-agent files, Codex rollouts), kept for cleared conversations too. Available in
  development sessions (including the first dev deployment setup), production and backup chats, for every adapter.
- Multiple provider accounts, including several of the same provider; sessions of one project may use the
  same or different accounts.
- Provider accounts link by each provider's own sign-in: Claude like the Claude Code app (OAuth2 + PKCE,
  the code Anthropic shows pasted back; a `claude setup-token` token only when operators turn sign-in
  off, and for existing links), Codex by device code. The platform alone
  renews sign-in tokens, so concurrent sessions of one account never race, and live sessions pick up a
  renewed token on their next message.
- **Agentic merge**: merging an outdated branch with conflicts makes the agent resolve them, preserving
  both sides' features.

## Project to-do list

- Each project has a **To-dos** tab: a view over `docs/TODOS.md` on the default branch, which is the only
  copy. Mooi stores no list of its own.
- Items are open, in progress or done, and are reordered by drag and drop (pointer, touch and keyboard).
  An item's text has no length limit.
- One order everywhere: new items go on top and done items sit at the bottom; completing an item moves it to
  the top of the done items, reopening a done one moves it just below the items still to do.
- A **To-dos** entry in the main menu gathers every project's list on one page: each project expands or
  collapses into the same editor as its tab, with its progress at a glance. Lists are read only as they
  come into view, so the page scales to any number of projects.
- A project dropdown with checkboxes filters the workspace To-dos page and its totals to the selected
  projects. The selection is remembered per user on the current device.
- Status filters show their counts in compact pills (`1.2K`) that never overflow, on phones and desktops.
- Adding, editing, changing the status of, reordering and removing items commits the file transparently
  with the user's GitHub grant; a missing file is created by the first item. Each save names the file
  revision it read, so concurrent changes are replayed, never overwritten.
- Mooi edits only what it renders losslessly: an optional `# Title` and `- [ ]` (open), `- [/]` (in
  progress) and `- [x]` (done) items. Any other content is reported, never changed, until the user chooses
  to clean it up or keep managing it by hand.
- Managed from UI or chat (session agents use the same platform API); changes stream live to every view.

## Development environment variables

- Project-wide, shared by all sessions of the project, propagated live (a variable set from one session is
  instantly available to all others).
- Managed from UI or chat. Sensitive: stored by the platform, never committed.

## Dev deployments (web applications)

- Deploy a session's code to an isolated Docker environment on the host engine (no nested virtualization,
  no performance loss), on an isolated network.
- Many instances at once (one per feature/session): free ports and volumes are detected to avoid overlap.
- Preview embedded in Mooi with mobile and desktop views. Web applications only; other project types can
  still be iterated without previews.
- Exposed only through Mooi's secure reverse proxy; no other access path.
- **First deploy**: a dedicated setup prompt goes to the chat to prepare the project. Resulting setup must be
  compatible with Mooi dev sessions, local runs without Mooi and production deployments. Deploy runs
  directly only once that setup passed its test; a Compose file already in the repository is not enough.
- Deploy, stop, configure through buttons or chat; the chat knows the deployment prompt, so setup from chat
  equals setup from the Deploy button. Build/run logs and progress stream live.

## Production deployments

- A project starts unconfigured. First **Deploy** asks how to deploy, in free text: local, VPS, AWS, GCP,
  any platform, or several targets at once (e.g. a VPS and GCP together).
- This opens a chat with a platform prompt: the agent never deploys with its own tools; it writes a
  deterministic deployment script, tests it with a real deployment and iterates until it works. From then on
  the Deploy button runs that script directly, without an agent; the chat suggests clearing itself.
- **Isolation**: production never collides with any other deployment of the repository or the target (dev
  stack, local tooling, other stacks): own files under `deploy/production/` and production-specific runtime
  names (Compose project, volumes, networks, images, directories, cloud resources).
- **Releases**: create releases from the menu, including from the latest default branch; only releases are
  deployed. A chat test deploys a new release when it just committed repository changes, otherwise the
  deployed release or, before the first deployment, the latest release (created when none exists).
- **Platform files** (managed by Mooi, never committed, since they reveal the real infrastructure):
  `deploy.sh`, `status.sh` (live status of every target) and `DEPLOYMENT.md`, the natural-language manifest
  agents read to change the deployment later; all kept consistent with every change.
- **Repository files** (committed only when the target needs them): e.g. a production Compose file reading
  env variables, holding variable references, never values.
- **Production variables**: values stored only in the platform; set manually in their menu or by the chat;
  both views stay in sync.
- An open production chat can be reused to change or fix the deployment.

## Backups

- Same flow as production: describe the backup in free text, the agent writes and tests a script, the
  platform reuses it.
- Each backup carries a timestamp and the release it belongs to.
- Restore into production and into sandbox (disposable, isolated) environments.
- Buttons and chat converge; changes appear live in both.

## Accounts and administration

- Account area: profile, linked GitHub, provider accounts and other personal settings; secure storage.
- Roles. **Admin** gets a tabbed console with rich, live insights and controls:
  - **Users**: every registered user with their last connection, who is online right now (and on how many
    devices), their live sessions and what each agent is doing, projects, provider accounts and devices,
    all updated in real time. Admins close a user's sessions, sign them out everywhere, and ban (sign out,
    close sessions, block sign-in) or unban them. Live data costs nothing while no admin watches.
  - **Agents**: minimal per-provider session defaults (adapter, model, thinking effort) preselected for
    every user; saved on change.
  - Other platform settings as they come.

## Other capabilities

- **Recipes**: reusable implementation recipes from GitHub marketplaces, applied from the session chat.
- **Dictation**: local push-to-talk speech-to-text in every agent chat composer.

# Guidelines

## Source of truth

- Priority: **1.** the user's new request → **2.** *Context* → **3.** current implementation.
- When a request conflicts with *Context*, follow the request and update *Context* in the same change, so it
  always states the latest vision.
- When the implementation conflicts with *Context*, align new work with *Context*, never the other way round.

## Testing

- Do not write programmatic tests: no unit, integration or end-to-end test files, test suites, test runners
  or test dependencies (pytest, vitest, `node:test`...) when adding or changing features. The repository
  keeps none.
- By default, verify without running the application: keep type checks, linters and builds passing, review
  the change for regressions and report what was checked. Type checks, linters and builds are not
  programmatic tests.
- Do not deploy the preview, start the stack, call the running services or drive the app in a browser
  (Playwright or otherwise) unless the user explicitly asks you to test the application: by default the user
  deploys and tests manually. When asked, test with those tools and report what was checked.

## Deployment channels

Three channels, each owned by one Mooi feature. Edit a channel's files only when the request comes from its
owner (its Mooi platform prompt); otherwise treat them as read-only.

| Channel | Files | Owner (only editor) | Used by |
| --- | --- | --- | --- |
| Production | `deploy/production/`, `tools/deploy-production.sh` | Mooi **production deployment** feature | Production only |
| Dev session | `compose.yml` | Mooi dev **Deploy** feature (deployment setup) | Mooi dev sessions; reused by local |
| Local | `Makefile` | Wraps the dev session channel; no logic of its own | Local runs outside Mooi |

- Never edit production or dev session files from local work, plain sessions or tools outside Mooi.
- Local deployment always goes through `make`, which only drives `compose.yml`; never run production files
  locally and never add a separate local stack.
- Files shared by channels (e.g. service `Dockerfile`s) must keep every channel working.
- Secrets live in the platform or git-ignored files (`.env`, `.env.local`), never in the repository.
- Respect isolation: keep the assigned Compose project, let Docker name resources and pick host ports, and
  manage only resources the current session owns. No automatic restarts or deploys after code changes.
