# Mooi

Monorepository. Each artifact lives in its own root-level directory.

| Artifact | Description |
| --- | --- |
| `spa-mooi` | Vite + React + TypeScript SPA (UI) |
| `mic-mooi` | Spring Boot microservice (API) |
| `mic-sessions` | FastAPI microservice (real-time agent sessions) |
| `mic-speech` | FastAPI microservice (local push-to-talk dictation, loopback only) |
| `compose.yml` | Development session stack (Deploy button preview) |
| `deploy/production/` | Production stack (`compose.prod.yml`, project `mooi-prod`) |

## Requirements

Docker Engine + Compose V2. Toolchains, SDKs and browser dependencies are installed by the service
Dockerfiles; no native development launcher is required.

## Setup

- **Development sessions:** use root `compose.yml` through the session's **Deploy** button. Store
  `MOOI_DEVELOPMENT_*` credentials in the Mooi platform; see *Previewing Mooi itself* below.
- **Production:** use `deploy/production/compose.prod.yml` and its `.env.example`; see *Production* below.
- Root `.env.example` contains optional database settings only. Do not store platform credentials in
  the repository or copy production accounts into development previews.

### Google OAuth2

1. Create an OAuth 2.0 Client ID (type *Web application*) in the Google Cloud console.
2. Authorized JavaScript origin: `https://<DOMAIN>`. No redirect URI is needed: Google
   Identity Services returns the ID token in the browser.
3. Set `GOOGLE_CLIENT_ID`, `JWT_SECRET` (>= 32 bytes) and `ADMIN_EMAILS` (comma separated) in the
   production environment file. Compose wires CORS and the frontend client id automatically.

The first sign-in of an address listed in `ADMIN_EMAILS` creates that player with the admin role;
adding an address later never promotes an existing player.

### GitHub OAuth2

Links a GitHub account to an existing player. It never signs anyone in — sign-in stays Google-only.

1. Create a **GitHub App** (Settings → Developer settings → GitHub Apps → New GitHub App).
2. Enable **Expire user authorization tokens**: it is the only setup that issues refresh tokens,
   which is what keeps the link alive without asking the player to authorize again.
3. Enable **Request user authorization (OAuth) during installation**, and grant **Repository
   permissions → Metadata: Read-only**, **Contents: Read and write**, and **Administration:
   Read and write**. Administration is required to create and delete GitHub repositories from
   Mooi. Existing installations must accept the updated permissions on GitHub. Select **All
   repositories** during installation so newly created repositories are available to sessions.
4. Callback URL: `https://<DOMAIN>/account/github/callback`; production Compose supplies
   the matching `GITHUB_REDIRECT_URI`.
5. Generate a client secret, then set in the production environment file: `GITHUB_CLIENT_ID`,
   `GITHUB_CLIENT_SECRET`.
6. Set `GITHUB_APP_SLUG` in the production environment file to the app's URL slug (the last segment of
   `https://github.com/apps/<slug>`). It backs the **Repository access** action, which is the
   install-and-authorize page — without it players are sent to their GitHub installations screen
   instead, one step longer.
7. Generate the key encrypting stored GitHub tokens at rest and set it as `SECRETS_KEY`:

```bash
openssl rand -base64 32
```

8. **Install the app on every account owning repositories to work on** — the personal account and
   each organization. Authorizing grants an identity; only an installation decides which
   repositories the grant may read, so private repositories of an account with no installation are
   invisible to Mooi by GitHub's design and no configuration can widen that.

The SPA needs no GitHub variable: it asks the API for ready-made authorize and install URLs.

### Agent providers

Claude and Codex sessions include the `playwright` MCP by default: headless Chromium,
an isolated browser context per MCP process and full file access. The runtime image installs
Playwright, its matching Chromium revision and system libraries at build time.
`AGENT_BROWSER_DIRECTORY` overrides the installation path.

Links a player's own Claude or Codex account so `mic-sessions` can run agent sessions on their behalf.
Credentials are stored by `mic-mooi` and handed to `mic-sessions` server-to-server; the browser
never sees a raw token.

1. Generate `SERVICE_TOKEN` (>= 32 bytes) in the production environment file. Compose passes
   the same value to both services to protect server-to-server credential exchange:

```bash
openssl rand -base64 32
```

2. Copy the same `JWT_SECRET` into both service environments: `mic-sessions` verifies
   access tokens locally with the same signing key, no network hop required for that check.
3. Claude supports two credential modes, both stored the same way and both mapped to the same
   downstream env var (`CLAUDE_CODE_OAUTH_TOKEN`):
   - **Setup token** (works out of the box): the player runs `claude setup-token` and pastes the
     printed `sk-ant-oat…` token on the account screen.
   - **OAuth2 (PKCE)**: fully env-driven (`AGENT_CLAUDE_CLIENT_ID`, `AGENT_CLAUDE_AUTHORIZE_URI`,
     `AGENT_CLAUDE_TOKEN_URI`, `AGENT_CLAUDE_SCOPES` in the production environment file) and ships **empty** on
     purpose: per the Claude Agent SDK docs, offering claude.ai login or its rate limits from a
     third-party product requires prior Anthropic approval. Fill these in only once that approval is
     in hand — until then, use the setup-token mode above.
4. **Anthropic API keys (`sk-ant-api…`) are not a supported credential** — this is "bring your Claude
   subscription", not "bring your API billing".
5. **Codex**: open **Account → Agents → Codex → Connect**, follow the ChatGPT sign-in link and enter
   the displayed device code. Enable device code sign-in in ChatGPT security settings if requested.
   No OpenAI API key, OAuth client registration or global Codex installation is required. Credentials
   and refresh tokens are encrypted with the same `SECRETS_KEY`. One account per provider is supported.
   Choose either provider when creating a session; models and reasoning levels come from its
   connected account's SDK catalog.

### Agent session runtime

Run `mic-sessions` with one process and one worker. Its Dockerfile installs Python 3.13,
the pinned official Claude and Codex SDKs, Git and the toolchains agents need. Both SDKs include
their CLI runtime; no global agent installation is required. Compose wires the same-origin API URLs.
Configure the service environment as needed:

| Variable | Purpose |
| --- | --- |
| `WORKSPACE_ROOT` | Writable storage; each session clones into `sessions/<UUID>/repository` |
| `GIT_BINARY`, `GIT_TIMEOUT_SECONDS` | Git executable and command timeout |
| `MAX_SESSIONS`, `MAX_SESSIONS_PER_PLAYER` | Concurrent session limits |
| `SESSION_IDLE_TIMEOUT_MINUTES` | Inactivity expiry; active turns/questions are retained |
| `AGENT_CLAUDE_MODEL`, `AGENT_CLAUDE_EFFORT` | Defaults for new sessions |
| `AGENT_CLAUDE_DISALLOWED_TOOLS` | Comma-separated tool exclusions |
| `AGENT_CLAUDE_MAX_MESSAGE_BYTES` | Largest single Claude CLI message (default 64 MiB) |
| `AGENT_RECOVERY_ATTEMPTS` | Reconnections (resuming the conversation) before a broken agent stream fails the session |
| `CHANGES_EXCLUDED_DIRECTORIES` | Directories hidden from Changes besides `.gitignore` (comma-separated; defaults to dependency/cache dirs such as `node_modules`) |
| `CHANGES_PREVIEW_MAX_BYTES` | Largest file previewed as a text diff, and diff size cap (default 4 MiB) |
| `EVENT_LOG_LIMIT`, `EVENT_LOG_BYTES` | Per-session retained event limits |

Adding a repository does not clone it. A new session checks out its requested remote branch,
or creates a branch from the remote default branch. Sessions may use the same branch name
independently. Closing, expiry and graceful shutdown stop the runtime before removing its clone.
Session conversations are held in memory and cannot survive a service restart. Startup removes
only marked session leftovers; legacy repositories and unowned directories are preserved.
Keep workspace storage on a persistent volume; the next start reconciles owned leftovers.

Messages accept up to 8 images (pick, paste or drop; PNG, JPEG, WebP, GIF; HEIC is converted in the
browser). The SPA scales them to 2048 px and ≤ 3.5 MB; they are stored in `sessions/<UUID>/images`
(outside the clone) and sent natively to Claude (base64 blocks) and Codex (local image input).

Codex uses a private account directory and does not inherit the host's Codex login, configuration or
API keys. Turns sharing one Codex connection are serialized to coordinate refresh-token rotation.
The current launcher supports macOS and Linux. Model availability still depends on the linked account.

Both agents run in full access: tools and commands never ask for approval and are not sandboxed;
only the agent's own questions reach the player. They run locally with the service user's
permissions, and their working directory does not restrict access to the host. Run the service
under an account whose access is appropriate for the repositories, hooks and tools you enable.

Commit native project configuration to the repository: `CLAUDE.md`, `.claude/rules/`,
`.claude/skills/`, `.claude/commands/`, `.claude/agents/`, project settings/hooks and `.mcp.json`.
Project and local settings are enabled. Install required hook/MCP executables and provide their
credentials on the host; native MCP approvals still apply. A root `.claude-plugin/plugin.json`
loads that repository as a local plugin. Marketplace plugins require installation and availability
in the CLI's runtime state; the service does not copy the user's global Claude configuration or
install plugin dependencies automatically.

### Session merges

**Merge** appears in a session header once its workspace has changes. It fetches the project's
default branch and dry-runs the merge in memory; the checkout is never touched.

- No conflicts: asks for a mandatory commit title, squashes the session's changes onto the default
  branch as one commit authored by the linked GitHub account (noreply address) and pushes it —
  never forced. The session branch then continues from that commit.
- Conflicts: the control becomes **Resolve conflicts**. It clears the conversation, restarts the
  agent and sends it a prompt to merge the default branch in, preserving both sides' features.
  Merge again once the agent has committed the result.

Branch protection rules on the default branch still apply to the push.

### Session deployments

Install Docker CLI with Compose v2 where `mic-sessions` runs and grant its service user access
to the configured host Unix socket. Production Compose mounts this socket and supplies `DOCKER_GID`.
Deploy builds and starts the root Docker Compose file of the session checkout. No container is ever
published: the one web port (the web frontend's, or the only one of an API-only product) is reached
only through the reverse proxy embedded in `mic-sessions`. Its build/up output
streams to the logs console next to the Deploy button, followed by the failure reason when it fails;
nothing is retried or handed to the agent automatically — ask the session chat to adjust the setup.
Deploy and Preview are only offered for projects marked as web applications (asked when adding or
creating the project, editable on the project page). Projects added before this setting count as web apps.

### Development environment

Project-wide `MOOI_DEVELOPMENT_*` variables, stored encrypted in Postgres (never in the repository) and shared by
every session of the project.

- **Manage**: ask the agent in any session (it reads and saves them through the platform), or use **Environment
  variables** (session actions menu) / the key icon on the project page (write-only in the browser).
- **Use**: the Deploy preview's root Compose file reads them by interpolation (`${MOOI_DEVELOPMENT_NAME}`); production
  deployments and backups inherit them. Server-wide fallbacks: `MOOI_DEVELOPMENT_*` in the sessions container environment
  (agents only see their names).

### Production deployments

**Deployments** → pick a project → its production view (tabs: Overview, Chat, Console, Platform files, Changes).

- **Configuration**: `DEPLOYMENT.md`, `deploy.sh`, `status.sh` plus `MOOI_PRODUCTION_*` values, stored encrypted in
  Postgres (never in the repository). Scripts read only `MOOI_PRODUCTION_*` and inherited `MOOI_DEVELOPMENT_*`
  variables; referenced ones without a shell default are required. Release data comes as `MOOI_PRODUCTION_RELEASE_TAG|SHA|URL`.
- **Setup / change / fix**: **Deploy** (first time), **Change deployment settings** or **Fix with agent** open a
  dialog for agent account, model and request. It starts the production chat (replacing any previous one) on a
  clone of the default branch; its first message is the full platform brief plus the request (sent again after
  clearing or compacting). The agent saves each file as it writes it (**Platform files** counts pending changes
  live), asks for missing values and stores them, then tests with a real deploy of the currently deployed release
  (or `v1.0.0`, created on the default branch when nothing was deployed yet). Once the test succeeds, the chat can
  be closed (✕ on its tab); it reopens only with a new setup, change or fix.
- **Repository changes**: only when needed (e.g. a Dockerfile), the agent edits the clone (**Changes** tab), asks
  before committing, and on approval the platform pushes one commit to the default branch; the next test then
  deploys a new release created from it.
- **Environment**: set values under **Environment** (write-only in the browser; the chat agent can read and save
  them). Server-wide fallbacks: `MOOI_PRODUCTION_*` in
  the sessions container environment. Install any SSH keys or CLIs the scripts need on the mic-sessions host.
- **Deploy**: choose an existing GitHub release or publish a new one from the default branch. `deploy.sh` runs from
  a detached checkout of that release; output streams to **Console**. The first successful deploy activates the
  draft. A failure is only reported; adjust it through the chat (**Adjust in chat** / **Fix with agent**).
- **Status**: `status.sh` runs periodically while the view is open (exit 0 = online).
- **History**: each attempt keeps its files and redacted output; redeploy or delete entries from there.
- **Delete configuration** removes files, variables and the chat; the running service and history stay.

### Backups

**Backups** → pick a project → its backup view (same tabs and flow as production deployments). Requires a
successful production deployment: every backup belongs to the release running in production.

- **Configuration**: `BACKUP.md`, `backup.sh`, `restore.sh`, `delete.sh` plus `MOOI_BACKUP_*` values, stored encrypted
  (never in the repository). Scripts also receive the project's `MOOI_PRODUCTION_*` and `MOOI_DEVELOPMENT_*` values; referenced variables
  without a shell default are required. Platform values: `MOOI_BACKUP_ID` (date-time-release-suffix storage name),
  `MOOI_BACKUP_CREATED_AT`, `MOOI_BACKUP_RELEASE_TAG`, `MOOI_BACKUP_TARGET` (`verification` | `production`) and the
  release's `MOOI_PRODUCTION_RELEASE_TAG|SHA|URL`.
- **Setup / change / fix**: same dialog and chat pattern as deployments (backup chat, platform brief, **Platform
  files**, **Changes**). The instance is always stopped while its data is copied or restored.
- **Proof**: the agent must run a real backup and then restore that same backup into a disposable instance isolated
  from production (`MOOI_BACKUP_TARGET=verification`), both with the current documents. Only that proof activates
  the draft; then the chat can be closed. The agent can never restore into production.
- **Operate**: **Create backup** (release currently deployed), **Verify** (restore into a disposable instance),
  **Restore** into production (explicit confirmation; only when production runs the backup's release) and **Delete**
  (runs `delete.sh`; **Remove record only** forgets it). Operations run one at a time per project, never alongside a
  deployment; `backup.sh`/`restore.sh` run from a checkout of the backup's release. Output streams to **Console**;
  each backup keeps every operation with its script and redacted output.
- **Limits**: `BACKUP_TIMEOUT_SECONDS` (default 3600) per script; `MAX_DEPLOYMENTS` also caps concurrent backup
  operations. Server-wide fallbacks: `MOOI_BACKUP_*` in the sessions container environment.

### Recipes

Reusable implementation recipes applied from a session chat. No configuration; needs the GitHub link.

- **Marketplace**: a GitHub repository readable by the linked account (public or private) with a `recipes/` folder of
  `snake_case.md` files, each starting with a YAML front matter holding `name` and `description`. Example:
  `https://github.com/Mydherin/agent-recipes`.
- **Link**: **Account → Recipes → Add marketplace** (several allowed); browse or remove from the same list.
- **Apply**: in a session, the composer's recipe button (shown only with a linked marketplace) → pick marketplace and
  recipe → optional instructions → **Apply recipe** sends the recipe as the next prompt. Re-applying reviews and completes it.
- **Reads**: recipes are read live from GitHub with the player's grant; files are cached by git blob hash. Limits: 200
  recipes per marketplace, 64 KB per file.

Set these values in the sessions container environment:

| Variable | Purpose |
| --- | --- |
| `DOCKER_BINARY`, `DOCKER_HOST` | CLI executable and explicit host socket URI, e.g. `unix:///var/run/docker.sock` |
| `DOCKER_CLI_PLUGIN_DIR` | Optional absolute Compose/buildx plugin directory; Docker Desktop macOS: `/Applications/Docker.app/Contents/Resources/cli-plugins` |
| `PREVIEW_UPSTREAM` | `loopback` (mic-sessions on the engine host) or `network` (mic-sessions in a container) |
| `PREVIEW_NETWORK` | Existing Docker network shared with mic-sessions in `network` mode (default `mooi-previews`) |
| `MAX_DEPLOYMENTS` | Concurrent deployment limit (default 4, no queue) |
| `DEPLOYMENT_*_TIMEOUT_SECONDS`, `DOCKER_*_TIMEOUT_SECONDS` | Operation limits; see `.env.example` |
| `DEPLOYMENT_LOG_LINES` | Compose output lines streamed to the logs console per deploy (default 2000) |
| `SESSION_ACTIVITY_INTERVAL_SECONDS` | Preview activity coalescing interval; default 60 seconds |

**Preview proxy**: each running deployment is served by `mic-sessions` under the path `/preview/<random-id>/`
of whatever host serves it (HTTP streaming, SSE, uploads and WebSockets relayed untouched): no DNS record,
certificate or extra port, so previews work wherever Mooi does, by name or bare IP. The id is a 160-bit
capability given only to the session owner, rotated per deploy and revoked on stop. The prefix is stripped
before forwarding (sent as `X-Forwarded-Prefix`; path-absolute redirects and cookie paths kept inside it);
frontends are built for it from `MOOI_PREVIEW_BASE_PATH`, given to Compose interpolation on every deploy.
The proxy allows framing by Mooi; the iframe delegates microphone, camera, clipboard, fullscreen and similar
permissions.

- **Local**: `http://localhost:<SESSIONS_PORT>/preview/<id>/`; containers bind only the web port to `127.0.0.1`
  (`PREVIEW_UPSTREAM=loopback`).
- **Container**: `PREVIEW_UPSTREAM=network`; deployments join `PREVIEW_NETWORK` with no published ports and
  Mooi's gateway forwards `/preview/` to `mic-sessions` with the path kept.

If Mooi runs in a container/pod, mount the host Docker socket and provide the CLI/Compose there.
Apps run as sibling containers on that engine. Build contexts are sent from the session checkout;
matching checkout paths on the daemon host are unnecessary. Apps must use built images and
named data volumes, without host bind mounts or access to Mooi's socket/credentials. This setup
does not sandbox hostile repositories. Mooi containerization: see *Production*.

Keep `WORKSPACE_ROOT` on durable, private, writable storage, including `deployments/` and its
installation identity. Run one `mic-sessions` process/worker; multiworker/multinode coordination
is unsupported. Stop preserves app data volumes; session closure/expiry and startup recovery
remove only owned resources. Failed cleanup preserves manifests/checkouts for retry; restore
Docker access and stop the owning `mic-sessions` container gracefully before cleaning its environment.
Do not delete deployment records manually while resources remain. Conversations do not survive
restart. The default inactivity expiry is 180 minutes; a visible, focused Preview sends activity
every 60 seconds. Hidden previews and automatic health checks do not prevent expiry.

Sessions run server-side, independent of any client: closing or suspending the browser never stops
them, and any device reconnects to the live stream (replayed from the last seen event; a silent
stream reconnects after `VITE_STREAM_STALE_SECONDS` or as soon as the app is visible again).
Agent commands of plain sessions run Compose as `COMPOSE_PROJECT_NAME=mooi-session-<installation>-<id>`,
so a repository's own stack never recreates a host stack sharing its project name; agents are told to leave
every other Docker resource alone and let the engine pick host ports. Deleting a session removes its
Deploy preview and its own Compose project (containers, volumes, networks and built images); at boot,
`mic-sessions` sweeps both kinds of leftovers of its own installation, never another one's.

### Previewing Mooi itself

The root `compose.yml` is the preview stack of this repository (Postgres, `mic-mooi`, `mic-sessions`,
`spa-mooi` under `MOOI_PREVIEW_BASE_PATH`), disjoint from production: own database, volumes, secrets,
same-origin API routes and `mooi-preview` browser storage. No dictation and no nested deployments.
Each session keeps its assigned `COMPOSE_PROJECT_NAME`; containers, networks and volumes use
Compose-generated names. Postgres is private to the stack. Only the gateway declares a port,
assigned by Docker for direct Compose use; managed Deploy publishes it only through the preview proxy.
Each preview path also gets its own browser storage prefix, keeping authentication and preferences
separate from production and other previews. Rebuilding a preview changes its path and storage prefix.

| Development variable | Use |
| --- | --- |
| `MOOI_DEVELOPMENT_PUBLIC_ORIGIN` | Mooi's public origin (CORS, OAuth callbacks) |
| `MOOI_DEVELOPMENT_JWT_SECRET`, `_SERVICE_TOKEN`, `_SECRETS_KEY` | Preview-only secrets, never production's |
| `MOOI_DEVELOPMENT_GOOGLE_CLIENT_ID` | Google client id |
| `MOOI_DEVELOPMENT_GOOGLE_AUTH_MOCK` | `true` (default): "Continue as developer" signs in `developer@mooi.dev` (admin) without Google |
| `MOOI_DEVELOPMENT_GITHUB_CLIENT_ID`, `_CLIENT_SECRET`, `_APP_SLUG` | Optional; placeholders otherwise (GitHub OAuth linking off) |
| `MOOI_DEVELOPMENT_GITHUB_TOKEN` | GitHub personal access token (classic, `repo` scope): linked at boot, no OAuth |
| `MOOI_DEVELOPMENT_CLAUDE_TOKEN` | `claude setup-token` token: linked at boot |
| `MOOI_DEVELOPMENT_CODEX_AUTH_JSON` | `~/.codex/auth.json` of a Codex login made for previews: linked once, rotations kept |

Linked accounts must be independent of production: GitHub App and Codex refresh tokens rotate, so a
copied production credential breaks production on the preview's first renewal.

### Dictation

Microphone button inside the agent chat composers (sessions, deployments, backups and their start dialogs);
words appear live in the composer itself. Fully local: NVIDIA Nemotron 3.5 ASR Streaming 0.6B (Q8 GGUF) on NeMo-Speech.cpp 0.1.0, run
by `mic-speech` on `127.0.0.1`; no audio or text is stored or logged.

- **Use**: tap / `Enter` on the microphone to toggle, hold it > 350 ms (release to finish), or hold `Ctrl+Shift+.`
  in the composer (release to finish). `Esc` while dictating discards and restores the text.
- **Provisioning**: the production image includes the pinned, SHA-256-checked runtime. Its entrypoint
  downloads the model (~742 MB, first run only) into the persistent speech data directory.
- **Never written** if the composer is edited meanwhile, disabled or gone. One dictation per machine.
- **Language** is forced (`SPEECH_LANGUAGE`, default `es-ES`): never detected nor translated.
- **Metrics**: `GET http://127.0.0.1:59100/metrics` (counts and latencies only, 30-day retention, SQLite `0600`).
- **Licenses**: model NVIDIA OpenMDW 1.1, runtime Apache-2.0; ship both notices when redistributing.

## Production

Containerized stack in `deploy/production/compose.prod.yml` (one image per artifact, `Dockerfile` in each artifact
directory), served behind the host's Traefik (external `proxy` network, `cloudflare` cert resolver,
`intranet-firewall` allow list).

| Host | Target |
| --- | --- |
| `https://<DOMAIN>` | `spa-mooi` nginx: SPA, `/api/mooi` → `mic-mooi`, `/api/sessions` → `mic-sessions`, `/api/stt` → `mic-speech`, `/preview` → `mic-sessions` preview proxy |

- Project, containers and networks are `mooi-prod*`, disjoint from the root `compose.yml` (development session previews).
- `mic-speech` stays loopback-only: it shares the `spa-mooi` network namespace, nginx is its only client.
- `mic-sessions` mounts the host Docker socket (`DOCKER_GID`), runs with `PREVIEW_UPSTREAM=network` on the
  external `mooi-previews` network and ships Git, Docker CLI + Compose/Buildx, Node, Bun, Python + uv,
  Java 25, ssh, rsync, curl, jq, make and ripgrep for the agents. Claude and Codex come bundled in their SDKs.
- Data under `DATA_DIR`: `postgres/`, `workspaces/`, `speech/` (runtime + model, downloaded on first start),
  `ssh/` (identity for production scripts, mounted at `/home/mooi/.ssh`).

### Setup (once)

1. DNS: `<DOMAIN>` → Traefik host.
2. Google OAuth client: add `https://<DOMAIN>` as authorized JavaScript origin.
3. GitHub App: add `https://<DOMAIN>/account/github/callback` as callback URL.
4. On the server: `<MOOI_DEPLOY_DIR>/.env` from `deploy/production/.env.example` (fresh secrets, `chmod 600`).

### Deploy

```bash
tools/deploy-production.sh [git-ref]
```

Ships exactly one commit (default `HEAD`; uncommitted changes never) via `git archive` to
`<MOOI_DEPLOY_DIR>/releases/<sha>` (skipped when already there), builds its images, stops any other
production project (data kept; e.g. the former `mooi`), runs `docker compose up -d --wait`
under a server lock, smoke-tests `/`, `/api/mooi/actuator/health` and `/api/sessions/health` through Traefik,
then points `current` at it and keeps the last `MOOI_KEEP_RELEASES` with their images. On failure it
rolls back to the previous release.

| Variable | Default |
| --- | --- |
| `MOOI_DEPLOY_HOST` | `mydherin@10.10.22.21` |
| `MOOI_DEPLOY_DIR` | `/root/mooi` |
| `MOOI_KEEP_RELEASES` | `3` |

Operate on the server from `<MOOI_DEPLOY_DIR>`:

```bash
docker compose --env-file .env -f current/deploy/production/compose.prod.yml ps
```

## Configuration

### Root Compose (optional `.env`)

| Variable | Description |
| --- | --- |
| `POSTGRES_DB` | Database name (default `mooi`) |
| `POSTGRES_USER` | Database user (default `mooi`) |
| `POSTGRES_PASSWORD` | Development database password (default `mooi-preview`) |

### spa-mooi (Docker build arguments)

All build arguments must be prefixed with `VITE_`.

| Variable | Description |
| --- | --- |
| `VITE_APP_NAME` | Application name |
| `VITE_APP_TAGLINE` | Headline tagline |
| `VITE_APP_DESCRIPTION` | Meta and hero description |
| `VITE_APP_VERSION` | Displayed version |
| `VITE_GITHUB_URL` | Repository link |
| `VITE_DOCS_URL` | Docs link |
| `VITE_CONTACT_EMAIL` | Contact email |
| `VITE_API_BASE_URL` | mic-mooi base URL |
| `VITE_SESSIONS_BASE_URL` | mic-sessions base URL |
| `VITE_SPEECH_BASE_URL` | mic-speech base URL (`ws:`/`wss:` derived) |
| `VITE_SESSIONS_REFRESH_SECONDS` | Live session status refresh interval |
| `VITE_STREAM_STALE_SECONDS` | Silence before a live stream reconnects (server pings every `SSE_HEARTBEAT_SECONDS`) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth2 client id |
| `VITE_AUTH_GOOGLE_MOCK` | Development only: `true` replaces Google sign-in with "Continue as developer" |
| `VITE_BASE_PATH` | Public path prefix (default `/`; previews: `MOOI_PREVIEW_BASE_PATH`) |
| `VITE_STORAGE_PREFIX` | Local storage key prefix |

### mic-mooi (container environment)

Compose supplies configuration through container environment variables. The production `.env` is
used for Compose interpolation, not mounted into service containers. Artifact `.env.example` files
list additional settings that can be added to the relevant Compose service environment.

| Variable | Description |
| --- | --- |
| `APP_NAME` | Application name |
| `APP_VERSION` | Displayed version |
| `SERVER_PORT` | HTTP server port |
| `DB_POOL_MAX_SIZE` | Connection pool max size |
| `DB_POOL_MIN_IDLE` | Connection pool min idle |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | Connection pool timeout (ms) |
| `DB_MIGRATIONS_ENABLED` | Toggle Liquibase migrations |
| `CORS_ORIGIN` | Allowed CORS origins |
| `GOOGLE_CLIENT_ID` | Google OAuth2 client id / expected token `aud` |
| `JWT_SECRET` | HS256 access-token signing key (>= 32 bytes) |
| `ACCESS_TOKEN_EXPIRES_IN` | Access token lifetime (e.g. `15m`) |
| `REFRESH_TOKEN_EXPIRES_IN` | Refresh token lifetime, re-issued on every rotation (e.g. `365d`) |
| `SESSION_MAX_LIFETIME` | Absolute session ceiling from its creation (e.g. `730d`) |
| `REFRESH_TOKEN_PURGE_CRON` | Cron deleting expired refresh tokens |
| `REPLAY_GRACE_SECONDS` | Grace window for concurrent refresh-token reuse |
| `ADMIN_EMAILS` | Comma-separated addresses granted admin at signup |
| `AUTH_GOOGLE_MOCK_ENABLED`, `AUTH_GOOGLE_MOCK_EMAIL` | Development only: skip Google, every sign-in is that address |
| `AUTH_GOOGLE_MOCK_GITHUB_TOKEN`, `_CLAUDE_TOKEN`, `_CODEX_AUTH_JSON` | Development only, with the mock: accounts linked to the mocked player at boot |
| `SECRETS_KEY` | AES-256-GCM key encrypting third-party tokens at rest (32 bytes, base64) |
| `GITHUB_CLIENT_ID` | GitHub App client id |
| `GITHUB_CLIENT_SECRET` | GitHub App client secret |
| `GITHUB_APP_SLUG` | GitHub App URL slug; backs the install-and-authorize page for repository access |
| `GITHUB_REDIRECT_URI` | Callback registered on the GitHub App |
| `GITHUB_AUTHORIZE_URI` | GitHub authorization endpoint |
| `GITHUB_TOKEN_URI` | GitHub token endpoint |
| `GITHUB_API_BASE_URL` | GitHub REST API base URL |
| `GITHUB_STATE_EXPIRES_IN` | Lifetime of the signed OAuth2 `state` (e.g. `10m`) |
| `GITHUB_TOKEN_REFRESH_SKEW` | Renew the GitHub token this long before it expires |
| `GITHUB_REQUEST_TIMEOUT_MS` | Per-call timeout against GitHub |
| `LOG_LEVEL_ROOT` | Root log level |
| `LOG_LEVEL_APP` | Application log level |
| `LOG_LEVEL_AUTH` | Auth log level |
| `LOG_LEVEL_GITHUB` | GitHub integration log level |

### mic-speech (container environment)

| Variable | Description |
| --- | --- |
| `SPEECH_HOST`, `SPEECH_PORT` | Bind address (loopback only) and port |
| `CORS_ORIGIN` | SPA origin; the only WebSocket `Origin` accepted |
| `SPEECH_LANGUAGE` | Forced ASR language (e.g. `es-ES`, `es-MX`) |
| `SPEECH_CONTEXTS` | Comma-separated phrases to bias (boost 3.0; no effect on GGUFs without embedded tokenizer) |
| `SPEECH_MAX_SECONDS` | Maximum recording length, 1-1800 (default 300) |
| `SPEECH_RUNTIME_PATH` | Explicit `nemo-speech` binary; empty uses the provisioned one, then `PATH` |
| `SPEECH_RUNTIME_DIR` | Provisioned runtime directory |
| `SPEECH_MODEL` | Indexed model (`nemotron-3.5`) or local GGUF path |
| `SPEECH_DEVICE` | Empty: `metal` on Apple Silicon, `auto` elsewhere |
| `SPEECH_STARTUP_TIMEOUT_SECONDS` | Engine readiness budget |
| `SPEECH_METRICS_PATH`, `SPEECH_METRICS_RETENTION_DAYS` | Content-free metrics database and retention |
| `LOG_LEVEL` | Log level |
