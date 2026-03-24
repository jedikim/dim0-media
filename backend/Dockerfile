# syntax=docker/dockerfile:1.7
FROM python:3.13-slim

# system deps (expand if you compile wheels)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates build-essential \
  && rm -rf /var/lib/apt/lists/*

# install uv (fast Python package installer)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

COPY backend/ /app/

# install the backend from the committed lockfile for deterministic builds
RUN uv sync --frozen --no-dev

# expose typical ports (compose will map the actual one via env)
EXPOSE 8000 8080 8081 8888 80

CMD ["/app/.venv/bin/python", "-m", "topix.api.app"]
