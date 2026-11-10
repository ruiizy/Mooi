# Production image of spa-mooi: the static bundle behind nginx, which is also the single gateway of
# Mooi's origin (API, sessions and dictation are reverse proxied by path; see nginx.conf).

# ── Build ────────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Vite resolves import.meta.env at build time: every VITE_* value is a build argument.
# VITE_BASE_PATH is the public path prefix (bundler base and router basename); production serves from /.
ARG VITE_BASE_PATH=/
ARG VITE_APP_NAME=Mooi
ARG VITE_APP_TAGLINE="ship from a chat"
ARG VITE_APP_DESCRIPTION="Mooi turns your GitHub repositories into agent sessions: chat, watch the code change, preview the running app and deploy to production without leaving the workspace."
ARG VITE_APP_VERSION=0.1.0
ARG VITE_GITHUB_URL=https://github.com
ARG VITE_DOCS_URL=https://vite.dev
ARG VITE_CONTACT_EMAIL=hello@mooi.dev
ARG VITE_API_BASE_URL
ARG VITE_SESSIONS_BASE_URL
ARG VITE_SPEECH_BASE_URL
ARG VITE_STREAM_STALE_SECONDS=45
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_AUTH_GOOGLE_MOCK=false
ARG VITE_STORAGE_PREFIX=mooi

ENV VITE_BASE_PATH=${VITE_BASE_PATH} \
    VITE_APP_NAME=${VITE_APP_NAME} \
    VITE_APP_TAGLINE=${VITE_APP_TAGLINE} \
    VITE_APP_DESCRIPTION=${VITE_APP_DESCRIPTION} \
    VITE_APP_VERSION=${VITE_APP_VERSION} \
    VITE_GITHUB_URL=${VITE_GITHUB_URL} \
    VITE_DOCS_URL=${VITE_DOCS_URL} \
    VITE_CONTACT_EMAIL=${VITE_CONTACT_EMAIL} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_SESSIONS_BASE_URL=${VITE_SESSIONS_BASE_URL} \
    VITE_SPEECH_BASE_URL=${VITE_SPEECH_BASE_URL} \
    VITE_STREAM_STALE_SECONDS=${VITE_STREAM_STALE_SECONDS} \
    VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID} \
    VITE_AUTH_GOOGLE_MOCK=${VITE_AUTH_GOOGLE_MOCK} \
    VITE_STORAGE_PREFIX=${VITE_STORAGE_PREFIX}

COPY . .
RUN bun run build

# ── Serve ────────────────────────────────────────────────────
FROM nginx:1.29-alpine AS runtime

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/mooi.conf
# Dictation upstream: loopback of the shared network namespace in production; the dev stack, which
# cannot share namespaces, passes the mic-speech service instead.
ARG SPEECH_UPSTREAM=127.0.0.1:59100
RUN grep -q 'http://127.0.0.1:59100;' /etc/nginx/conf.d/mooi.conf \
    && sed -i "s|http://127.0.0.1:59100;|http://${SPEECH_UPSTREAM};|" /etc/nginx/conf.d/mooi.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1/"]
