# 🧩 Topix — Fullstack App (Backend + Frontend)

Python backend + React (Vite) frontend.
Both services share a single **root** `.env` for configuration.

---

## 📦 Prerequisites

- **Node.js** (LTS recommended)
- **uv** (Python dependency manager)
- **Docker + Docker Compose** (optional, recommended for DB/dev/prod)

---

## ⚙️ Environment Setup

Copy the sample file and edit values as needed:

```bash
cp .env.sample .env
````

`.env.sample` (defaults):

```bash
DOPPLER_TOKEN=

API_PORT=8081
APP_PORT=5175

API_ORIGIN=http://localhost:${API_PORT}
VITE_TOPIX_URL=${API_ORIGIN}

OPENAI_API_KEY= # make sure you set this value
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
MISTRAL_API_KEY=
OPENROUTER_API_KEY= # set this to activate non-OpenAI models, but you still need OPENAI_API_KEY for some functionalities
LINKUP_API_KEY= # set this for minimum web search functionality
TAVILY_API_KEY= # set this for web search and web navigation functionalities
PERPLEXITY_API_KEY=
UNSPLASH_ACCESS_KEY=

POSTGRES_HOST=
POSTGRES_PORT=5432 # please set the correct port you have set for Postgres
QDRANT_HOST=
QDRANT_PORT=6333 # please set the correct port you have set for Qdrant
REDIS_HOST=
REDIS_PORT=

JWT_SECRET_KEY= # required for JWT authentication; if not set, a random key will be generated at startup

OPENAI_AGENTS_DISABLE_TRACING=
OPENAI_AGENTS_DONT_LOG_MODEL_DATA=
OPENAI_AGENTS_DONT_LOG_TOOL_DATA=
```

> Only variables prefixed with `VITE_` are exposed to the **frontend**.
> Both backend and frontend read the **root** `.env` automatically.
> To have a minimal working app, please set at least `OPENAI_API_KEY` (to enable OpenAI LLMs and text embedding model), `LINKUP_API_KEY` or `TAVILY_API_KEY` for web search, and `JWT_SECRET_KEY` for jwt authentication.
> In production you can set the `OPENAI_AGENTS_DISABLE_TRACING`, `OPENAI_AGENTS_DONT_LOG_MODEL_DATA`, `OPENAI_AGENTS_DONT_LOG_TOOL_DATA`, this will reduce loggings and disable tracing.

---

## 🧠 Development

### 0) Start databases (first time / whenever you need DBs)

```bash
make up-db
```

### 1) Backend

```bash
cd backend
uv sync
uv run python -m topix.api.app
```

* Uses `API_PORT` from `.env` (default **8081**) — **no `--port` flag needed**.
* Temporary override:

  ```bash
  API_PORT=9000 uv run python -m topix.api.app
  ```

### 2) Frontend

```bash
cd webui
npm install
npm run dev
```

* Runs on `APP_PORT` from `.env` (default **5175**).
* Connects to backend via `VITE_TOPIX_URL`.

Open: [http://localhost:5175](http://localhost:5175)

---

## 🚀 Production (Frontend)

Build & preview locally:

```bash
cd webui
npm run build
npx serve dist/
```

Served on port **3000** by default.

---

## ☁️ Deployment & Containers

Deployment and local services are managed via **Docker Compose** with **Makefile** shortcuts.

### Profiles & Settings

* `PROFILE` controls the compose profile: `dev` (default) or `local`.
* `ENVFILE` controls which env file is passed to compose (default `.env`).

Override on the fly:

```bash
make up PROFILE=local ENVFILE=.env
```

### Core lifecycle

| Command         | What it does                                                          |
| --------------- | --------------------------------------------------------------------- |
| `make up`       | Build (if needed) + start **all** services for the selected `PROFILE` |
| `make up-build` | Force rebuild images, then start all services                         |
| `make build`    | (Re)build images only                                                 |
| `make rebuild`  | Rebuild images **without cache**                                      |
| `make down`     | Stop & remove containers (keeps images & volumes)                     |
| `make kill`     | Stop & remove containers, **images & volumes** (**wipes DB data**)    |

### Visibility & debugging

| Command                           | What it does                                        |
| --------------------------------- | --------------------------------------------------- |
| `make ps`                         | Show status of containers for the current `PROFILE` |
| `make logs`                       | Tail logs of all services                           |
| `make logs-s SERVICE=backend-dev` | Tail logs of a single service                       |

### Service-level controls

| Command                                    | Example                                |
| ------------------------------------------ | -------------------------------------- |
| `make up-s SERVICE=backend-dev`            | Start one service (inherits `PROFILE`) |
| `make build-s SERVICE=webui-dev`           | Build one service                      |
| `make restart-s SERVICE=backend-dev`       | Rebuild & restart one service          |
| `make exec SERVICE=backend-dev CMD="bash"` | Exec into a service shell              |

### Handy shortcuts

| Command        | What it does                              |
| -------------- | ----------------------------------------- |
| `make up-db`   | Start only DBs (`postgres-*`, `qdrant-*`) |
| `make down-db` | Stop only DBs                             |

### Diagnostics & cleanup

| Command       | What it does                                              |
| ------------- | --------------------------------------------------------- |
| `make config` | Print fully-resolved compose config (after env expansion) |
| `make prune`  | Docker-wide cleanup of stopped/unused resources           |

### Deploy the full stack

```bash
make up
```

Stop everything:

```bash
make down
```

> You can also override ports/URLs at invocation (useful for quick tests):
>
> ```bash
> make up PROFILE=dev API_PORT=9090 API_HOST_PORT=9090 API_ORIGIN=http://localhost:9090
> ```

---

## 🧩 Project Structure

```
project-root/
├─ .env                # shared env (copy from .env.sample)
├─ .env.sample
├─ Makefile            # docker-compose shortcuts
├─ build/
│  └─ docker-compose.yml
├─ backend/
│  └─ topix/api/app.py (module entrypoint)
└─ webui/
   ├─ vite.config.ts
   └─ src/
```

---

## 💡 Tips

* After editing `.env`, **restart** dev servers to apply changes.
* In frontend code, read variables via `import.meta.env.*` (e.g. `import.meta.env.VITE_TOPIX_URL`).
* For one-shot local overrides, set env inline (e.g. `APP_PORT=3001 npm run dev`).
* Need a single command to boot everything for dev? Use:

  ```bash
  make up-db && (cd backend && uv run python -m topix.api.app) & (cd webui && npm run dev)
  ```

  *(or add a dedicated `make dev` target if you prefer)*

---

## 🔖 Versioning

Topix uses one shared semantic version for the whole product.
The source of truth is the repo-root `VERSION` file, and release tooling syncs that version into:

- `backend/pyproject.toml`
- `webui/package.json`
- `webui/src-tauri/Cargo.toml`

Version bumps use Commitizen with Conventional Commits.

Check that manifests match `VERSION`:

```bash
make version-check
```

Sync manifests from `VERSION`:

```bash
make version-sync
```

Bump the next semantic version and sync manifests:

```bash
make version-bump
```

The `version-bump` target uses `uv` to run Commitizen, so no global `cz` install is required.

### GitHub Flow

The recommended rule set is:

- every pull request targeting `main` must pass version sync checks
- releases happen only from `main`
- releases are triggered manually with a chosen semantic bump: `patch`, `minor`, or `major`

This repo includes two GitHub Actions workflows:

- `.github/workflows/version-check.yml`
- `.github/workflows/release.yml`

The PR workflow runs `make version-check`.
The release workflow runs on manual dispatch from `main`, bumps the version with Commitizen, syncs all manifests, commits the release artifacts, and pushes the Git tag.

## 🐳 Docker Images

This repo can publish public Docker Hub images for self-hosting:

- `winlp4ever/dim0-backend`
- `winlp4ever/dim0-webui`

The Docker publish workflow is defined in:

- `.github/workflows/docker-publish.yml`

It can run in two modes:

- automatically when a GitHub Release is published
- manually from GitHub Actions with an optional version override

Required repository secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Example pulls:

```bash
docker pull winlp4ever/dim0-backend:0.1.5
docker pull winlp4ever/dim0-webui:0.1.5
```

You can also run the published images locally with the repo Makefile:

```bash
make pull
make run
```

By default these commands use the version from the repo-root `VERSION` file.
You can override it when needed:

```bash
make run DIM0_VERSION=0.1.5 ENVFILE=.env.local
```

## 🧰 Tech Stack

* **Backend:** Python, uv, python-dotenv, FastAPI (or your framework)
* **Frontend:** React, Vite
* **Infra:** Docker Compose, Makefile helpers
* **DBs:** Postgres, Qdrant (via Compose)

---

## 🆘 Troubleshooting

* **Frontend can’t reach API:** check `VITE_TOPIX_URL` in `.env` and browser console.
* **Ports already in use:** change `API_PORT` / `APP_PORT` in `.env` or stop conflicting processes.
* **Env not applied:** ensure you edited the **root** `.env` and restarted services; try `make config` to confirm env expansion.

---

## 📄 Ongoing updates on new features and integrations

We are actively adding new features to the project. Stay tuned here for the latest updates:
* 🔜 Coming soon - Integrate your documents to your projects, and query the agent on them.
* 🔜 Coming soon - Modify your graphs with an build-in AI agent
* 🔜 Work in progress - Improve Newsfeed, choose the tone and the recency of articles inside the agents.
* 🔜 Work in progress - Personnal finance tools in your dashboard.
* 🔜 TODO - Integrate olama, to self host the models.
