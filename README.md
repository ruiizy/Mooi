<div align="center">

<img src="spa-mooi/public/icons/icon-512.png" alt="Mooi logo" width="112" />

# Mooi

**Ship from a chat.**

The AI-native development platform: from GitHub repository to live preview, production and backups,
driven by coding agents, on desktop and mobile.

![Claude Code](https://img.shields.io/badge/Claude_Code-supported-d97757?style=flat-square)
![Codex](https://img.shields.io/badge/Codex-supported-10a37f?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-isolated_previews-2496ed?style=flat-square&logo=docker&logoColor=white)
![Multi-tenant](https://img.shields.io/badge/multi--tenant-secure-111111?style=flat-square)
![Responsive](https://img.shields.io/badge/desktop_%26_mobile-ready-276ef1?style=flat-square)

[What is Mooi](#-what-is-mooi) · [Features](#-features) · [How it works](#-how-it-works) · [Deployments](#-deployments)

</div>

---

## ✨ What is Mooi

Mooi turns your GitHub repositories into a workspace of AI coding agents. Sign in with Google, link GitHub,
add a project and start building: run many agent sessions side by side, watch the code change live, preview
every feature in its own isolated environment and ship to production on any infrastructure, all without
leaving the chat.

Every action is available from the interface **and** from the chat. Both run the same mechanism and stay in
sync in real time.

## 🚀 Features

| | Feature | Description |
| :---: | --- | --- |
| 💬 | **Parallel agent sessions** | Independent chats per project with Claude Code or Codex, each on its own branch and repository copy. |
| 👀 | **Live changes** | Follow what the agent does and every file it touches, as it happens. |
| 📊 | **Usage insights** | Context size, session and weekly limits and more, per session and per account. |
| 🎛️ | **Models & accounts** | Pick model and thinking effort; connect several provider accounts, even of the same provider. |
| 🧩 | **Live previews** | One click deploys a session to an isolated container, embedded in mobile and desktop views, reachable only through Mooi. Run as many as you need. |
| 🔀 | **Agentic merge** | Conflicts with the main branch are resolved by the agent, keeping both sides. |
| ✅ | **Project to-dos** | A to-do tab backed by the repository's own `docs/TODOS.md`, committed as you check items off. |
| 🔐 | **Shared environments** | Project-wide variables, live across every session, never committed. |
| 🌍 | **Deploy anywhere** | Describe your target once (VPS, AWS, anything); the agent builds and tests a repeatable script reused for every release. |
| 💾 | **Backups & restore** | The same describe-once flow, versioned per release, restorable to production or a sandbox. |
| 🧑‍🍳 | **Recipes** | Reusable implementation recipes applied straight from the chat. |
| 🎙️ | **Dictation** | Private, local push-to-talk in every chat. |
| 🏢 | **Teams & admin** | Multi-tenant isolation, roles and an admin console with platform insights and default models. |

## 🧭 How it works

1. **Connect**: sign in with Google and link GitHub, Claude and Codex accounts.
2. **Add a project**: any public or private repository you can access.
3. **Build**: open sessions, chat with agents, watch changes and preview each feature live.
4. **Merge**: bring finished work into the main branch, conflicts handled by the agent.
5. **Ship**: create a release and deploy it to production; back it up and restore whenever needed.

## 📦 Deployments

Mooi itself ships three ways. Each has its own files; never mix them.

### 🏭 Production

For Mooi's production environment only, managed through Mooi's production deployment feature. The
production files live under `deploy/production/` and `tools/`. Never use them for development or local runs.

### 🧪 Dev session

For previews inside Mooi: the session's **Deploy** button runs the root `compose.yml` in an isolated
environment, fully separate from production.

### 💻 Local

For running Mooi on your machine without the platform, for example from Claude Code or a terminal. The
`Makefile` reuses the dev session setup; it needs Docker and `make`.

```bash
make up
```

| Command | Action |
| --- | --- |
| `make up` | Build, start and print the local address |
| `make url` | Print the local address |
| `make logs` | Follow logs |
| `make ps` | Show services |
| `make down` | Stop, keeping data |
| `make clean` | Remove everything, data included |

Sign in with **Continue as developer**. Local secrets are generated once in `.env.local`, which is never committed.

---

<div align="center">

Made with 🖤 by the Mooi team

</div>
