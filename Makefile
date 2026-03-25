# -------- Settings (tweak if needed) --------
PROFILE ?= dev                 # dev | local
ENVFILE ?= .env                # path to your env file (repo root by default)
DIM0_VERSION ?= $(shell cat VERSION)
COMPOSE_BASE := docker compose -p dim0-src -f build/docker-compose.yml
COMPOSE := ENVFILE=$(ENVFILE) $(COMPOSE_BASE) --env-file $(ENVFILE)
COMPOSE_IMAGES_BASE := docker compose -p dim0-images -f build/docker-compose.images.yml
COMPOSE_IMAGES := ENVFILE=$(ENVFILE) DIM0_VERSION=$(DIM0_VERSION) $(COMPOSE_IMAGES_BASE) --env-file $(ENVFILE)
DB_SERVICES := $(if $(filter prod,$(PROFILE)),postgres qdrant redis,postgres-$(PROFILE) qdrant-$(PROFILE) redis-$(PROFILE))

# Allow: make VAR=value ...
# Ex: make up PROFILE=local API_PORT=9090 API_HOST_PORT=9090 API_ORIGIN=http://localhost:9090

# -------- Meta --------
.PHONY: help
help: ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# -------- Core lifecycle --------
.PHONY: up
up: ## Build (if needed) + start all services for $(PROFILE)
	$(COMPOSE) --profile $(PROFILE) up -d

.PHONY: up-build
up-build: ## Force rebuild images, then start all services for $(PROFILE)
	$(COMPOSE) --profile $(PROFILE) up -d --build

.PHONY: build
build: ## Just (re)build images (no start)
	$(COMPOSE) --profile $(PROFILE) build

.PHONY: pull
pull: ## Pull published backend and webui images for DIM0_VERSION
	DIM0_VERSION=$(DIM0_VERSION) $(COMPOSE_IMAGES_BASE) pull backend webui

.PHONY: run
run: ## Run published images from Docker Hub using DIM0_VERSION
	$(COMPOSE_IMAGES) up -d

.PHONY: down-run
down-run: ## Stop published-image containers
	DIM0_VERSION=$(DIM0_VERSION) $(COMPOSE_IMAGES_BASE) down --remove-orphans

.PHONY: kill-run
kill-run: ## Stop published-image containers and remove volumes
	DIM0_VERSION=$(DIM0_VERSION) $(COMPOSE_IMAGES_BASE) down --volumes --remove-orphans

.PHONY: logs-run
logs-run: ## Tail logs for published-image services: make logs-run [SERVICE=backend]
	DIM0_VERSION=$(DIM0_VERSION) $(COMPOSE_IMAGES_BASE) logs -f --tail=200 $(SERVICE)

.PHONY: rebuild
rebuild: ## Rebuild without cache (no start)
	$(COMPOSE) --profile $(PROFILE) build --no-cache

.PHONY: down
down: ## Stop and remove containers (keep images & volumes)
	$(COMPOSE) --profile $(PROFILE) down --remove-orphans

.PHONY: kill
kill: ## Stop and remove containers, images, and volumes (⚠ wipes DB data)
	$(COMPOSE) --profile $(PROFILE) down --rmi all --volumes --remove-orphans

# -------- Visibility & debugging --------
.PHONY: ps
ps: ## Show containers status for $(PROFILE)
	$(COMPOSE) --profile $(PROFILE) ps

.PHONY: logs
logs: ## Tail logs for all $(PROFILE) services
	$(COMPOSE) --profile $(PROFILE) logs -f --tail=200

# Ex: make logs-s backend-dev
.PHONY: logs-s
logs-s: ## Tail logs for a single service: make logs-s SERVICE=backend-dev
	@test -n "$(SERVICE)" || (echo "Set SERVICE=..." && exit 1)
	$(COMPOSE) logs -f --tail=200 $(SERVICE)

# -------- Service-level controls --------
# Ex: make up-s SERVICE=backend-dev
.PHONY: up-s
up-s: ## Start one service (inherits $(PROFILE)); add --no-deps with NODEPS=1
	@test -n "$(SERVICE)" || (echo "Set SERVICE=..." && exit 1)
	$(COMPOSE) up -d $(if $(NODEPS),--no-deps,) $(SERVICE)

.PHONY: build-s
build-s: ## Build one service: make build-s SERVICE=webui-dev
	@test -n "$(SERVICE)" || (echo "Set SERVICE=..." && exit 1)
	$(COMPOSE) build $(SERVICE)

.PHONY: restart-s
restart-s: ## Restart one service: make restart-s SERVICE=backend-dev
	@test -n "$(SERVICE)" || (echo "Set SERVICE=..." && exit 1)
	$(COMPOSE) up -d --build $(SERVICE)

.PHONY: exec
exec: ## Exec into service shell: make exec SERVICE=backend-dev [CMD="bash"]
	@test -n "$(SERVICE)" || (echo "Set SERVICE=..." && exit 1)
	$(COMPOSE) exec $(SERVICE) $(if $(CMD),$(CMD),sh)

# -------- Handy shortcuts --------
.PHONY: up-backend
up-backend: ## Start only backend (no deps): make up-backend SERVICE=backend-dev
	@$(MAKE) up-s SERVICE=$(if $(SERVICE),$(SERVICE),backend-$(PROFILE)) NODEPS=1

.PHONY: up-webui
up-webui: ## Start only webui (no deps): make up-webui SERVICE=webui-dev
	@$(MAKE) up-s SERVICE=$(if $(SERVICE),$(SERVICE),webui-$(PROFILE)) NODEPS=1

.PHONY: up-db
up-db: ## Start only databases for $(PROFILE)
	$(COMPOSE) --profile $(PROFILE) up -d $(DB_SERVICES)

.PHONY: down-db
down-db: ## Stop DBs for $(PROFILE)
	$(COMPOSE) --profile $(PROFILE) stop $(DB_SERVICES)

# -------- Diagnostics --------
.PHONY: config
config: ## Show fully-resolved compose config (confirms env expansion)
	$(COMPOSE) config

.PHONY: prune
prune: ## Docker-wide cleanup (stopped containers, dangling images) - global
	docker system prune -f

.PHONY: version-sync
version-sync: ## Sync VERSION into backend, webui, and tauri manifests
	python3 scripts/sync_version.py

.PHONY: version-check
version-check: ## Check whether repo manifests match VERSION
	python3 scripts/sync_version.py --check

.PHONY: version-bump
version-bump: ## Bump repo version with commitizen, then sync manifests
	uv run --with commitizen cz bump
	python3 scripts/sync_version.py
