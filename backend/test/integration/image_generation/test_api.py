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
from topix.datatypes.note.link import Link
from topix.datatypes.note.note import Note, NoteProperties
from topix.datatypes.property import TextProperty
from topix.image_generation.models import (
    GeneratedImagePayload,
    ImageAssetCreate,
    ImageAssetSource,
    ProviderImageRequest,
    ProviderImageResult,
)
from topix.image_generation.result_nodes import ImageResultNodeError, ImageResultNodeService
from topix.image_generation.service import ImageGenerationService
from topix.image_generation.storage import ImageStorage
from topix.image_generation.tasks import ImageGenerationTaskManager
from topix.store.image_generation import ImageGenerationStore
from topix.utils.common import gen_uid


def _image_bytes(image_format: str = "PNG", *, size: tuple[int, int] = (9, 7)) -> bytes:
    """Create one deterministic raster for API integration tests."""
    output = BytesIO()
    Image.new("RGB", size, color="cyan").save(output, format=image_format)
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
        self.nodes: dict[str, Note | SimpleNamespace] = {}
        self.links: dict[str, Link] = {}

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

    async def get_links(self, link_ids: list[str]):
        """Return configured link fixtures in request order."""
        return [self.links[link_uid] for link_uid in link_ids if link_uid in self.links]


class _FakeBridge:
    """Persist result nodes through the graph fake without external services."""

    def __init__(self, graph_store: _FakeGraphStore) -> None:
        """Bind the observable graph store."""
        self.graph_store = graph_store
        self.note_calls = 0
        self.link_calls = 0
        self.batch_ids: set[str] = set()

    async def add_notes(self, *, board_id: str, notes: list[Note]) -> None:
        """Store canonical notes as the production bridge would."""
        self.note_calls += 1
        assert all(note.graph_uid == board_id for note in notes)
        self.graph_store.nodes.update({note.id: note for note in notes})

    async def add_links(self, *, board_id: str, links: list[Link]) -> None:
        """Store canonical links as the production bridge would."""
        self.link_calls += 1
        assert all(link.graph_uid == board_id for link in links)
        self.graph_store.links.update({link.id: link for link in links})

    async def persist_result_objects(
        self,
        *,
        board_id: str,
        note: Note | None,
        link: Link | None,
    ) -> None:
        """Persist only missing canonical objects for result reconciliation."""
        if note is not None:
            await self.add_notes(board_id=board_id, notes=[note])
        if link is not None:
            await self.add_links(board_id=board_id, links=[link])

    @asynccontextmanager
    async def result_delivery_order(self, *, board_id: str):
        """Yield no live room while preserving the production call shape."""
        assert board_id == self.graph_store.board_uid
        yield None

    async def ensure_result_batch(
        self,
        _conn,
        *,
        board_id: str,
        batch_id: str,
        note: Note,
        link: Link,
        generator: Note,
    ):
        """Record deterministic batch identity without external Redis."""
        assert board_id == self.graph_store.board_uid
        assert link.source == generator.id and link.target == note.id
        if batch_id in self.batch_ids:
            return None
        self.batch_ids.add(batch_id)
        return object()

    async def deliver_result_batch(self, *, room, delivery) -> None:
        """No-op because API contract tests do not create live peers."""


@dataclass
class _APIContext:
    """Live disposable API dependencies for one integration test."""

    client: httpx.AsyncClient
    store: ImageGenerationStore
    tasks: ImageGenerationTaskManager
    adapter: _FakeAdapter
    graph_store: _FakeGraphStore
    bridge: _FakeBridge
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
        worker_uid="test-api-worker",
    )
    graph_store = _FakeGraphStore(
        board_uid=board_uid,
        roles={owner_uid: "owner", member_uid: "member", viewer_uid: "viewer"},
    )
    bridge = _FakeBridge(graph_store)
    app = FastAPI()
    app.include_router(router)
    app.image_generation_service = service
    app.image_generation_store = store
    app.graph_store = graph_store
    app.agent_board_bridge = bridge

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
            bridge=bridge,
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


async def _create_succeeded_generator_run(context: _APIContext) -> tuple[str, str]:
    """Create one local-provider run tied to a real generator Note fixture."""
    generator_uid = gen_uid()
    context.graph_store.nodes[generator_uid] = Note(
        id=generator_uid,
        graph_uid=context.board_uid,
        properties=NoteProperties(image_prompt=TextProperty(text="a cyan square")),
    )
    response = await context.client.post(
        f"/boards/{context.board_uid}/image-generations",
        headers={"X-Test-User": context.owner_uid},
        json=_request_body() | {"generator_node_uid": generator_uid},
    )
    assert response.status_code == 202
    await context.tasks.wait()
    return response.json()["generation_uid"], generator_uid


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
async def test_asset_post_uses_graph_acl_and_registers_sniffed_rasters_without_provider_work(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
) -> None:
    """Only editors can register PNG/JPEG/WebP assets with safe metadata."""
    async with _api_context(initialized_image_pg_pool, tmp_path) as context:
        path = f"/boards/{context.board_uid}/image-assets"
        assert (await context.client.post(path, files={"file": ("x.png", _image_bytes(), "image/png")})).status_code == 401
        for denied_uid in (context.viewer_uid, context.stranger_uid):
            denied = await context.client.post(
                path,
                headers={"X-Test-User": denied_uid},
                files={"file": ("x.png", _image_bytes(), "image/png")},
            )
            assert denied.status_code == 404

        for image_format, mime_type, extension in (
            ("PNG", "image/png", "png"),
            ("JPEG", "image/jpeg", "jpg"),
            ("WEBP", "image/webp", "webp"),
        ):
            content = _image_bytes(image_format)
            response = await context.client.post(
                path,
                headers={"X-Test-User": context.member_uid},
                files={"file": (f"safe.{extension}", content, mime_type)},
            )
            assert response.status_code == 201
            payload = response.json()
            assert set(payload) == {
                "asset_uid",
                "mime_type",
                "width",
                "height",
                "byte_size",
                "content_sha256",
            }
            assert payload == {
                "asset_uid": payload["asset_uid"],
                "mime_type": mime_type,
                "width": 9,
                "height": 7,
                "byte_size": len(content),
                "content_sha256": sha256(content).hexdigest(),
            }
            asset = await context.store.get_asset(
                board_uid=context.board_uid,
                asset_uid=payload["asset_uid"],
            )
            assert asset is not None
            assert asset.source_kind is ImageAssetSource.UPLOADED
            assert asset.storage_key.endswith(f"/{payload['content_sha256']}.{extension}")
            assert str(tmp_path) not in response.text

        assert context.adapter.requests == []


@pytest.mark.asyncio
async def test_asset_post_rejects_non_multipart_spoofed_and_unsafe_images_with_typed_details(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Upload validation returns stable safe codes and never calls a provider."""
    async with _api_context(initialized_image_pg_pool, tmp_path) as context:
        path = f"/boards/{context.board_uid}/image-assets"
        headers = {"X-Test-User": context.owner_uid}

        non_multipart = await context.client.post(path, headers=headers, json={"url": "https://example.test/x.png"})
        assert non_multipart.status_code == 422

        for filename, content, mime_type in (
            ("x.gif", _image_bytes("GIF"), "image/gif"),
            ("spoof.jpg", _image_bytes("PNG"), "image/jpeg"),
        ):
            response = await context.client.post(
                path,
                headers=headers,
                files={"file": (filename, content, mime_type)},
            )
            assert response.status_code == 422
            assert response.json() == {
                "detail": {
                    "code": "unsupported_reference_format",
                    "message": "One or more reference images use an unsupported format.",
                }
            }

        monkeypatch.setattr("topix.api.router.image_generation.MAX_PROVIDER_REFERENCE_IMAGE_BYTES", 8)
        too_large = await context.client.post(
            path,
            headers=headers,
            files={"file": ("large.png", _image_bytes(), "image/png")},
        )
        assert too_large.status_code == 413
        assert too_large.json()["detail"]["code"] == "reference_too_large"

        monkeypatch.setattr(
            "topix.api.router.image_generation.MAX_PROVIDER_REFERENCE_IMAGE_BYTES",
            10 * 1024 * 1024,
        )
        monkeypatch.setattr("topix.image_generation.storage.MAX_GENERATED_IMAGE_PIXELS", 10)
        too_many_pixels = await context.client.post(
            path,
            headers=headers,
            files={"file": ("pixels.png", _image_bytes(), "image/png")},
        )
        assert too_many_pixels.status_code == 413
        assert too_many_pixels.json()["detail"]["code"] == "reference_pixel_limit_exceeded"
        assert context.adapter.requests == []


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
        too_many_response = await context.client.post(path, headers=headers, json=too_many)
        assert too_many_response.status_code == 422
        assert too_many_response.json()["detail"]["code"] == "reference_limit_exceeded"
        missing = _request_body() | {"reference_asset_uids": [gen_uid()]}
        missing_response = await context.client.post(path, headers=headers, json=missing)
        assert missing_response.status_code == 404
        assert missing_response.json()["detail"]["code"] == "image_reference_unavailable"

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
        cross_board_response = await context.client.post(path, headers=headers, json=cross_board)
        assert cross_board_response.status_code == 404
        assert cross_board_response.json()["detail"]["code"] == "image_reference_unavailable"

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
        assert content.headers["cache-control"] == "private, no-store"
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


@pytest.mark.asyncio
async def test_output_node_put_requires_editor_and_reconciles_without_provider_work(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
) -> None:
    """Only editors can idempotently materialize and explicitly restore a result."""
    async with _api_context(initialized_image_pg_pool, tmp_path) as context:
        generation_uid, generator_uid = await _create_succeeded_generator_run(context)
        provider_calls = len(context.adapter.requests)
        path = f"/boards/{context.board_uid}/image-generations/{generation_uid}/output-node"

        for denied_uid in (context.viewer_uid, context.stranger_uid):
            denied = await context.client.put(
                path,
                headers={"X-Test-User": denied_uid},
                json={"recreate": False},
            )
            assert denied.status_code == 404

        injected = await context.client.put(
            path,
            headers={"X-Test-User": context.owner_uid},
            json={"recreate": False, "output_asset_uid": gen_uid()},
        )
        assert injected.status_code == 422

        first = await context.client.put(
            path,
            headers={"X-Test-User": context.member_uid},
            json={"recreate": False},
        )
        repeated = await context.client.put(
            path,
            headers={"X-Test-User": context.owner_uid},
            json={"recreate": False},
        )
        assert first.status_code == repeated.status_code == 200
        assert first.json()["created"] is True
        assert repeated.json()["created"] is False
        assert first.json()["output_node_uid"] == repeated.json()["output_node_uid"]
        node_uid = first.json()["output_node_uid"]
        assert len(node_uid) == 32 and node_uid == node_uid.lower()
        assert int(node_uid, 16) >= 0
        assert context.bridge.note_calls == context.bridge.link_calls == 1
        assert len(context.graph_store.links) == 1

        status_response = await context.client.get(
            f"/boards/{context.board_uid}/image-generations/{generation_uid}",
            headers={"X-Test-User": context.viewer_uid},
        )
        assert status_response.json()["output_node_uid"] == node_uid

        context.graph_store.nodes.pop(node_uid)
        context.graph_store.links.clear()
        no_resurrection = await context.client.put(
            path,
            headers={"X-Test-User": context.owner_uid},
            json={"recreate": False},
        )
        assert no_resurrection.status_code == 200
        assert node_uid not in context.graph_store.nodes

        restored = await context.client.put(
            path,
            headers={"X-Test-User": context.owner_uid},
            json={"recreate": True},
        )
        assert restored.status_code == 200
        assert restored.json()["output_node_uid"] == node_uid
        assert restored.json()["recreated"] is True
        assert context.graph_store.nodes[node_uid].graph_uid == context.board_uid
        assert next(iter(context.graph_store.links.values())).source == generator_uid
        assert len(context.adapter.requests) == provider_calls
        serialized = first.text + repeated.text + restored.text
        assert "storage_key" not in serialized
        assert "authorization" not in serialized.lower()
        assert "api_key" not in serialized.lower()


@pytest.mark.asyncio
async def test_output_node_put_preserves_materialization_race_code(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Return a structured 409 so only the recoverable frontend path retries."""

    async def raise_materialization_race(
        _service: ImageResultNodeService,
        *,
        board_uid: str,
        generation_uid: str,
        recreate: bool,
    ) -> None:
        """Inject the stable recoverable error without touching a provider."""
        assert board_uid and generation_uid and recreate is False
        raise ImageResultNodeError(
            "materialization_raced",
            "Image result preparation overlapped with another operation. Please retry.",
        )

    monkeypatch.setattr(ImageResultNodeService, "ensure_output_node", raise_materialization_race)
    async with _api_context(initialized_image_pg_pool, tmp_path) as context:
        response = await context.client.put(
            f"/boards/{context.board_uid}/image-generations/{gen_uid()}/output-node",
            headers={"X-Test-User": context.member_uid},
            json={"recreate": False},
        )

        assert response.status_code == 409
        assert response.json() == {
            "detail": {
                "code": "materialization_raced",
                "message": "Image result preparation overlapped with another operation. Please retry.",
            }
        }
        assert context.adapter.requests == []
