import { Badge } from "@/components/ui/badge"
import { BILLING_ENABLED } from "@/config/billing"
import type { BillingPlan } from "@/lib/decode-jwt"
import { AwardIcon } from "@/components/icons"


type TierBadgeProps = {
  plan: BillingPlan
}


export function TierBadge({ plan }: TierBadgeProps) {
  if (!BILLING_ENABLED) return null

  const isPaid = plan === "plus" || plan === "basic"

  return (
    <Badge
      variant="outline"
      className={[
        "font-mono font-medium uppercase tracking-wide text-[10px]",
        isPaid
          ? "border-secondary-foreground bg-secondary-foreground/10 text-foreground"
          : "border-border bg-muted text-foreground",
      ].join(" ")}
    >
      {plan === "plus" ? <AwardIcon className="h-3.5 w-3.5 text-secondary-foreground" strokeWidth={2} /> : null}
      <span>{plan}</span>
    </Badge>
  )
}
