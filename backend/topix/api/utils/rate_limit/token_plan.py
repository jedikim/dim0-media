"""Helpers to resolve plan for JWT access token claims."""

import os

from fastapi import Request

from topix.datatypes.user_billing import BillingPlan, effective_plan
from topix.store.user_billing import UserBillingStore

BILLING_ENABLED_ENV = "VITE_BILLING_ENABLED"


def _is_truthy(value: str | None) -> bool:
    """Parse common truthy env values."""
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


async def resolve_plan_for_token(request: Request, user_uid: str) -> BillingPlan:
    """Resolve plan claim for access token payload.

    When billing is disabled, return plus so UI naturally avoids paywall behavior.
    """
    billing_enabled = _is_truthy(os.getenv(BILLING_ENABLED_ENV))
    if not billing_enabled:
        return "plus"

    store: UserBillingStore | None = getattr(request.app, "user_billing_store", None)
    if store is None:
        return "free"

    billing = await store.get_user_billing(user_uid)
    if billing is None:
        return "free"

    # Gate on status so a never-paid (`incomplete`) subscription never yields a
    # paid plan claim in the access token.
    return effective_plan(billing.plan, billing.status)
