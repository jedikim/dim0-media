"""Global image-history API tests backed by disposable PostgreSQL."""

from __future__ import annotations

import base64
import json

from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from io import BytesIO
from pathlib import Path

import asyncpg
import httpx
import pytest

from fastapi import FastAPI, HTTPException, Request, status
from PIL import Image

from topix.api.router.image_history import router
from topix.api.utils.security import get_current_user_uid
from topix.image_generation.history import encode_image_history_cursor
from topix.image_generation.models import (
    GeneratedImagePayload,
    ImageAssetCreate,
    ImageAssetSource,
    ProviderUsage,
)
from topix.image_generation.storage import ImageStorage, validate_provider_raster_bytes
from topix.store.image_generation import ImageGenerationStore
from topix.store.image_history import ImageHistoryStore
from topix.utils.common import gen_uid


def _png_bytes(color: str) -> bytes:
    """Create one deterministic PNG fixture without external I/O."""
    output = BytesIO()
    Image.new("RGB", (8, 6), color=color).save(output, format="PNG")
    return output.getvalue()


class _ContentService:
    """Read verified asset bytes while exposing no provider operation."""

    def __init__(self, store: ImageGenerationStore, storage: ImageStorage) -> None:
        """Bind the real metadata store and confined test storage."""
        self.store = store
        self.storage = storage
        self.provider_calls = 0

    async def get_asset_content(self, *, board_uid: str, asset_uid: str):
        """Reuse the production storage verifier for one board-scoped asset."""
        asset = await self.store.get_asset(board_uid=board_uid, asset_uid=asset_uid)
        if asset is None:
            return None
        return asset, await self.storage.read_asset(asset)


@dataclass
class _HistoryContext:
    """Disposable authenticated history API and its authoritative fixtures."""

    client: httpx.AsyncClient
    service: _ContentService
    users: dict[str, str]
    boards: dict[str, str]
    generations: dict[str, str]
    assets: dict[str, str]
    png: bytes


async def _add_asset(
    *,
    store: ImageGenerationStore,
    storage: ImageStorage,
    board_uid: str,
    user_uid: str,
    content: bytes,
    source: ImageAssetSource,
    generation_uid: str | None = None,
) -> str:
    """Persist one verified test PNG and its immutable metadata."""
    asset_uid = gen_uid()
    raster = validate_provider_raster_bytes(content, claimed_mime_type="image/png")
    if source is ImageAssetSource.GENERATED:
        assert generation_uid is not None
        storage_key = await storage.write_generated(
            generation_uid,
            GeneratedImagePayload(
                mime_type="image/png",
                content=content,
                width=raster.width,
                height=raster.height,
                content_sha256=raster.content_sha256,
            ),
        )
    else:
        storage_key, _ = await storage.write_uploaded(
            board_uid=board_uid,
            asset_uid=asset_uid,
            content=content,
            raster=raster,
        )
    await store.add_asset(
        ImageAssetCreate(
            uid=asset_uid,
            board_uid=board_uid,
            created_by_user_uid=user_uid,
            source_kind=source,
            storage_key=storage_key,
            mime_type="image/png",
            byte_size=len(content),
            width=raster.width,
            height=raster.height,
            content_sha256=raster.content_sha256,
        )
    )
    return asset_uid


async def _insert_run(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    user_uid: str,
    board_uid: str,
    run_status: str,
    started_at: datetime,
    output_asset_uid: str | None = None,
    prompt: str = "full private prompt",
) -> None:
    """Insert one lifecycle-valid generation row for history projection tests."""
    terminal = run_status in {"succeeded", "failed"}
    failed = run_status == "failed"
    await conn.execute(
        "INSERT INTO image_generation_run ("
        "uid, user_uid, board_uid, client_request_uid, request_fingerprint, worker_uid, "
        "lease_expires_at, provider, model_id, prompt, parameters, status, output_asset_uid, "
        "error_code, error_message, started_at, completed_at"
        ") VALUES ($1, $2, $3, $4, $5, $6, $7, 'openrouter', "
        "'x-ai/grok-imagine-image-2.0', $8, $9::jsonb, $10, $11, $12, $13, $14, $15)",
        generation_uid,
        user_uid,
        board_uid,
        gen_uid(),
        "f" * 64,
        f"worker-{generation_uid}",
        None if terminal else started_at + timedelta(hours=1),
        prompt,
        json.dumps({"aspect_ratio": "1:1", "resolution": "1K", "quality": "low", "output_count": 1}),
        run_status,
        output_asset_uid,
        "terminal_failure" if failed else None,
        "Stored safe terminal failure" if failed else None,
        started_at,
        started_at + timedelta(seconds=3) if terminal else None,
    )


async def _insert_attempt(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    number: int,
    attempt_status: str,
    usage: ProviderUsage,
    cost: Decimal | None,
    started_at: datetime,
    error_code: str = "safe_provider_failure",
    error_message: str = "Stored safe provider failure",
) -> None:
    """Insert one attempt using the production ProviderUsage serialization."""
    completed = attempt_status != "started"
    await conn.execute(
        "INSERT INTO image_generation_attempt ("
        "uid, generation_uid, attempt_number, provider, model_id, status, "
        "provider_request_id, usage, cost_usd, latency_ms, error_code, error_message, started_at, completed_at"
        ") VALUES ($1, $2, $3, 'openrouter', 'x-ai/grok-imagine-image-2.0', $4, "
        "$5, $6::jsonb, $7, $8, $9, $10, $11, $12)",
        gen_uid(),
        generation_uid,
        number,
        attempt_status,
        f"provider-{generation_uid}-{number}" if completed else None,
        json.dumps(usage.model_dump(mode="json", exclude_none=True)),
        cost,
        120 if completed else None,
        error_code if attempt_status == "failed" else None,
        error_message if attempt_status == "failed" else None,
        started_at,
        started_at + timedelta(milliseconds=120) if completed else None,
    )


@asynccontextmanager
async def _history_context(pool: asyncpg.Pool, root: Path):
    """Yield a real PostgreSQL history API with globally private-board fixtures."""
    users = {name: gen_uid() for name in ("alice", "bob", "carol")}
    boards = {name: gen_uid() for name in ("private", "unnamed", "deleted")}
    generations = {name: gen_uid() for name in ("success", "retryable", "failed", "started", "unpriced")}
    png = _png_bytes("red")
    image_store = ImageGenerationStore()
    await image_store.open(pool)
    history_store = ImageHistoryStore()
    await history_store.open(pool)
    storage = ImageStorage(root)

    async with pool.acquire() as conn:
        await conn.executemany(
            "INSERT INTO users (uid, email, username, name) VALUES ($1, $2, $3, $4)",
            [
                (users["alice"], "alice-private@example.test", "alice", "Alice"),
                (users["bob"], "bob-private@example.test", "bob", None),
                (users["carol"], "carol-private@example.test", "carol", "Carol"),
            ],
        )
        await conn.execute(
            "INSERT INTO graphs (uid, label) VALUES ($1, 'Private Alpha'), ($2, NULL), ($3, 'Stale Secret')",
            boards["private"],
            boards["unnamed"],
            boards["deleted"],
        )
        await conn.execute("UPDATE graphs SET deleted_at = NOW() WHERE uid = $1", boards["deleted"])

    output_asset = await _add_asset(
        store=image_store,
        storage=storage,
        board_uid=boards["private"],
        user_uid=users["alice"],
        content=png,
        source=ImageAssetSource.GENERATED,
        generation_uid=generations["success"],
    )
    ref_asset = await _add_asset(
        store=image_store,
        storage=storage,
        board_uid=boards["private"],
        user_uid=users["alice"],
        content=_png_bytes("blue"),
        source=ImageAssetSource.UPLOADED,
    )
    unpriced_output = await _add_asset(
        store=image_store,
        storage=storage,
        board_uid=boards["unnamed"],
        user_uid=users["bob"],
        content=_png_bytes("green"),
        source=ImageAssetSource.GENERATED,
        generation_uid=generations["unpriced"],
    )
    unrelated_asset = await _add_asset(
        store=image_store,
        storage=storage,
        board_uid=boards["private"],
        user_uid=users["alice"],
        content=_png_bytes("yellow"),
        source=ImageAssetSource.UPLOADED,
    )
    assets = {
        "output": output_asset,
        "reference": ref_asset,
        "unpriced_output": unpriced_output,
        "unrelated": unrelated_asset,
    }

    same_time = datetime(2026, 8, 23, 3, 0, tzinfo=UTC)
    async with pool.acquire() as conn:
        await _insert_run(
            conn,
            generation_uid=generations["success"],
            user_uid=users["alice"],
            board_uid=boards["private"],
            run_status="succeeded",
            started_at=same_time,
            output_asset_uid=output_asset,
            prompt="A complete private prompt that must never be truncated by the server",
        )
        await _insert_attempt(
            conn,
            generation_uid=generations["success"],
            number=1,
            attempt_status="failed",
            usage=ProviderUsage(input_units=5),
            cost=Decimal("0.0100"),
            started_at=same_time,
        )
        await _insert_attempt(
            conn,
            generation_uid=generations["success"],
            number=2,
            attempt_status="succeeded",
            usage=ProviderUsage(output_units=7, total_units=12, generated_images=3),
            cost=Decimal("0.0200"),
            started_at=same_time + timedelta(seconds=1),
        )
        snapshot = json.dumps(
            {
                "asset_uid": ref_asset,
                "source_kind": "uploaded",
                "storage_key": "not-returned",
                "mime_type": "image/jpeg",
                "byte_size": len(_png_bytes("blue")),
                "width": 80,
                "height": 60,
                "content_sha256": sha256(_png_bytes("blue")).hexdigest(),
            }
        )
        await conn.executemany(
            "INSERT INTO image_generation_reference (generation_uid, board_uid, ordinal, asset_uid, asset_snapshot) "
            "VALUES ($1, $2, $3, $4, $5::jsonb)",
            [
                (generations["success"], boards["private"], 0, ref_asset, snapshot),
                (generations["success"], boards["private"], 1, ref_asset, snapshot),
            ],
        )
        await _insert_run(
            conn,
            generation_uid=generations["retryable"],
            user_uid=users["bob"],
            board_uid=boards["unnamed"],
            run_status="retryable",
            started_at=same_time,
        )
        await _insert_attempt(
            conn,
            generation_uid=generations["retryable"],
            number=1,
            attempt_status="failed",
            usage=ProviderUsage(),
            cost=None,
            started_at=same_time,
        )
        await _insert_run(
            conn,
            generation_uid=generations["failed"],
            user_uid=users["alice"],
            board_uid=boards["deleted"],
            run_status="failed",
            started_at=same_time,
        )
        await _insert_attempt(
            conn,
            generation_uid=generations["failed"],
            number=1,
            attempt_status="failed",
            usage=ProviderUsage(input_units=0),
            cost=Decimal("0"),
            started_at=same_time,
        )
        await _insert_run(
            conn,
            generation_uid=generations["started"],
            user_uid=users["bob"],
            board_uid=boards["unnamed"],
            run_status="started",
            started_at=same_time - timedelta(minutes=1),
        )
        await _insert_attempt(
            conn,
            generation_uid=generations["started"],
            number=1,
            attempt_status="started",
            usage=ProviderUsage(),
            cost=None,
            started_at=same_time - timedelta(minutes=1),
        )
        await _insert_run(
            conn,
            generation_uid=generations["unpriced"],
            user_uid=users["bob"],
            board_uid=boards["unnamed"],
            run_status="succeeded",
            started_at=same_time - timedelta(minutes=2),
            output_asset_uid=unpriced_output,
        )
        await _insert_attempt(
            conn,
            generation_uid=generations["unpriced"],
            number=1,
            attempt_status="succeeded",
            usage=ProviderUsage(),
            cost=None,
            started_at=same_time - timedelta(minutes=2),
        )

    service = _ContentService(image_store, storage)
    app = FastAPI()
    app.include_router(router)
    app.image_history_store = history_store
    app.image_generation_service = service

    async def _test_user(request: Request) -> str:
        """Authenticate from a test-only header without real token material."""
        user_uid = request.headers.get("X-Test-User")
        if user_uid is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
        return user_uid

    app.dependency_overrides[get_current_user_uid] = _test_user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield _HistoryContext(
            client=client,
            service=service,
            users=users,
            boards=boards,
            generations=generations,
            assets=assets,
            png=png,
        )


def _auth(context: _HistoryContext) -> dict[str, str]:
    """Authenticate as Carol, who has no membership on any fixture board."""
    return {"X-Test-User": context.users["carol"]}


@pytest.mark.asyncio
async def test_history_requires_auth_and_exposes_private_global_records_without_sensitive_fields(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path: Path,
) -> None:
    """Any login sees private prompts, labels, references, creator identity, and no secrets."""
    async with _history_context(initialized_image_pg_pool, tmp_path) as context:
        async with initialized_image_pg_pool.acquire() as conn:
            live_reference = await conn.fetchrow(
                "SELECT mime_type, width, height FROM image_asset WHERE uid = $1",
                context.assets["reference"],
            )
        assert live_reference is not None
        assert tuple(live_reference.values()) == ("image/png", 8, 6)
        assert (await context.client.get("/image-history")).status_code == 401
        assert (await context.client.get("/image-history/summary")).status_code == 401
        response = await context.client.get("/image-history?limit=25", headers=_auth(context))
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"
        payload = response.json()
        assert len(payload["items"]) == 5
        success = next(item for item in payload["items"] if item["generation_uid"] == context.generations["success"])
        assert success["user"] == {"uid": context.users["alice"], "username": "alice", "name": "Alice"}
        assert success["board"] == {"uid": context.boards["private"], "name": "Private Alpha", "deleted": False}
        assert success["prompt"].endswith("never be truncated by the server")
        assert [ref["ordinal"] for ref in success["references"]] == [0, 1]
        assert [ref["asset_uid"] for ref in success["references"]] == [context.assets["reference"]] * 2
        assert [(ref["mime_type"], ref["width"], ref["height"]) for ref in success["references"]] == [
            ("image/jpeg", 80, 60),
            ("image/jpeg", 80, 60),
        ]
        assert success["output"]["asset_uid"] == context.assets["output"]
        assert success["attempt_count"] == 2
        assert success["known_cost_usd"] == "0.0300000000"
        assert success["usage"] == {"input_units": 5, "output_units": 7, "total_units": 12, "generated_images": 3}
        deleted = next(item for item in payload["items"] if item["generation_uid"] == context.generations["failed"])
        assert deleted["board"] == {"uid": context.boards["deleted"], "name": None, "deleted": True}
        assert deleted["error_message"] == "Stored safe terminal failure"
        assert deleted["known_cost_usd"] == "0E-10"
        assert deleted["usage"]["input_units"] == 0
        retryable = next(item for item in payload["items"] if item["generation_uid"] == context.generations["retryable"])
        assert retryable["board"]["name"] is None and retryable["board"]["deleted"] is False
        assert retryable["error_message"] == "Stored safe provider failure"
        forbidden = {
            "email",
            "password_hash",
            "google_sub",
            "client_request_uid",
            "request_fingerprint",
            "worker_uid",
            "lease_expires_at",
            "pending_output_storage_key",
            "storage_key",
            "content_sha256",
            "provider_request_id",
            "asset_snapshot",
            "reference_node_uid",
        }
        assert forbidden.isdisjoint(response.text)
        assert "alice-private@example.test" not in response.text
        assert context.service.provider_calls == 0


@pytest.mark.asyncio
async def test_history_summary_filters_statuses_and_null_zero_cost_usage_contracts(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path: Path,
) -> None:
    """Summary and filters share status definitions while preserving missing versus zero."""
    async with _history_context(initialized_image_pg_pool, tmp_path) as context:
        summary_response = await context.client.get("/image-history/summary", headers=_auth(context))
        assert summary_response.status_code == 200
        assert summary_response.headers["cache-control"] == "private, no-store"
        summary = summary_response.json()
        assert summary["overall"] == {
            "generation_count": 5,
            "succeeded_count": 2,
            "failed_count": 1,
            "active_count": 2,
            "attempt_count": 6,
            "priced_attempt_count": 3,
            "cost_unreported_attempt_count": 3,
            "known_cost_usd": "0.0300000000",
            "usage": {"input_units": 5, "output_units": 7, "total_units": 12, "generated_images": 3},
        }
        bob = next(item for item in summary["users"] if item["user"]["username"] == "bob")
        assert bob["user"] == {"uid": context.users["bob"], "username": "bob", "name": None}
        assert bob["known_cost_usd"] is None
        assert bob["usage"] == {"input_units": None, "output_units": None, "total_units": None, "generated_images": None}

        for run_status, expected in {"started": 1, "retryable": 1, "succeeded": 2, "failed": 1}.items():
            response = await context.client.get(f"/image-history?status={run_status}", headers=_auth(context))
            assert response.status_code == 200
            assert len(response.json()["items"]) == expected
            assert {item["status"] for item in response.json()["items"]} == {run_status}
        user_response = await context.client.get(
            f"/image-history?user_uid={context.users['alice']}",
            headers=_auth(context),
        )
        assert {item["user"]["uid"] for item in user_response.json()["items"]} == {context.users["alice"]}
        assert len(user_response.json()["items"]) == 2

        attemptless_uid = gen_uid()
        async with initialized_image_pg_pool.acquire() as conn:
            await _insert_run(
                conn,
                generation_uid=attemptless_uid,
                user_uid=context.users["carol"],
                board_uid=context.boards["private"],
                run_status="started",
                started_at=datetime(2026, 8, 23, 2, 0, tzinfo=UTC),
            )

        damaged_summary_response = await context.client.get("/image-history/summary", headers=_auth(context))
        assert damaged_summary_response.status_code == 200
        damaged_summary = damaged_summary_response.json()
        assert damaged_summary["overall"] == {
            "generation_count": 6,
            "succeeded_count": 2,
            "failed_count": 1,
            "active_count": 3,
            "attempt_count": 6,
            "priced_attempt_count": 3,
            "cost_unreported_attempt_count": 3,
            "known_cost_usd": "0.0300000000",
            "usage": {"input_units": 5, "output_units": 7, "total_units": 12, "generated_images": 3},
        }
        carol = next(item for item in damaged_summary["users"] if item["user"]["username"] == "carol")
        assert carol == {
            "user": {"uid": context.users["carol"], "username": "carol", "name": "Carol"},
            "generation_count": 1,
            "succeeded_count": 0,
            "failed_count": 0,
            "active_count": 1,
            "attempt_count": 0,
            "priced_attempt_count": 0,
            "cost_unreported_attempt_count": 0,
            "known_cost_usd": None,
            "usage": {"input_units": None, "output_units": None, "total_units": None, "generated_images": None},
        }
        with pytest.raises(RuntimeError, match="run has no audit attempt"):
            await context.client.get(
                "/image-history",
                params={"user_uid": context.users["carol"]},
                headers=_auth(context),
            )


@pytest.mark.asyncio
async def test_history_cursor_is_stable_strict_and_applies_current_filters(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path: Path,
) -> None:
    """Keyset pages handle tied timestamps, trim limit+1, and validate cursors."""
    async with _history_context(initialized_image_pg_pool, tmp_path) as context:
        seen: list[str] = []
        cursor: str | None = None
        while True:
            params: dict[str, str | int] = {"limit": 2}
            if cursor is not None:
                params["cursor"] = cursor
            response = await context.client.get("/image-history", params=params, headers=_auth(context))
            assert response.status_code == 200
            page = response.json()
            assert len(page["items"]) <= 2
            seen.extend(item["generation_uid"] for item in page["items"])
            cursor = page["next_cursor"]
            if cursor is None:
                break
        assert len(seen) == 5
        assert len(set(seen)) == 5
        tied = [
            context.generations["success"],
            context.generations["retryable"],
            context.generations["failed"],
        ]
        assert seen[:3] == sorted(tied, reverse=True)

        first = await context.client.get("/image-history?limit=1", headers=_auth(context))
        filtered = await context.client.get(
            "/image-history",
            params={"cursor": first.json()["next_cursor"], "status": "failed"},
            headers=_auth(context),
        )
        assert {item["status"] for item in filtered.json()["items"]} <= {"failed"}

        cursor_before_all = encode_image_history_cursor(
            datetime(2027, 1, 1, tzinfo=UTC),
            "f" * 32,
        )
        user_filtered = await context.client.get(
            "/image-history",
            params={"cursor": cursor_before_all, "user_uid": context.users["alice"]},
            headers=_auth(context),
        )
        assert {item["user"]["uid"] for item in user_filtered.json()["items"]} == {context.users["alice"]}

        invalid_payloads = [
            "%%%",
            base64.urlsafe_b64encode(json.dumps({"v": 1, "started_at": "bad", "generation_uid": "a" * 32}).encode()).decode().rstrip("="),
            base64.urlsafe_b64encode(json.dumps({"v": 1, "started_at": "2026-08-23T00:00:00+00:00", "generation_uid": "bad"}).encode())
            .decode()
            .rstrip("="),
        ]
        for invalid in invalid_payloads:
            response = await context.client.get("/image-history", params={"cursor": invalid}, headers=_auth(context))
            assert response.status_code == 422
        assert (await context.client.get("/image-history?limit=51", headers=_auth(context))).status_code == 422


@pytest.mark.asyncio
async def test_history_content_is_generation_scoped_verified_and_no_store(
    initialized_image_pg_pool: asyncpg.Pool,
    tmp_path: Path,
) -> None:
    """Authenticated non-members can read related bytes but not arbitrary asset pairs."""
    async with _history_context(initialized_image_pg_pool, tmp_path) as context:
        base = f"/image-history/{context.generations['success']}/assets"
        for asset_name in ("output", "reference"):
            response = await context.client.get(f"{base}/{context.assets[asset_name]}/content", headers=_auth(context))
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/png"
            assert response.headers["cache-control"] == "private, no-store"
            assert response.headers["x-content-type-options"] == "nosniff"
            assert response.content.startswith(b"\x89PNG")

        assert (await context.client.get(f"{base}/{context.assets['unrelated']}/content", headers=_auth(context))).status_code == 404
        assert (
            await context.client.get(
                f"{base}/{context.assets['unpriced_output']}/content",
                headers=_auth(context),
            )
        ).status_code == 404
        assert (await context.client.get(f"{base}/{context.assets['output']}/content")).status_code == 401
        assert context.service.provider_calls == 0
