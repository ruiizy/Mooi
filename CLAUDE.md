# Role

You are the best software engineer in the world

# Context

This is a monorepository which contains a whole application with different technical artifacts.

# General Guidelines

- Do not be so verbose when you are thinking and/or giving an anwser to the user. Just use essential meaningful words with really concise sentences without almost connectors

- Do not make browser testing after each implementation. You must test through web browser only when the user asks for it explicitly

- If in the user prompt appear `--no-verbose-thinking`, do not say any word while you are thinking about user request. You could give an anwser at the end but wiht minimum essentials words

- Do not create tests in the source code

- Just preserve a single README.md at project root with only information about how to run and set up the application. Information must be properly structured and be so concise with just essentials words covering all aspects

- Use root `compose.yml` for development session deployments and `deploy/production/compose.prod.yml` for production. Keep each session's assigned Compose project; use generated resource names and host ports. Only manage resources owned by that session. Do not restart or deploy automatically after code changes

# Tech Aspects

## spa-mooi

### SPA Stack

- It is preferable that you use bun as package manager but you could use another npm-like package manager if bun is not installed. If any npm-like package manager is not installed please communicate it to the user and stop the scaffolding initialization

- The programming language is TypeScript with React as framework

- The application uses Vite

- You must use tailwindcss to handle styles

- You must use zustand to handle global states through stores

- You must use lucide react icons to place any kind of icons

- You must use React Router DOM to handle pages navigation

### SPA Guidelines

- All configurations must be make through .env mapping each .env file into its respective directory

- Project structure should be modular, readable with high cohesion and low coupling

- Each file should conform Single Responsibility Principle, files must have single responsibility and must not be big

- To define types, use a whole file per type, do not use `index.d.ts` pattern to export instead of exporting direclty from module

- The design must be really modern and awesome. You must apply best ui/ux patterns with the most impressive and modern look and feel

- Application must be totally responsive with awesome view in desktop and mobile

- For compact groups of actions, use the project detail view's icon-button pattern: distinct Lucide icons, accessible labels and hover titles. If actions do not fit comfortably, group secondary ones in an icon-triggered context menu

- Dropdown panels must layer above surrounding cards and scroll containers, with a viewport-bound maximum height and internal scrolling. Portal custom panels to the nearest modal dialog (or document body) when an ancestor clips overflow; preserve keyboard focus and outside-click dismissal. Native selects use the browser's own overlay and scrolling.

## mic-mooi

### Microservice Stack

- It uses Java 25 as programming language

- It uses Spring Boot as a framework

- You must use JPA to handle ORM layer

- You must use Lombok to avoid boilerplate

- You must use Postgres as main db engine

- You must use liquidbase to handle db migrations

- You must config properly the application.yml

- You must support .env file with no external dependencies

### Microservice Guidelines

- Follow the `Project Architecture` rules below to define the architecture of the microservice codebase

#### Project Architecture

The architecture has the following structure:

- `features/` -> Features package in which all features are stored
- `features/<feature-name>.java` -> A single file where all aspects and feature logic is implemented
- `shared/` -> It is the package where any transversal aspect lives like `db`, `logging`...
- `shared/<transversal-aspect>.java` -> A single file that contains the whole implementation of any transversal aspect

Features in this architecture is totally self-contained in its single file.

From features you could only import transversal aspects.

Features will have duplicate code and logic since it is not possible import logic from another feature.

Each transversal aspect should be totally self-contained. Only relevant infrastructure topics should be considered as transversal aspect. You do not consider business logic as transversal aspect

## mic-sessions

### Microservice Stack

- It uses Python 3.13 as programming language

- It uses `uv` as package manager, with idiomatic Python packaging (`pyproject.toml`, `uv.lock`, `.python-version`, `src/mic_sessions/` layout)

- It uses FastAPI with uvicorn as web framework

- It exposes REST for commands and SSE (Server-Sent Events) for the live agent stream

- You must use `pydantic-settings` to config the application through .env file with no external dependencies

- Agent providers are integrated only through their official SDK, starting with `claude-agent-sdk`

### Microservice Guidelines

- Follow the same `Project Architecture` rules as `mic-mooi`, adapted to Python files

#### Project Architecture

The architecture has the following structure:

- `features/` -> Features package in which all features are stored
- `features/<feature-name>.py` -> A single file where all aspects and feature logic is implemented
- `shared/` -> It is the package where any transversal aspect lives like `env`, `logging`, `auth`...
- `shared/<transversal-aspect>.py` -> A single file that contains the whole implementation of any transversal aspect

Features in this architecture is totally self-contained in its single file.

From features you could only import transversal aspects.

Features will have duplicate code and logic since it is not possible import logic from another feature.

Each transversal aspect should be totally self-contained. Only relevant infrastructure topics should be considered as transversal aspect. You do not consider business logic as transversal aspect
