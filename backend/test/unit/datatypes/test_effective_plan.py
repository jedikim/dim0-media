"""Tests for status-gated plan resolution (billing access guard)."""

import pytest

from topix.datatypes.user_billing import coerce_plan, effective_plan


@pytest.mark.parametrize("value", ["free", "basic", "plus"])
def test_coerce_plan_passes_valid_plans(value):
    """Valid plan strings are returned unchanged."""
    assert coerce_plan(value) == value


@pytest.mark.parametrize("value", [None, "", "pro", "enterprise", "PLUS"])
def test_coerce_plan_fails_closed_to_free(value):
    """Unknown/missing values fail closed to free (never over-grant)."""
    assert coerce_plan(value) == "free"


@pytest.mark.parametrize("plan", ["basic", "plus"])
@pytest.mark.parametrize("status", ["active", "trialing", "past_due"])
def test_paid_plan_granted_for_access_statuses(plan, status):
    """A paid plan keeps access while the subscription status grants it."""
    assert effective_plan(plan, status) == plan


@pytest.mark.parametrize("plan", ["basic", "plus"])
@pytest.mark.parametrize("status", ["incomplete", "canceled"])
def test_paid_plan_revoked_for_non_access_statuses(plan, status):
    """A never-paid/canceled subscription must not grant a paid plan."""
    assert effective_plan(plan, status) == "free"


@pytest.mark.parametrize("status", ["active", "incomplete", "canceled", "past_due"])
def test_free_plan_stays_free(status):
    """A free plan is unaffected by status."""
    assert effective_plan("free", status) == "free"
