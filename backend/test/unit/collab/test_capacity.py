"""Unit tests for the plan-based room capacity lookup."""

from unittest.mock import AsyncMock

import pytest

from topix.collab import capacity
from topix.collab.capacity import (
    DEFAULT_CAP,
    MAX_CAP,
    cap_for_plan,
    get_room_cap_for_board,
)


@pytest.fixture(autouse=True)
def _billing_active(monkeypatch):
    """Force billing active by default so plan-based caps apply (OSS test overrides)."""
    monkeypatch.setattr(capacity, "is_billing_active", lambda: True)


def test_cap_for_plan_known_tiers():
    """Cap for plan known tiers."""
    assert cap_for_plan("free") == 5
    assert cap_for_plan("basic") == 10
    assert cap_for_plan("plus") == 20


def test_cap_for_plan_unknown_or_none_uses_free_default():
    """Cap for plan unknown or none uses free default."""
    assert cap_for_plan(None) == DEFAULT_CAP
    assert cap_for_plan("enterprise") == DEFAULT_CAP
    assert cap_for_plan("") == DEFAULT_CAP


class _Billing:
    def __init__(self, plan, status="active"):
        """Init."""
        self.plan = plan
        self.status = status


async def test_get_room_cap_uses_owners_plan_not_joiners():
    """Capacity comes from the board's owner, not the joining user.

    Looks up the owner's plan regardless of which user is connecting.
    """
    graph_store = AsyncMock()
    graph_store.get_owner_uid = AsyncMock(return_value="alice")
    billing_store = AsyncMock()
    billing_store.get_user_billing = AsyncMock(return_value=_Billing(plan="plus"))

    cap = await get_room_cap_for_board(
        graph_store=graph_store, user_billing_store=billing_store, board_uid="b1",
    )

    assert cap == 20
    graph_store.get_owner_uid.assert_awaited_once_with("b1")
    billing_store.get_user_billing.assert_awaited_once_with("alice")


async def test_get_room_cap_unlimited_when_billing_inactive(monkeypatch):
    """OSS / unconfigured billing gives the max cap without touching billing."""
    monkeypatch.setattr(capacity, "is_billing_active", lambda: False)
    graph_store = AsyncMock()
    billing_store = AsyncMock()

    cap = await get_room_cap_for_board(
        graph_store=graph_store, user_billing_store=billing_store, board_uid="b1",
    )

    assert cap == MAX_CAP
    graph_store.get_owner_uid.assert_not_awaited()


async def test_get_room_cap_gates_incomplete_plus_to_free():
    """A never-paid (`incomplete`) plus subscription only gets the free cap."""
    graph_store = AsyncMock()
    graph_store.get_owner_uid = AsyncMock(return_value="alice")
    billing_store = AsyncMock()
    billing_store.get_user_billing = AsyncMock(return_value=_Billing(plan="plus", status="incomplete"))

    cap = await get_room_cap_for_board(
        graph_store=graph_store, user_billing_store=billing_store, board_uid="b1",
    )

    assert cap == DEFAULT_CAP


async def test_get_room_cap_defaults_to_free_when_billing_missing():
    """An owner who has never set up billing is on the free tier."""
    graph_store = AsyncMock()
    graph_store.get_owner_uid = AsyncMock(return_value="alice")
    billing_store = AsyncMock()
    billing_store.get_user_billing = AsyncMock(return_value=None)

    cap = await get_room_cap_for_board(
        graph_store=graph_store, user_billing_store=billing_store, board_uid="b1",
    )

    assert cap == DEFAULT_CAP


async def test_get_room_cap_defaults_to_free_when_no_owner():
    """A board with no owner row falls back to free cap; we log + allow."""
    graph_store = AsyncMock()
    graph_store.get_owner_uid = AsyncMock(return_value=None)
    billing_store = AsyncMock()

    cap = await get_room_cap_for_board(
        graph_store=graph_store, user_billing_store=billing_store, board_uid="b1",
    )

    assert cap == DEFAULT_CAP
    billing_store.get_user_billing.assert_not_awaited()
