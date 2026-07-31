# ADR-BILLING-001: Billing-inactive deploys run full-OSS (plan `plus`, no limits)

**Status:** Accepted · 2026-07-30
**Applies to:** `backend/topix/api/utils/rate_limit/**`, `backend/topix/api/router/billing.py`, `backend/topix/api/utils/billing/stripe_config.py`, `webui/src/config/billing.ts`, `webui/src/features/board/lib/board-limit.ts`

## Decision
Billing is **active** iff `is_billing_active()` — `VITE_BILLING_ENABLED` truthy
**AND** all required Stripe env vars present (`stripe_config.REQUIRED_ENV_VARS`).
When inactive (self-host / OSS), the deploy runs fully unlocked: effective plan
`plus`, no tier gating, no rate/board/model limits.

- The effective plan MUST be resolved through the single helper
  `resolve_effective_plan` (`rate_limit/entitlements.py`); `resolve_plan_for_token`
  (JWT claim), `resolve_entitlement_context` (rate-limit), and `GET /billing/me`
  all go through it or apply the same `is_billing_active()` gate. No fourth copy.
- The frontend MUST consume the backend's decision — the JWT plan claim and
  `billing_enabled` from `/billing/me` (or `/billing/public-config`) — and MUST
  NOT gate tiers/limits on `VITE_BILLING_ENABLED` alone.

## Why
`VITE_BILLING_ENABLED` is read by BOTH the backend gate and the frontend flag,
but only the backend also checks the Stripe keys. When the plan decision was
copied into several resolvers, some (`/billing/me`, `resolve_entitlement_context`)
dropped the `is_billing_active()` check and defaulted to `free` — so a self-host
deploy with the flag set but no keys showed a **free tier with limits** even
though enforcement was (correctly) bypassed. The frontend made it worse by
re-deriving "billing on?" from the bare flag it can't fully evaluate (the web
container has no Stripe keys). One authority, consumed everywhere, is the fix.
Regressed once (PR #153 removed the original OSS bypass from the limits path).

## Consequences
- Adding a plan consumer: call `resolve_effective_plan`, never re-check the flag.
- Self-host stays unlimited with zero billing config; a keyless-but-flag-on deploy
  is treated as OSS, not a broken free tier.
- Enforcement already honored `is_billing_active()` (policy / capacity / boards /
  ai-metering); this aligns *reporting* and the *frontend* with it.

## Rejected alternatives
- **Per-resolver `is_billing_active` checks, copied** — how it drifted; one helper instead.
- **Frontend trusts `VITE_BILLING_ENABLED`** — the web container lacks the Stripe
  keys, so it can't compute the real gate; it must consume the backend's answer.

## Verify
`grep -rn "is_billing_active" backend/topix/api/utils/rate_limit backend/topix/api/router/billing.py`
shows the gate reached only via `resolve_effective_plan` / `resolve_entitlement_context` / `/billing/me`;
`grep -rn "VITE_BILLING_ENABLED\|BILLING_ENABLED" webui/src/features` shows no tier/limit gate keying on the raw flag.
