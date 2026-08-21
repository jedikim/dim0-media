"""FastAPI application setup."""

import asyncio
import logging

from argparse import ArgumentParser
from contextlib import asynccontextmanager

import httpx
import uvicorn

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from topix.api.router import (
    ai,
    billing,
    boards,
    chats,
    collab,
    documents,
    files,
    finance,
    image_generation,
    mini_app_state,
    sharing,
    subscriptions,
    tools,
    users,
    utils,
)
from topix.collab.agent_bridge import AgentBoardBridge
from topix.collab.room import RoomRegistry
from topix.config.catalog import OPENROUTER_BASE_URL
from topix.config.config import Config
from topix.datatypes.stage import StageEnum
from topix.image_generation.providers.openrouter import OpenRouterImageAdapter
from topix.image_generation.service import ImageGenerationService
from topix.image_generation.storage import ImageStorage
from topix.image_generation.tasks import ImageGenerationTaskManager
from topix.nlp.pipeline.parsing import ParsingPipeline
from topix.setup import setup
from topix.store.chat import ChatStore
from topix.store.collab_oplog import CollabOplogStore
from topix.store.email_verification import EmailVerificationStore
from topix.store.graph import GraphStore
from topix.store.image_generation import ImageGenerationStore
from topix.store.mini_app_state import MiniAppStateStore
from topix.store.password_reset import PasswordResetStore
from topix.store.postgres.pool import create_pool
from topix.store.postgres.schema import apply_schema
from topix.store.redis.store import RedisStore
from topix.store.subscription import SubscriptionStore
from topix.store.user import UserStore
from topix.store.user_billing import UserBillingStore
from topix.utils.common import gen_uid
from topix.utils.logging import logging_config

logging_config()
logger = logging.getLogger(__name__)


async def _reconcile_image_generations(service: ImageGenerationService) -> None:
    """Run best-effort lease reconciliation without blocking API startup."""
    try:
        await service.reconcile_incomplete()
    except Exception as exc:  # noqa: BLE001 - startup remains available on maintenance failure
        logger.warning("Image generation reconciliation failed (%s)", type(exc).__name__)


def create_app(stage: StageEnum):
    """Create and configure the FastAPI application."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        """Application lifespan context manager."""
        # One shared Postgres pool for every store. Per-store pools used to
        # multiply our connection footprint and exhaust Postgres under burst.
        app.pg_pool = await create_pool()

        # Apply idempotent schema so existing self-hosted DBs pick up additive
        # changes (new tables, new columns) without a manual migration step.
        await apply_schema(app.pg_pool)

        # Initialize stores
        app.graph_store = GraphStore()
        await app.graph_store.open(app.pg_pool)
        app.user_store = UserStore()
        await app.user_store.open(app.pg_pool)
        app.chat_store = ChatStore()
        await app.chat_store.open(app.pg_pool)
        app.user_billing_store = UserBillingStore()
        await app.user_billing_store.open(app.pg_pool)
        app.email_verification_store = EmailVerificationStore()
        await app.email_verification_store.open(app.pg_pool)
        app.password_reset_store = PasswordResetStore()
        await app.password_reset_store.open(app.pg_pool)
        app.mini_app_state_store = MiniAppStateStore()
        await app.mini_app_state_store.open(app.pg_pool)
        app.subscription_store = SubscriptionStore()
        await app.subscription_store.open()
        app.parser_pipeline = ParsingPipeline()

        # Image provider work uses one shared HTTP client and the shared
        # PostgreSQL pool. The key is resolved lazily inside the server adapter
        # so deployments without OpenRouter can still boot and use Dim0.
        app.image_generation_store = ImageGenerationStore()
        await app.image_generation_store.open(app.pg_pool)
        app.image_generation_http_client = httpx.AsyncClient(
            base_url=f"{OPENROUTER_BASE_URL.rstrip('/')}/",
            follow_redirects=False,
            timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=10.0),
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=4),
        )
        app.image_generation_tasks = ImageGenerationTaskManager()
        app.image_generation_service = ImageGenerationService(
            store=app.image_generation_store,
            adapter=OpenRouterImageAdapter(app.image_generation_http_client),
            storage=ImageStorage(),
            tasks=app.image_generation_tasks,
            worker_uid=gen_uid(),
        )

        # Initialize Redis
        app.redis_store = RedisStore.from_config()

        # Durable collab op-log (post-office substrate): persists every applied
        # batch and allocates a restart-safe per-board seq (Redis INCR seeded
        # from Postgres). Makes the client's serverSeq ordering survive restarts.
        app.collab_oplog = CollabOplogStore(app.redis_store)
        await app.collab_oplog.open(app.pg_pool)

        # Per-worker collab room registry (in-process; single-worker for v1).
        app.collab_rooms = RoomRegistry()
        # Agent → room bridge: agent tools call this so their edits
        # surface to live peers via `peer-op` (collab-archi §5.3 Phase 2).
        app.agent_board_bridge = AgentBoardBridge(
            graph_store=app.graph_store,
            registry=app.collab_rooms,
            oplog=app.collab_oplog,
        )

        # Do not await maintenance on the startup path. An advisory lock makes
        # concurrent worker starts a single-writer reconciliation operation.
        app.image_generation_reconciliation_task = asyncio.create_task(
            _reconcile_image_generations(app.image_generation_service),
            name="image-generation-reconciliation",
        )

        yield

        # Close stores. They no-op the pool close when sharing, then we close
        # the shared pool exactly once at the end.
        await app.image_generation_tasks.close()
        if not app.image_generation_reconciliation_task.done():
            app.image_generation_reconciliation_task.cancel()
        await asyncio.gather(app.image_generation_reconciliation_task, return_exceptions=True)
        await app.image_generation_http_client.aclose()
        await app.image_generation_store.close()
        await app.graph_store.close()
        await app.user_store.close()
        await app.chat_store.close()
        await app.user_billing_store.close()
        await app.email_verification_store.close()
        await app.password_reset_store.close()
        await app.mini_app_state_store.close()
        await app.subscription_store.close()
        await app.collab_oplog.close()
        # Close Redis
        await app.redis_store.close()
        await app.pg_pool.close()

    # Expose interactive docs and the OpenAPI schema only in local/dev. In
    # staging/prod they leak the full route + payload surface, which makes
    # targeted abuse easier, so disable them outright.
    docs_enabled = stage in (StageEnum.LOCAL, StageEnum.DEV)
    app = FastAPI(
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )

    origins = ["*"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(ai.router)
    app.include_router(boards.router)
    app.include_router(chats.router)
    app.include_router(collab.router)
    app.include_router(sharing.router)
    app.include_router(tools.router)
    app.include_router(users.router)
    app.include_router(subscriptions.router)
    app.include_router(billing.router)
    app.include_router(mini_app_state.router)
    app.include_router(utils.router)
    app.include_router(finance.router)
    app.include_router(files.router)
    app.include_router(documents.router)
    app.include_router(image_generation.router)

    return app


async def main(args) -> tuple[FastAPI, int]:
    """Run the application entry point."""
    await setup(stage=args.stage, env_filename=args.env_file)

    config: Config = Config.instance()

    app = create_app(stage=args.stage)

    return app, args.port or config.app.settings.port


if __name__ == "__main__":
    args = ArgumentParser(description="Run the Dim0 application.")
    args.add_argument(
        "--stage",
        default=StageEnum.LOCAL,
        help="The stage to run the application in.",
        choices=list(StageEnum)
    )
    args.add_argument(
        "--port",
        type=int,
        default=None,
        help="Port to run the application on."
    )
    args.add_argument(
        "--env-file",
        type=str,
        default=".env",
        help="Overridden name to the .env file to load. For example: .env.staging",
    )
    args = args.parse_args()

    app, port = asyncio.run(main(args))

    host = "0.0.0.0"
    logger.info(f"Starting Dim0 API on {host}:{port}...")

    uvicorn.run(app, host=host, port=port, log_level="info")
