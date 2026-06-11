# syntax=docker/dockerfile:1.7
FROM python:3.13-slim

# system deps. nodejs + npm are needed by the mini-app compile bridge
# (topix.mini_app.compile spawns a node subprocess to run sucrase on
# agent-authored JSX before write_note accepts it). Without node the
# mini-app validate path fails closed with a clear error.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates build-essential nodejs npm \
  && rm -rf /var/lib/apt/lists/*

# install uv (fast Python package installer)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

COPY backend/ /app/
# schema.sql is applied idempotently on backend startup; bundle it alongside
# the package so apply_schema() can locate it via parents-walk to /app/build/.
COPY build/schema.sql /app/build/schema.sql

# install the backend from the committed lockfile for deterministic builds
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:${PATH}"

# Install the mini-app compiler's npm deps (sucrase). The script + its
# package-lock.json are already in /app/scripts/mini-app-compiler/ via
# the COPY above; this just fetches node_modules from the lockfile.
RUN cd /app/scripts/mini-app-compiler && npm ci --omit=dev

# expose typical ports (compose will map the actual one via env)
EXPOSE 8000 8080 8081 8888 80

CMD ["/app/.venv/bin/python", "-m", "topix.api.app"]
