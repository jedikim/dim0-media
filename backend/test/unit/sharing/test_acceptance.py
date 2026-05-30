"""Unit tests for `sharing.acceptance.accept_link`.

The upgrade-only rule is the headline behavior here, plus the four
happy paths (new / equal / lower-than-existing / higher-than-existing).
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from topix.sharing import acceptance


@pytest.fixture
def fake_conn():
    """Build a bare AsyncMock to satisfy the conn signature.

    The acceptance module doesn't call any conn methods directly
    except for the UPDATE on upgrade — which we stub via monkeypatch
    as well.
    """
    return AsyncMock()


async def test_accept_unknown_token_returns_none(monkeypatch, fake_conn):
    """Accept unknown token returns none."""
    monkeypatch.setattr(acceptance.links, "preview", AsyncMock(return_value=None))

    result = await acceptance.accept_link(fake_conn, token="nope", user_uid="u1")

    assert result is None


async def test_accept_creates_new_membership_when_not_yet_a_member(monkeypatch, fake_conn):
    """Accept creates new membership when not yet a member."""
    monkeypatch.setattr(
        acceptance.links, "preview",
        AsyncMock(return_value={"graph_uid": "b1", "role": "member"}),
    )
    monkeypatch.setattr(
        acceptance, "get_graph_role_by_user_uid",
        AsyncMock(return_value=None),
    )
    add_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(acceptance, "add_user_to_graph_by_uid", add_mock)

    result = await acceptance.accept_link(fake_conn, token="t", user_uid="u1")

    add_mock.assert_awaited_once_with(
        fake_conn, graph_uid="b1", user_uid="u1", role="member",
    )
    assert result == {"graph_uid": "b1", "role": "member", "already_member": False}


async def test_accept_upgrades_viewer_to_member_via_member_link(monkeypatch, fake_conn):
    """Accept upgrades viewer to member via member link."""
    monkeypatch.setattr(
        acceptance.links, "preview",
        AsyncMock(return_value={"graph_uid": "b1", "role": "member"}),
    )
    monkeypatch.setattr(
        acceptance, "get_graph_role_by_user_uid",
        AsyncMock(return_value="viewer"),
    )
    monkeypatch.setattr(
        acceptance, "get_user_id_by_uid",
        AsyncMock(return_value=42),
    )

    result = await acceptance.accept_link(fake_conn, token="t", user_uid="u1")

    fake_conn.execute.assert_awaited_once()
    # The UPDATE call's first positional arg is the new role.
    args, _ = fake_conn.execute.call_args
    assert args[1] == "member"  # new role
    assert result == {"graph_uid": "b1", "role": "member", "already_member": True}


async def test_accept_does_not_downgrade_owner_via_viewer_link(monkeypatch, fake_conn):
    """Accept does not downgrade owner via viewer link."""
    monkeypatch.setattr(
        acceptance.links, "preview",
        AsyncMock(return_value={"graph_uid": "b1", "role": "viewer"}),
    )
    monkeypatch.setattr(
        acceptance, "get_graph_role_by_user_uid",
        AsyncMock(return_value="owner"),
    )

    result = await acceptance.accept_link(fake_conn, token="t", user_uid="u1")

    fake_conn.execute.assert_not_awaited()
    assert result == {"graph_uid": "b1", "role": "owner", "already_member": True}


async def test_accept_does_not_downgrade_member_via_viewer_link(monkeypatch, fake_conn):
    """Accept does not downgrade member via viewer link."""
    monkeypatch.setattr(
        acceptance.links, "preview",
        AsyncMock(return_value={"graph_uid": "b1", "role": "viewer"}),
    )
    monkeypatch.setattr(
        acceptance, "get_graph_role_by_user_uid",
        AsyncMock(return_value="member"),
    )

    result = await acceptance.accept_link(fake_conn, token="t", user_uid="u1")

    fake_conn.execute.assert_not_awaited()
    assert result == {"graph_uid": "b1", "role": "member", "already_member": True}


async def test_accept_same_role_no_op(monkeypatch, fake_conn):
    """Re-clicking the same link as an existing member is a no-op."""
    monkeypatch.setattr(
        acceptance.links, "preview",
        AsyncMock(return_value={"graph_uid": "b1", "role": "member"}),
    )
    monkeypatch.setattr(
        acceptance, "get_graph_role_by_user_uid",
        AsyncMock(return_value="member"),
    )

    result = await acceptance.accept_link(fake_conn, token="t", user_uid="u1")

    fake_conn.execute.assert_not_awaited()
    assert result == {"graph_uid": "b1", "role": "member", "already_member": True}
