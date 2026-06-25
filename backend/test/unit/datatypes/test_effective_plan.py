"""Tests for status-gated plan resolution (billing access guard)."""

import pytest

from topix.datatypes.user_billing import effective_plan


@pytest.mark.parametrize("status", ["active", "trialing", "past_due"])
def test_paid_plan_granted_for_access_statuses(status):
    """A paid plan keeps access while the subscription status grants it."""
    assert effective_plan("plus", status) == "plus"


@pytest.mark.parametrize("status", ["incomplete", "canceled"])
def test_paid_plan_revoked_for_non_access_statuses(status):
    """A never-paid/canceled subscription must not grant a paid plan."""
    assert effective_plan("plus", status) == "free"


@pytest.mark.parametrize("status", ["active", "incomplete", "canceled", "past_due"])
def test_free_plan_stays_free(status):
    """A free plan is unaffected by status."""
    assert effective_plan("free", status) == "free"
