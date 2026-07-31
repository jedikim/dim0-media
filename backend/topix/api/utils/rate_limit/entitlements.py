"""Entitlement resolution for rate limiting."""

from fastapi import Request

from topix.api.utils.billing.stripe_config import is_billing_active
from topix.api.utils.rate_limit.types import BillingCycle, EntitlementContext, PlanType
from topix.api.utils.rate_limit.windows import as_utc
from topix.datatypes.user_billing import effective_plan
from topix.store.user_billing import UserBillingStore

# Plan when billing is on but the user has no (or a never-paid) subscription.
DEFAULT_PLAN: PlanType = "free"
# Plan when billing is inactive (OSS / self-host): everything unlocked.
OSS_PLAN: PlanType = "plus"


async def resolve_effective_plan(request: Request, user_uid: str) -> PlanType:
    """Resolve a user's effective plan — the single source of truth.

    - Billing inactive (flag off OR Stripe keys missing → `is_billing_active()`
      false): `plus` — OSS/self-host runs fully unlocked, no tiering.
    - Billing active: the stored plan, gated on subscription status so a
      never-paid (`incomplete`) subscription never grants a paid tier.

    Used by the token claim and the `/billing/me` report; `resolve_entitlement_context`
    applies the same gate before it also needs the billing cycle.
    """
    if not is_billing_active():
        return OSS_PLAN

    store: UserBillingStore | None = getattr(request.app, "user_billing_store", None)
    if store is None:
        return DEFAULT_PLAN
    billing = await store.get_user_billing(user_uid)
    if billing is None:
        return DEFAULT_PLAN
    return effective_plan(billing.plan, billing.status)


async def resolve_entitlement_context(request: Request, user_uid: str) -> EntitlementContext:
    """Resolve plan + optional billing-cycle window for the request user.

    Billing inactive → `plus` with no cycle (OSS: nothing is metered). Otherwise
    the status-gated stored plan plus its billing cycle when present.
    """
    if not is_billing_active():
        return EntitlementContext(plan=OSS_PLAN)

    store: UserBillingStore | None = getattr(request.app, "user_billing_store", None)
    if store is None:
        return EntitlementContext(plan=DEFAULT_PLAN)
    billing = await store.get_user_billing(user_uid)
    if billing is None:
        return EntitlementContext(plan=DEFAULT_PLAN)

    plan = effective_plan(billing.plan, billing.status)
    if billing.current_period_start and billing.current_period_end:
        start_utc = as_utc(billing.current_period_start)
        end_utc = as_utc(billing.current_period_end)
        if start_utc < end_utc:
            return EntitlementContext(plan=plan, cycle=BillingCycle(start=start_utc, end=end_utc))

    # No cycle information yet (e.g. free user or pre-billing setup).
    return EntitlementContext(plan=plan)
