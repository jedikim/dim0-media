"""Unit tests for image-history cursor and usage contracts."""

from __future__ import annotations

import base64
import json

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from topix.image_generation.history import (
    ImageHistoryPage,
    InvalidImageHistoryCursorError,
    decode_image_history_cursor,
    encode_image_history_cursor,
)
from topix.image_generation.models import ProviderUsage
from topix.store import image_history as image_history_store_module
from topix.store.image_history import ImageHistoryStore


def _cursor_payload(payload: object) -> str:
    """Encode arbitrary test JSON using the production cursor transport."""
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")


def test_history_cursor_round_trips_aware_timestamp_and_exact_uid() -> None:
    """Valid cursors preserve the keyset timestamp and 32-hex generation UID."""
    started_at = datetime(2026, 8, 23, 1, 2, 3, 456789, tzinfo=UTC)
    generation_uid = "a" * 32

    cursor = decode_image_history_cursor(encode_image_history_cursor(started_at, generation_uid))

    assert cursor.started_at == started_at
    assert cursor.generation_uid == generation_uid


@pytest.mark.parametrize(
    "cursor",
    [
        "%%%",
        _cursor_payload({"v": 1, "started_at": "not-a-date", "generation_uid": "a" * 32}),
        _cursor_payload({"v": 1, "started_at": "2026-08-23T01:02:03", "generation_uid": "a" * 32}),
        _cursor_payload({"v": 1, "started_at": "2026-08-23T01:02:03+00:00", "generation_uid": "ABC"}),
        _cursor_payload({"v": 2, "started_at": "2026-08-23T01:02:03+00:00", "generation_uid": "a" * 32}),
        _cursor_payload({"v": True, "started_at": "2026-08-23T01:02:03+00:00", "generation_uid": "a" * 32}),
        _cursor_payload({"v": 1.0, "started_at": "2026-08-23T01:02:03+00:00", "generation_uid": "a" * 32}),
        _cursor_payload({"v": 1, "started_at": "2026-08-23T01:02:03+00:00", "generation_uid": "a" * 32, "extra": True}),
    ],
)
def test_history_cursor_rejects_invalid_transport_structure_timestamp_and_uid(cursor: str) -> None:
    """Malformed, naive, version-mismatched, and noncanonical cursors fail closed."""
    with pytest.raises(InvalidImageHistoryCursorError, match="Invalid image history cursor"):
        decode_image_history_cursor(cursor)


def test_provider_usage_dump_preserves_missing_keys_and_reported_zero() -> None:
    """History fixtures follow the actual durable ProviderUsage JSON contract."""
    assert ProviderUsage().model_dump(mode="json", exclude_none=True) == {}
    assert ProviderUsage(input_units=0).model_dump(mode="json", exclude_none=True) == {"input_units": 0}
    assert ProviderUsage(input_units=5, generated_images=1).model_dump(mode="json", exclude_none=True) == {
        "input_units": 5,
        "generated_images": 1,
    }


@pytest.mark.asyncio
async def test_history_list_uses_short_readonly_repeatable_read_transaction(monkeypatch) -> None:
    """Page rows and their batched projections share one stable DB snapshot."""
    inside_transaction = False
    conn = MagicMock(name="history_connection")
    pool = MagicMock(name="history_pool")
    expected = ImageHistoryPage(items=(), next_cursor=None)

    @asynccontextmanager
    async def acquire_connection():
        """Yield the fake shared connection."""
        yield conn

    @asynccontextmanager
    async def transaction_scope():
        """Record whether the projection executes inside the transaction."""
        nonlocal inside_transaction
        inside_transaction = True
        try:
            yield
        finally:
            inside_transaction = False

    async def fake_list(*args, **kwargs):
        """Return a page only after observing the active snapshot."""
        assert inside_transaction is True
        return expected

    pool.acquire.side_effect = acquire_connection
    conn.transaction.side_effect = lambda **_kwargs: transaction_scope()
    list_mock = AsyncMock(side_effect=fake_list)
    monkeypatch.setattr(image_history_store_module, "list_image_history", list_mock)
    store = ImageHistoryStore()
    await store.open(pool)

    result = await store.list(limit=25, cursor=None, user_uid=None, status=None)

    assert result is expected
    conn.transaction.assert_called_once_with(isolation="repeatable_read", readonly=True)
    list_mock.assert_awaited_once_with(conn, limit=25, cursor=None, user_uid=None, status=None)
