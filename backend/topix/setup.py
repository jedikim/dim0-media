"""Setup module."""

import logging
import os

from pathlib import Path

from dotenv import load_dotenv

from topix.config.config import Config
from topix.config.services import service_config
from topix.datatypes.stage import StageEnum
from topix.store.qdrant.base import QdrantStore
from topix.utils.common import running_in_docker

logger = logging.getLogger(__name__)


def docker_service_name(base: str, stage: StageEnum) -> str:
    """Return the Docker service hostname for a stage-aware dependency."""
    if stage == StageEnum.PROD:
        return base

    return f"{base}-{str(stage)}"


def load_env_file(stage: StageEnum, env_filename: str = '.env') -> None:
    """Load environment variables from a .env file."""
    envpath = Path(__file__).parent.parent.parent / env_filename
    logger.info(f"Loading env from: {envpath}")
    load_dotenv(dotenv_path=envpath, override=True, verbose=True)

    # override db config based on whether running in docker or not
    # and the stage
    if running_in_docker():
        logger.info("Detected running inside Docker.")
        if os.environ.get("POSTGRES_HOST") in ("", "localhost"):
            postgres_host = docker_service_name("postgres", stage)
            logger.info(
                "Detected POSTGRES_HOST is empty or localhost. "
                f"Overriding POSTGRES_HOST and POSTGRES_PORT for docker environment to `{postgres_host}` and `5432` respectively."
            )
            os.environ["POSTGRES_HOST"] = postgres_host
            os.environ["POSTGRES_PORT"] = "5432"
        if os.environ.get("QDRANT_HOST") in ("", "localhost"):
            qdrant_host = docker_service_name("qdrant", stage)
            logger.info(
                "Detected QDRANT_HOST is empty or localhost. "
                f"Overriding QDRANT_HOST and QDRANT_PORT for docker environment to `{qdrant_host}` and `6333` respectively."
            )
            os.environ["QDRANT_HOST"] = qdrant_host
            os.environ["QDRANT_PORT"] = "6333"
        if os.environ.get("REDIS_HOST") in ("", "localhost"):
            redis_host = docker_service_name("redis", stage)
            logger.info(
                "Detected REDIS_HOST is empty or localhost. "
                f"Overriding REDIS_HOST and REDIS_PORT for docker environment to `{redis_host}` and `6379` respectively."
            )
            os.environ["REDIS_HOST"] = redis_host
            os.environ["REDIS_PORT"] = "6379"


async def setup(stage: StageEnum, env_filename: str = '.env') -> Config:
    """Set up the application configuration and environment variables."""
    # load .env file
    load_env_file(stage, env_filename=env_filename)

    config = Config.load(stage=stage)
    logger.info(f"Loaded configuration for stage: {stage}")

    service_config.update()

    await QdrantStore.from_config().create_collection()
    return config
