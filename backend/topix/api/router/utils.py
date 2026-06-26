"""Router for utils."""
import logging

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from topix.api.utils.decorators import with_standard_response
from topix.api.utils.rate_limit.entitlements import resolve_entitlement_context
from topix.api.utils.rate_limit.policy import resolve_allowed_model_tiers
from topix.api.utils.security import get_current_user_uid
from topix.config.services import service_config
from topix.utils.images.search import fetch_images, search_iconify_icons
from topix.utils.images.web import search_linkup, search_serper

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/utils",
    tags=["utils"],
    responses={404: {"description": "Not found"}},
)


@router.get("/ping", include_in_schema=False, status_code=204)
async def ping() -> Response:
    """Cheap liveness probe used by the client's connection-state detector.

    No DB, no auth, no logging — by design, this endpoint must remain
    fast enough to poll aggressively without skewing real metrics.
    """
    return Response(status_code=204)


@router.get("/icons/search/", include_in_schema=False)
@router.get("/icons/search")
@with_standard_response
async def search_icons(query: str, limit: int = 100):
    """Search for icons."""
    results = await search_iconify_icons(query, limit)
    return {
        "icons": [res.model_dump(exclude_none=True) for res in results]
    }


@router.get("/images/search/", include_in_schema=False)
@router.get("/images/search")
@with_standard_response
async def search_images(
    query: str,
    limit: int = 5,
    engine: Literal["unsplash", "serper", "linkup"] = "unsplash",
):
    """Search for images."""
    match engine:
        case "unsplash":
            results = await fetch_images(query, limit)
        case "serper":
            res = await search_serper(query, num_results=limit)
            results = [{"url": url} for url in res]
        case "linkup":
            res = await search_linkup(query, num_results=limit)
            results = [{"url": url} for url in res]
        case _:
            raise HTTPException(status_code=400, detail="Invalid image search engine.")

    return {
        "images": results
    }


@router.get("/services/", include_in_schema=False)
@router.get("/services")
@with_standard_response
async def get_services(
    request: Request,
    user_id: Annotated[str, Depends(get_current_user_uid)],
) -> dict:
    """Get available services.

    `llm` is the catalog of reachable models (keyed by canonical id) with the
    display metadata the frontend needs to render the picker; the id is what the
    client sends back as the chosen model. The list is filtered to the model
    tiers the requester's billing plan is entitled to.
    """
    entitlement = await resolve_entitlement_context(request, user_id)
    allowed_tiers = resolve_allowed_model_tiers(entitlement.plan)
    return {
        "llm": [
            {
                "id": m.id,
                "label": m.label,
                "family": m.family,
                "tier": m.tier,
                "provider": m.provider,
            }
            for m in service_config.llm
            if m.tier in allowed_tiers
        ],
        "search": [search.name for search in service_config.search],
        "navigate": [navigate.name for navigate in service_config.navigate],
        "code": [code.name for code in service_config.code],
        "image_generation": [img_gen.name for img_gen in service_config.image_generation],
    }
