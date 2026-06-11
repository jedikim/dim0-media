# syntax=docker/dockerfile:1.7
FROM --platform=linux/amd64 node:25

WORKDIR /app

ENV NODE_OPTIONS=--max_old_space_size=4096

# Install deps first for caching
COPY webui/package.json webui/package-lock.json* ./
RUN npm ci

# Copy source and build BOTH bundles:
#   * dist/           the host app, served on :80
#   * dist-mini-app/  the iframe runtime, served on :5001
# Cross-origin between :80 and :5001 (different ports → different
# origins) is the load-bearing security primitive — see
# mini-app-archi.md §5.
COPY webui/ ./
RUN npm run build
RUN npm run build:mini-app

# Runtime config template — same file feeds BOTH bundles via the
# entrypoint, which sed-substitutes per-env values and writes the
# resulting config.js into each dist dir.
COPY webui/config.template.js /app/config.template.js
COPY webui/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80 5001
CMD ["/bin/sh", "-c", "/docker-entrypoint.sh"]
