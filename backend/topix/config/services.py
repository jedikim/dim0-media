"""All services info.

LLM and embedding availability come from the model catalog (`models.yml` via
`config.catalog`), which resolves canonical models to concrete provider routes
based on which API keys are present. Search / navigate / code / image_generation
stay declared in `services.yml` and are gated by the same provider availability.
"""

import logging

from enum import StrEnum
from pathlib import Path
from typing import Literal

import yaml

from pydantic import BaseModel

from topix.config import catalog
from topix.config.catalog import Resolved

logger = logging.getLogger(__name__)

SERVICES_FILEPATH = Path(__file__).parent.parent / "services.yml"


class ServiceEnum(StrEnum):
    """Service types."""

    LLM = "llm"
    SEARCH = "search"
    NAVIGATE = "navigate"
    CODE = "code"
    IMAGE_GENERATION = "image_generation"


class BaseService(BaseModel):
    """Base Service info."""

    type: ServiceEnum
    name: str
    provider: str


class SearchService(BaseService):
    """Search Service info."""

    type: Literal[ServiceEnum.SEARCH] = ServiceEnum.SEARCH


class NavigateService(BaseService):
    """Navigate Service info."""

    type: Literal[ServiceEnum.NAVIGATE] = ServiceEnum.NAVIGATE


class CodeService(BaseService):
    """Code Service info."""

    type: Literal[ServiceEnum.CODE] = ServiceEnum.CODE


class ImageGenerationService(BaseService):
    """Image Generation Service info."""

    type: Literal[ServiceEnum.IMAGE_GENERATION] = ServiceEnum.IMAGE_GENERATION


class ServiceConfig(BaseModel):
    """Valid Services info."""

    providers: list[str]
    llm: list[Resolved]
    search: list[SearchService]
    navigate: list[NavigateService]
    code: list[CodeService]
    image_generation: list[ImageGenerationService]

    @classmethod
    def _sync(cls) -> dict:
        """Sync the services config with the currently configured API keys."""
        with open(SERVICES_FILEPATH) as f:
            cf = yaml.safe_load(f)

        # Provider availability + LLM models come from the model catalog.
        providers = catalog.available_providers()

        services = cf["services"]

        def gated(service_key: ServiceEnum, model_cls):
            return [
                model_cls.model_validate(service)
                for service in services.get(service_key, [])
                if service["provider"] in providers
            ]

        return {
            "providers": providers,
            "llm": catalog.available_llms(),
            "search": gated(ServiceEnum.SEARCH, SearchService),
            "navigate": gated(ServiceEnum.NAVIGATE, NavigateService),
            "code": gated(ServiceEnum.CODE, CodeService),
            "image_generation": gated(ServiceEnum.IMAGE_GENERATION, ImageGenerationService),
        }

    def update(self):
        """Update the service config."""
        synced_data = self._sync()

        logger.info("Updating service configuration from environment variables.")
        for key, value in synced_data.items():
            setattr(self, key, value)

    @classmethod
    def from_yaml(cls) -> "ServiceConfig":
        """Create an instance of ServiceConfig from current config."""
        return cls(**cls._sync())


"""
The global service config, to utilise:
from topix.config.services import service_config
"""
service_config = ServiceConfig.from_yaml()
