"""Authenticated image-generation API tests backed by disposable PostgreSQL."""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import asyncpg
import httpx
import pytest

from fastapi import FastAPI, HTTPException, Request, status
from PIL import Image

from topix.api.router.image_generation import router
from topix.api.utils.rate_limit.dependency import rate_limiter
from topix.api.utils.security import get_current_user_uid
from topix.image_generation.models import (
    GeneratedImagePayload,
    ImageAssetCreate,
    ImageAssetSource,
    ProviderImageRequest,
    ProviderImageResult,
)
from topix.image_generation.service import ImageGenerationService
from topix.image_generation.storage import ImageStorage
from topix.image_generation.tasks import ImageGenerationTaskManager
from topix.store.image_generation import ImageGenerationStore
from topix.utils.common import gen_uid


def _image_bytes() -> bytes:
    """Create one deterministic output image for API integration tests."""
    output = BytesIO()
    Image.new("RGB", (9, 7), color="cyan").save(output, format="PNG")
    return output.getvalue()


class _FakeAdapter:
    """Return a local image while counting provider-bound requests."""

    provider_id = "openrouter"

    def __init__(self) -> None:
        """Initialize the fake without credentials or network access."""
        self.requests: list[ProviderImageRequest] = []

    async def generate(self, request: ProviderImageRequest) -> ProviderImageResult:
        """Record and satisfy one request with verified PNG bytes."""
        self.requests.append(request)
        content = _image_bytes()
        return ProviderImageResult(
            image=GeneratedImagePayload(
                mime_type="image/png",
                content=content,
                width=9,
                height=7,
                content_sha256=sha256(content).hexdigest(),
            )
        )


class _FakeGraphStore:
    """Provide only the board ACL and node lookups used by the router."""

    def __init__(self, *, board_uid: str, roles: dict[str, str]) -> None:
        """Bind role fixtures to one existing private board."""
        self.board_uid = board_uid
        self.roles = roles
        self.nodes: dict[str, SimpleNamespace] = {}

    async def get_graph_role(self, graph_uid: str, user_uid: str) -> str | None:
        """Return a role only for the configured board."""
        return self.roles.get(user_uid) if graph_uid == self.board_uid else None

    async def get_graph_metadata(self, graph_uid: str):
        """Return private board metadata for read-access fallback checks."""
        if graph_uid != self.board_uid:
            return None
        return SimpleNamespace(deleted_at=None, visibility="private")

    async def get_nodes(self, node_ids: list[str]):
        """Return configured node fixtures in request order."""
        return [self.nodes[node_uid] for node_uid in node_ids if node_uid in self.nodes]


@dataclass
class _APIContext:
    """Live disposable API dependencies for one integration test."""

    client: httpx.AsyncClient
    store: ImageGenerationStore
    tasks: ImageGenerationTaskManager
    adapter: _FakeAdapter
    graph_store: _FakeGraphStore
    board_uid: str
    foreign_board_uid: str
    owner_uid: str
    member_uid: str
    viewer_uid: str
    stranger_uid: str


@asynccontextmanager
async def _api_context(pool: asyncpg.Pool, root):
    """Yield an ASGI client using real image persistence and local fakes."""
    users = tuple(gen_uid() for _ in range(4))
    owner_uid, member_uid, viewer_uid, stranger_uid = users
    board_uid = gen_uid()
    foreign_board_uid = gen_uid()
    async with pool.acquire() as conn:
        for user_uid in users:
            await conn.execute(
                "INSERT INTO users (uid, email, username) VALUES ($1, $2, $3)",
                user_uid,
                f"{user_uid}@example.test",
                user_uid,
            )
        await conn.execute("INSERT INTO graphs (uid) VALUES ($1), ($2)", board_uid, foreign_board_uid)

    store = ImageGenerationStore()
    await store.open(pool)
    tasks = ImageGenerationTaskManager()
    adapter = _FakeAdapter()
    service = ImageGenerationService(
        store=store,
        adapter=adapter,
        storage=ImageStorage(root),
        tasks=tasks,
    )
    graph_store = _FakeGraphStore(
        board_uid=board_uid,
        roles={owner_uid: "owner", member_uid: "member", viewer_uid: "viewer"},
    )
    app = FastAPI()
    app.include_router(router)
    app.image_generation_service = service
    app.graph_store = graph_store

    async def _test_user(request: Request) -> str:
        """Authenticate from a test-only header without creating a real JWT."""
        user_uid = request.headers.get("X-Test-User")
        if user_uid is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
        return user_uid

    async def _no_rate_limit() -> None:
        """Keep rate limiting outside deterministic API contract tests."""

    app.dependency_overrides[get_current_user_uid] = _test_user
    app.dependency_overrides[rate_limiter] = _no_rate_limit
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield _APIContext(
            client=client,
            store=store,
            tasks=tasks,
            adapter=adapter,
            graph_store=graph_store,
            board_uid=board_uid,
            foreign_board_uid=foreign_board_uid,
            owner_uid=owner_uid,
            member_uid=member_uid,
            viewer_uid=viewer_uid,
            stranger_uid=stranger_uid,
        )
    await tasks.close()


def _request_body(*, request_uid: str | None = None, prompt: str = "Create a classroom scene") -> dict[str, object]:
    """Return a minimal valid generation request body."""
    return {
        "client_request_uid": request_uid or str(uuid4()),
        "model_id": "x-ai/grok-imagine-image-2.0",
        "prompt": prompt,
        "parameters": {"resolution": "1K", "quality": "low"},
        "reference_asset_uids": [],
        "generator_node_uid": None,
    }


@pytest.mark.asyncio
async def test_generation_post_requires_auth_and_owner_or_member_role(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
) -> None:
    """Anonymous/viewer/stranger callers are denied while editors receive 202."""
    async with _api_context(initialized_image_pg_pool, tmp_path) as context:
        path = f"/boards/{context.board_uid}/image-generations"
        assert (await context.client.post(path, json=_request_body())).status_code == 401
        for denied_uid in (context.viewer_uid, context.stranger_uid):
            response = await context.client.post(
                path,
                headers={"X-Test-User": denied_uid},
                json=_request_body(),
            )
            assert response.status_code == 404

        for allowed_uid in (context.owner_uid, context.member_uid):
            response = await context.client.post(
                path,
                headers={"X-Test-User": allowed_uid},
                json=_request_body(),
            )
            assert response.status_code == 202
            assert set(response.json()) == {"generation_uid", "status"}
            assert response.json()["status"] == "started"
        await context.tasks.wait()
        assert len(context.adapter.requests) == 2


@pytest.mark.asyncio
async def test_api_enforces_idempotency_assets_capabilities_and_node_board(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
) -> None:
    """The HTTP boundary rejects conflicts, foreign assets, extra fields, and foreign nodes."""
    async with _api_context(initialized_image_pg_pool, tmp_path) as context:
        path = f"/boards/{context.board_uid}/image-generations"
        headers = {"X-Test-User": context.owner_uid}
        request_uid = str(uuid4())
        body = _request_body(request_uid=request_uid)
        first = await context.client.post(path, headers=headers, json=body)
        repeated = await context.client.post(path, headers=headers, json=body)
        conflict = await context.client.post(
            path,
            headers=headers,
            json=_request_body(request_uid=request_uid, prompt="Different request content"),
        )
        assert first.status_code == repeated.status_code == 202
        assert first.json()["generation_uid"] == repeated.json()["generation_uid"]
        assert conflict.status_code == 409

        extra = body | {"api_key": "must-not-be-accepted"}
        assert (await context.client.post(path, headers=headers, json=extra)).status_code == 422
        too_many = _request_body() | {"reference_asset_uids": [gen_uid()] * 4}
        assert (await context.client.post(path, headers=headers, json=too_many)).status_code == 422
        missing = _request_body() | {"reference_asset_uids": [gen_uid()]}
        assert (await context.client.post(path, headers=headers, json=missing)).status_code == 404

        content = _image_bytes()
        foreign_asset = ImageAssetCreate(
            board_uid=context.foreign_board_uid,
            created_by_user_uid=context.owner_uid,
            source_kind=ImageAssetSource.UPLOADED,
            storage_key=f"images/uploads/{gen_uid()}.png",
            mime_type="image/png",
            byte_size=len(content),
            width=9,
            height=7,
            content_sha256=sha256(content).hexdigest(),
        )
        await context.store.add_asset(foreign_asset)
        cross_board = _request_body() | {"reference_asset_uids": [foreign_asset.uid]}
        assert (await context.client.post(path, headers=headers, json=cross_board)).status_code == 404

        node_uid = gen_uid()
        context.graph_store.nodes[node_uid] = SimpleNamespace(graph_uid=context.foreign_board_uid)
        foreign_node = _request_body() | {"generator_node_uid": node_uid}
        assert (await context.client.post(path, headers=headers, json=foreign_node)).status_code == 404
        await context.tasks.wait()
        assert len(context.adapter.requests) == 1


@pytest.mark.asyncio
async def test_polling_and_content_are_board_read_scoped_and_hide_storage(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
) -> None:
    """Authorized readers receive safe state/content while outsiders learn nothing."""
    async with _api_context(initialized_image_pg_pool, tmp_path) as context:
        headers = {"X-Test-User": context.owner_uid}
        create = await context.client.post(
            f"/boards/{context.board_uid}/image-generations",
            headers=headers,
            json=_request_body(),
        )
        generation_uid = create.json()["generation_uid"]
        await context.tasks.wait()
        status_path = f"/boards/{context.board_uid}/image-generations/{generation_uid}"

        outsider = await context.client.get(status_path, headers={"X-Test-User": context.stranger_uid})
        assert outsider.status_code == 404
        viewer = await context.client.get(status_path, headers={"X-Test-User": context.viewer_uid})
        assert viewer.status_code == 200
        payload = viewer.json()
        assert payload["status"] == "succeeded"
        assert "storage_key" not in payload
        assert "path" not in payload
        assert payload["output_content_url"].endswith(f"/{payload['output_asset_uid']}/content")

        content = await context.client.get(
            payload["output_content_url"],
            headers={"X-Test-User": context.viewer_uid},
        )
        assert content.status_code == 200
        assert content.headers["content-type"] == "image/png"
        assert content.headers["x-content-type-options"] == "nosniff"
        assert content.content == _image_bytes()
        assert str(tmp_path) not in content.text


@pytest.mark.asyncio
async def test_models_endpoint_exposes_allowlist_without_configuration_state(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
) -> None:
    """The public catalog contains capabilities but no secret/configuration fields."""
    async with _api_context(initialized_image_pg_pool, tmp_path) as context:
        response = await context.client.get("/image-models")
        assert response.status_code == 200
        payload = response.json()
        assert [model["model_id"] for model in payload["models"]] == [
            "x-ai/grok-imagine-image-2.0",
            "microsoft/mai-image-2.5-pro",
            "google/gemini-3-pro-image",
        ]
        serialized = response.text.lower()
        assert "api_key" not in serialized
        assert "configured" not in serialized
        assert "provider_tag" not in serialized
