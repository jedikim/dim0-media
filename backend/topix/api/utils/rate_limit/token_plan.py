"""Helpers to resolve plan for JWT access token claims."""

from fastapi import Request

from topix.api.utils.rate_limit.entitlements import resolve_effective_plan
from topix.datatypes.user_billing import BillingPlan


async def resolve_plan_for_token(request: Request, user_uid: str) -> BillingPlan:
    """Resolve the plan claim stamped into the access token.

    Delegates to the shared `resolve_effective_plan` so the token, `/billing/me`,
    and rate-limit entitlement can never disagree about a user's plan: billing
    inactive → `plus` (OSS unlocked); active → the status-gated stored plan.
    """
    return await resolve_effective_plan(request, user_uid)
