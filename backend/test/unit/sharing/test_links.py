"""Unit tests for `sharing.links`.

Thin wrapper over the postgres helpers; we test that policy (token
shape, role validation) holds and that the wrapper delegates correctly.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from topix.sharing import links


@pytest.fixture
def fake_conn():
    """Fake conn."""
    return AsyncMock()


async def test_mint_link_generates_unguessable_token(monkeypatch, fake_conn):
    """Mint link generates unguessable token."""
    monkeypatch.setattr(links.gsl, "insert_share_link", AsyncMock())

    tokens = set()
    for _ in range(20):
        tok = await links.mint_link(
            fake_conn, graph_uid="b1", role="member", created_by_uid="u1",
        )
        tokens.add(tok)

    assert len(tokens) == 20
    for t in tokens:
        assert len(t) >= 32  # token_urlsafe(32) ≈ 43 chars


async def test_mint_link_rejects_invalid_role(monkeypatch, fake_conn):
    """Mint link rejects invalid role."""
    monkeypatch.setattr(links.gsl, "insert_share_link", AsyncMock())

    with pytest.raises(ValueError):
        await links.mint_link(
            fake_conn, graph_uid="b1", role="owner", created_by_uid="u1",  # type: ignore[arg-type]
        )


async def test_mint_link_persists_via_postgres_helper(monkeypatch, fake_conn):
    """Mint link persists via postgres helper."""
    insert_mock = AsyncMock()
    monkeypatch.setattr(links.gsl, "insert_share_link", insert_mock)

    token = await links.mint_link(
        fake_conn, graph_uid="b1", role="viewer", created_by_uid="u1",
    )

    insert_mock.assert_awaited_once_with(
        fake_conn, token=token, graph_uid="b1", role="viewer", created_by_uid="u1",
    )


async def test_preview_returns_none_when_link_unknown_or_revoked(monkeypatch, fake_conn):
    """Preview returns none when link unknown or revoked."""
    monkeypatch.setattr(links.gsl, "get_active_link", AsyncMock(return_value=None))

    assert await links.preview(fake_conn, token="nope") is None


async def test_revoke_delegates_to_postgres_helper(monkeypatch, fake_conn):
    """Revoke delegates to postgres helper."""
    revoke_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(links.gsl, "revoke_link", revoke_mock)

    result = await links.revoke(fake_conn, graph_uid="b1", token="t")

    assert result is True
    revoke_mock.assert_awaited_once_with(fake_conn, token="t", graph_uid="b1")
