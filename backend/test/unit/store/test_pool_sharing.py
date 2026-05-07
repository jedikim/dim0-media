"""Unit tests for shared Postgres pool ownership across stores."""

from __future__ import annotations

import asyncio

from unittest.mock import AsyncMock, MagicMock

import pytest

from topix.datatypes.note.note import Note
from topix.datatypes.resource import RichText
from topix.store import chat as chat_module
from topix.store import email_verification as email_module
from topix.store import graph as graph_module
from topix.store import user as user_module
from topix.store import user_billing as user_billing_module


def _make_fake_pool() -> MagicMock:
    """Build a stand-in pool that records ``close`` calls and supports acquire."""
    pool = MagicMock(name="pg_pool")
    pool.close = AsyncMock()

    class _Acquire:
        async def __aenter__(self):
            return MagicMock(name="conn")

        async def __aexit__(self, exc_type, exc, tb):
            return None

    pool.acquire = MagicMock(return_value=_Acquire())
    return pool


def _stub_content_store(monkeypatch, module) -> None:
    """Stub ``ContentStore.from_config`` on a store module so __init__ doesn't read Config."""
    if hasattr(module, "ContentStore"):
        monkeypatch.setattr(
            module.ContentStore, "from_config", classmethod(lambda cls: AsyncMock())
        )


@pytest.mark.asyncio
async def test_graph_store_uses_injected_pool_and_does_not_close_it(monkeypatch) -> None:
    """When GraphStore is given a shared pool, close() must leave it alone."""
    shared_pool = _make_fake_pool()

    fake_revision_store = AsyncMock()
    monkeypatch.setattr(
        graph_module, "NoteRevisionStore", MagicMock(return_value=fake_revision_store)
    )

    create_pool_spy = AsyncMock()
    monkeypatch.setattr(graph_module, "create_pool", create_pool_spy)

    _stub_content_store(monkeypatch, graph_module)
    store = graph_module.GraphStore()

    await store.open(shared_pool)

    create_pool_spy.assert_not_awaited()
    assert store._pg_pool is shared_pool
    assert store._owns_pool is False
    fake_revision_store.ensure_table.assert_awaited_once()

    await store.close()

    shared_pool.close.assert_not_awaited()
    store._content_store.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_graph_store_creates_and_closes_its_own_pool_when_none_given(monkeypatch) -> None:
    """Without an injected pool GraphStore creates one and is responsible for closing it."""
    private_pool = _make_fake_pool()

    create_pool_spy = AsyncMock(return_value=private_pool)
    monkeypatch.setattr(graph_module, "create_pool", create_pool_spy)

    fake_revision_store = AsyncMock()
    monkeypatch.setattr(
        graph_module, "NoteRevisionStore", MagicMock(return_value=fake_revision_store)
    )

    _stub_content_store(monkeypatch, graph_module)
    store = graph_module.GraphStore()

    await store.open()

    create_pool_spy.assert_awaited_once()
    assert store._pg_pool is private_pool
    assert store._owns_pool is True

    await store.close()
    private_pool.close.assert_awaited_once()


@pytest.mark.parametrize(
    ("module", "store_cls_name"),
    [
        (user_module, "UserStore"),
        (chat_module, "ChatStore"),
        (user_billing_module, "UserBillingStore"),
        (email_module, "EmailVerificationStore"),
    ],
)
@pytest.mark.asyncio
async def test_simple_stores_respect_shared_pool_ownership(
    monkeypatch, module, store_cls_name
) -> None:
    """All stores following the same pattern must not close a shared pool."""
    shared_pool = _make_fake_pool()
    create_pool_spy = AsyncMock()
    monkeypatch.setattr(module, "create_pool", create_pool_spy)
    _stub_content_store(monkeypatch, module)

    store_cls = getattr(module, store_cls_name)
    store = store_cls()

    await store.open(shared_pool)

    create_pool_spy.assert_not_awaited()
    assert store._pg_pool is shared_pool
    assert store._owns_pool is False

    await store.close()
    shared_pool.close.assert_not_awaited()


@pytest.mark.parametrize(
    ("module", "store_cls_name"),
    [
        (user_module, "UserStore"),
        (chat_module, "ChatStore"),
        (user_billing_module, "UserBillingStore"),
        (email_module, "EmailVerificationStore"),
    ],
)
@pytest.mark.asyncio
async def test_simple_stores_close_their_private_pool(
    monkeypatch, module, store_cls_name
) -> None:
    """Without an injected pool each store must close the pool it created."""
    private_pool = _make_fake_pool()
    monkeypatch.setattr(module, "create_pool", AsyncMock(return_value=private_pool))
    _stub_content_store(monkeypatch, module)

    store_cls = getattr(module, store_cls_name)
    store = store_cls()

    await store.open()

    assert store._pg_pool is private_pool
    assert store._owns_pool is True

    await store.close()
    private_pool.close.assert_awaited_once()


def _build_graph_store(snapshot_concurrency: int = 8) -> graph_module.GraphStore:
    """Build a GraphStore without bootstrapping external config."""
    store = object.__new__(graph_module.GraphStore)
    store._content_store = AsyncMock()
    store._pg_pool = None
    store._owns_pool = False
    store._note_revision_store = None
    store._note_locks = {}
    store._snapshot_sem = asyncio.Semaphore(snapshot_concurrency)
    store._snapshot_tasks = set()
    return store


def _make_note(note_id: str = "note-1") -> Note:
    """Make a representative note for snapshot tests."""
    return Note(
        id=note_id,
        graph_uid="graph-1",
        label=RichText(markdown="L"),
        content=RichText(markdown="C"),
    )


@pytest.mark.asyncio
async def test_snapshot_fanout_is_capped_by_semaphore() -> None:
    """Scheduled snapshots must never exceed the configured concurrency cap."""
    cap = 3
    store = _build_graph_store(snapshot_concurrency=cap)

    in_flight = 0
    peak = 0
    release = asyncio.Event()

    async def slow_save(_note, user_uid=None):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        try:
            await release.wait()
        finally:
            in_flight -= 1

    revision_store = AsyncMock()
    revision_store.save_note_snapshot.side_effect = slow_save
    store._note_revision_store = revision_store

    for i in range(cap * 4):
        store._schedule_note_snapshot(_make_note(f"note-{i}"))

    # Let the event loop schedule everyone, then count who actually ran.
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert peak <= cap

    release.set()

    pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)

    assert revision_store.save_note_snapshot.await_count == cap * 4
    assert peak == cap


@pytest.mark.asyncio
async def test_snapshot_no_op_when_revision_store_unset() -> None:
    """Scheduling without a revision store must be silent and never spawn a task."""
    store = _build_graph_store()
    store._note_revision_store = None

    before = len(asyncio.all_tasks())
    store._schedule_note_snapshot(_make_note())
    after = len(asyncio.all_tasks())

    assert after == before


@pytest.mark.asyncio
async def test_close_drains_pending_snapshot_tasks() -> None:
    """close() must wait for in-flight snapshot tasks before returning."""
    store = _build_graph_store()

    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_save(_note, user_uid=None):
        started.set()
        await release.wait()

    revision_store = AsyncMock()
    revision_store.save_note_snapshot.side_effect = slow_save
    store._note_revision_store = revision_store

    store._schedule_note_snapshot(_make_note())
    await started.wait()

    close_task = asyncio.create_task(store.close())
    # Yield a couple of times so close() can reach the gather and observably block.
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert not close_task.done()

    release.set()
    await close_task

    assert revision_store.save_note_snapshot.await_count == 1
    assert store._snapshot_tasks == set()
