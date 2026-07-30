# backend — Python conventions

Applies to `backend/**` (package `topix`). Repo-wide rules (commits) are in the root `AGENTS.md`; architecture is in `docs/architecture.md`.

## Conventions

- Python ≥ 3.13, managed with `uv`. FastAPI + Pydantic v2, asyncpg.
- Lint/format: ruff + black (line length 150). Run ruff before pushing.
- Add a concise docstring to new/modified functions, methods, and classes (intent + key inputs/outputs, 1–3 lines).
- Tests: `pytest`; unit tests under `backend/test/unit/` (no live DBs). `make test-backend` is unit-only — integration needs live Postgres/Qdrant/Redis.

## Orientation (detail in `docs/architecture.md`)

- **Cross-store split:** Postgres = metadata + durable logs; Qdrant = ALL graph content (one collection, `type` is a payload field); Redis = tickets / seq / quotas. **No transaction spans Postgres and Qdrant.**
- **Collab is the only edit path:** human WS ops and the in-process agent (`collab/agent_bridge.py`) both allocate a seq from the oplog, apply to `GraphStore`, and broadcast a `peer-op`. Seq authority is the oplog, not `room.seq`.
- Two agent execution models coexist: the server-side OpenAI-Agents agent (`agents/`) and the thin `/ai/*` proxies for the browser engine (`api/router/ai.py`).
- `chat_transcript` stores browser-agent transcripts as opaque JSON (never the `Message` model) — see `docs/adr/ADR-AGENT-001` before changing that path.
- Models resolve via `config/catalog.py` over `backend/topix/models.yml` (one YAML entry per model; first route whose provider key is present wins). Billing off → plan resolves to `plus`.
