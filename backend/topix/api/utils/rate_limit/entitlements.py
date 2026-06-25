"""Entitlement resolution for rate limiting."""

from fastapi import Request

from topix.api.utils.rate_limit.types import BillingCycle, EntitlementContext, PlanType
from topix.api.utils.rate_limit.windows import as_utc
from topix.datatypes.user_billing import effective_plan
from topix.store.user_billing import UserBillingStore

DEFAULT_PLAN: PlanType = "free"


async def resolve_entitlement_context(request: Request, user_uid: str) -> EntitlementContext:
    """Resolve plan and optional billing context for the request user.

    The plan is gated on subscription status so a never-paid (`incomplete`)
    subscription does not grant paid entitlements.
    """
    store: UserBillingStore | None = getattr(request.app, "user_billing_store", None)
    if store is None:
        return EntitlementContext(plan=DEFAULT_PLAN)

    billing = await store.get_user_billing(user_uid)
    if billing is None:
        return EntitlementContext(plan=DEFAULT_PLAN)

    plan = effective_plan(billing.plan, billing.status)

    cycle_start = billing.current_period_start
    cycle_end = billing.current_period_end

    if cycle_start and cycle_end:
        start_utc = as_utc(cycle_start)
        end_utc = as_utc(cycle_end)
        if start_utc < end_utc:
            return EntitlementContext(plan=plan, cycle=BillingCycle(start=start_utc, end=end_utc))

    # Fallback: no cycle information yet (e.g. free user or pre-billing setup).
    return EntitlementContext(plan=plan)
