<p align="center">
  <img src="docs/images/dim0-icon.png" alt="Dim0 icon" width="96" />
</p>

<h1 align="center">Dim0 - The Thinking Canvas</h1>

Dim0 (read "dee-moh") is an agent-native thinking canvas where notes, documents, code, widgets, and AI agents work together on one board.

<p align="center">
  ❤️ If you like Dim0, consider giving this repo a star to support the project.
</p>

![Dim0 app screenshot](docs/images/app-screenshot.png)

**Website:** https://dim0.net  
**App:** https://app.dim0.net

## What It Is

Dim0 is built around a simple idea: the canvas should be the primary interface for thinking with AI, not a chat sidebar.

Instead of splitting work across docs, whiteboards, chat tools, code editors, and dashboards, Dim0 brings them together on one continuous surface.

## What You Can Do

- Think spatially with shapes, notes, and connected graph nodes
- Turn notes into visual structure with AI
- Create folder nodes to organize your work hierarchically across the board
- Upload documents and keep their context attached to the board
- Run code inside nodes
- Generate live HTML/JS widgets on the canvas
- Create frame nodes to group and highlight important parts of the board
- Present directly from the canvas by walking through frames
- Work with a board-aware AI agent that can search, reason, and write directly back onto the board

## Why It's Different

Most tools add AI as a layer on top of an existing product.
AI feels like an add-on, not a native part of the workflow.

Other tools put everything into chat.
Over time, context gets buried across too many conversations.

Knowledge becomes fragmented.
Important work disappears into chat history.

Dim0 is different: it is built as an agent-native canvas from the start.
The board is not just where work happens. It is also where you present it.

The agent is not just a chatbot. It can:

- Read live board context
- Reason in multiple steps
- Use tools in parallel
- Search the web
- Execute code
- Create and edit nodes directly on the board

## Core Idea

**Your thoughts, your notes, your agents. One canvas.**

## Monorepo Structure

This repository contains the full Dim0 product stack:

- `backend/`: API, agent logic, prompts, model integrations, persistence
- `webui/`: React frontend for the canvas, chat, and board UX
- `build/`: Docker Compose and build-related assets

## 🚀 Getting Started

### Prerequisites

- Node.js (LTS recommended)
- `uv` for Python dependency management
- Docker + Docker Compose (optional, recommended for local services)

### Environment Setup

Before running Dim0, create a root `.env` from `.env.sample` and add your keys:

```bash
cp .env.sample .env
```

For now, please provide at least:

- `OPENAI_API_KEY`
- `MISTRAL_API_KEY`
- `OPENROUTER_API_KEY`
- `LINKUP_API_KEY`

This gives the product a reliable minimum setup today.
We will keep simplifying this more and more.

Important notes:

- Both backend and frontend read the root `.env`
- Only variables prefixed with `VITE_` are exposed to the frontend

### Run Published Images

Pull and start the published stack:

```bash
make pull
make run
```

Open `http://localhost:3000`.

Stop it:

```bash
make down-run
```

Stop it and remove volumes:

```bash
make kill-run
```

### Local Development

If you want to run the source code locally instead of the published images, use the steps below.

#### Start Local Databases

```bash
make up-db
```

#### Run the Backend

```bash
cd backend
uv sync
uv run python -m topix.api.app
```

The backend uses `API_PORT` from `.env` and defaults to `8081`.

#### Run the Frontend

```bash
cd webui
npm install
npm run dev
```

The frontend uses `APP_PORT` from `.env` and defaults to `5175`.

## 🔑 Environment Variables

The root `.env.sample` includes the main configuration surface:

```bash
DOPPLER_TOKEN=

API_PORT=8081
APP_PORT=5175

API_ORIGIN=http://localhost:${API_PORT}

VITE_API_URL=${API_ORIGIN}

OPENAI_API_KEY=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
MISTRAL_API_KEY=
OPENROUTER_API_KEY=

DAYTONA_API_KEY=
DAYTONA_API_URL=
DAYTONA_TARGET=

LINKUP_API_KEY=
TAVILY_API_KEY=
PERPLEXITY_API_KEY=
UNSPLASH_ACCESS_KEY=
SERPER_API_KEY=

POSTGRES_HOST=
POSTGRES_PORT=5432
QDRANT_HOST=
QDRANT_PORT=6333
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=

JWT_SECRET_KEY=

OPENAI_AGENTS_DISABLE_TRACING=
OPENAI_AGENTS_DONT_LOG_MODEL_DATA=
OPENAI_AGENTS_DONT_LOG_TOOL_DATA=
```

## 🐳 Docker and Deployment

Deployment and local services are managed through Docker Compose with Makefile shortcuts.

### Core Commands

| Command | What it does |
| --- | --- |
| `make up` | Build if needed and start all services |
| `make up-build` | Rebuild images, then start all services |
| `make build` | Build images only |
| `make rebuild` | Rebuild images without cache |
| `make down` | Stop and remove containers |
| `make kill` | Stop and remove containers, images, and volumes |

### Service and Debug Commands

| Command | What it does |
| --- | --- |
| `make ps` | Show service status |
| `make logs` | Tail logs for all services |
| `make logs-s SERVICE=backend-dev` | Tail logs for one service |
| `make up-s SERVICE=backend-dev` | Start one service |
| `make build-s SERVICE=webui-dev` | Build one service |
| `make restart-s SERVICE=backend-dev` | Rebuild and restart one service |
| `make exec SERVICE=backend-dev CMD="bash"` | Open a shell in a service |

### Database Shortcuts

| Command | What it does |
| --- | --- |
| `make up-db` | Start only database services |
| `make down-db` | Stop only database services |

### Useful Overrides

You can override the compose profile and env file at invocation time:

```bash
make up PROFILE=local ENVFILE=.env
```

You can also override ports and origins for quick tests:

```bash
make up PROFILE=dev API_PORT=9090 API_HOST_PORT=9090 API_ORIGIN=http://localhost:9090
```

## Docker Images

This repo can publish public Docker Hub images for self-hosting:

- `winlp4ever/dim0-backend`
- `winlp4ever/dim0-webui`

Example:

```bash
docker pull winlp4ever/dim0-backend:0.1.5
docker pull winlp4ever/dim0-webui:0.1.5
```

You can also run the published images locally:

```bash
make pull
make run
make down-run
make kill-run
```

## 🏷️ Versioning and Releases

Dim0 uses one shared semantic version for the whole product. The source of truth is the repo-root `VERSION` file, and release tooling syncs that version into:

- `backend/pyproject.toml`
- `webui/package.json`
- `webui/src-tauri/Cargo.toml`

Version bumps use Commitizen with Conventional Commits.

Useful commands:

```bash
make version-check
make version-sync
make version-bump
```

The repository also includes GitHub Actions workflows for version checks, releases, and Docker publishing.

## 🛠️ Troubleshooting

- If the frontend cannot reach the API, check `VITE_API_URL` in `.env`
- If ports are already in use, change `API_PORT` or `APP_PORT`
- If env changes are not applied, restart the backend and frontend after editing `.env`
- Use `make config` to inspect the fully resolved Compose configuration

## 📄 License

This repository is available under the MIT License.
