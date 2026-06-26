"""Helpers to resolve plan for JWT access token claims."""

from fastapi import Request

from topix.api.utils.billing.stripe_config import is_billing_active
from topix.datatypes.user_billing import BillingPlan, effective_plan
from topix.store.user_billing import UserBillingStore


async def resolve_plan_for_token(request: Request, user_uid: str) -> BillingPlan:
    """Resolve plan claim for access token payload.

    When billing is inactive (disabled or unconfigured), return plus so the UI
    unlocks all features for OSS / self-hosted deploys.
    """
    if not is_billing_active():
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
