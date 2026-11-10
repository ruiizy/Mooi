# Production image of mic-sessions: the agent runtime host.
#
# Agents (Claude Code and Codex, both bundled by their pinned official SDKs, plus a standalone pinned
# Claude Code CLI for the Claude CLI adapter) run in full access
# inside this container, so it carries the toolchains a session checkout usually needs: Git, Docker
# CLI with Compose and Buildx (deployments drive the host engine through its mounted socket), Node,
# Bun, Python with uv, Java 25 and the usual shell utilities (ssh, rsync, curl, jq, make, ripgrep).

# ── Python dependencies ──────────────────────────────────────
FROM python:3.13-slim-trixie AS build

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never

WORKDIR /app

COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable

# ── Runtime ──────────────────────────────────────────────────
FROM python:3.13-slim-trixie AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl wget git openssh-client rsync jq make ripgrep unzip zip xz-utils \
        procps less file gnupg libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI with the Compose and Buildx plugins (static binaries) at the system plugin path.
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:29-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

# Toolchains for the repositories agents work on.
COPY --from=node:24-trixie-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-trixie-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=oven/bun:1.3-debian /usr/local/bin/bun /usr/local/bin/bun
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /usr/local/bin/
COPY --from=eclipse-temurin:25-jdk /opt/java/openjdk /opt/java/openjdk

# RTK compresses the output of the shell commands Claude sessions run (see AGENT_CLAUDE_RTK). The
# Apache-2.0 `rtk-oss` edition carries every command filter; the binary is pinned and verified.
ARG RTK_VERSION=1.0.1
RUN case "$(dpkg --print-architecture)" in \
        amd64) target=x86_64-unknown-linux-musl sha=a44e8ffc43981100b4ddf1710399a1649a6c874591aa6d0c0727fe6cbd983c41 ;; \
        arm64) target=aarch64-unknown-linux-gnu sha=ee24a43dac9162de55fea8460b5efcd56d401ec28b5117c921bffa8a57bc136e ;; \
        *) echo "rtk: unsupported architecture" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/rtk.tar.gz "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-oss-${target}.tar.gz" \
    && echo "${sha}  /tmp/rtk.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/rtk.tar.gz -C /usr/local/bin rtk \
    && rm /tmp/rtk.tar.gz \
    && rtk --version

RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -s bun /usr/local/bin/bunx

# Standalone Claude Code CLI driven by the Claude CLI adapter (AGENT_CLAUDE_CLI); the SDK adapter keeps the
# copy its pinned SDK bundles. Pinned so both adapters can move independently; never auto-updated.
ARG CLAUDE_CODE_VERSION=2.1.310
RUN npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && claude --version \
    && rm -rf /root/.npm

# Install once at image build; agent turns never download packages or browsers.
COPY browser/package.json browser/package-lock.json /opt/mooi-browser/
RUN cd /opt/mooi-browser && npm ci --ignore-scripts --no-audit --no-fund \
    && PLAYWRIGHT_BROWSERS_PATH=/opt/mooi-browser/.browsers \
       node node_modules/playwright/cli.js install --with-deps --no-shell chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm
COPY browser/mcp.mjs /opt/mooi-browser/mcp.mjs

# Service user. The Docker socket group is added at run time (DOCKER_GID), never baked in.
RUN groupadd -g 1001 mooi && useradd -u 1001 -g mooi -m -d /home/mooi -s /bin/bash mooi

WORKDIR /app

COPY --from=build --chown=mooi:mooi /app/.venv /app/.venv

USER mooi

# The service venv stays off PATH so agents see the system toolchains, never Mooi's own packages.
ENV JAVA_HOME=/opt/java/openjdk \
    AGENT_BROWSER_DIRECTORY=/opt/mooi-browser \
    PATH="/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    SESSIONS_PORT=8000 \
    WORKSPACE_ROOT=/var/lib/mooi/workspaces \
    DOCKER_HOST=unix:///var/run/docker.sock

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=5 \
    CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

# One process and one worker: sessions, runtimes and deployments are coordinated in memory. Open SSE
# streams are cut after 5 s on shutdown so the lifespan cleanup starts right away.
CMD ["/app/.venv/bin/uvicorn", "mic_sessions.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-graceful-shutdown", "5", "--no-server-header", "--no-date-header"]
