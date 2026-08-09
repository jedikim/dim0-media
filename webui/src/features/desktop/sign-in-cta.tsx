import { useNavigate } from "@tanstack/react-router"
import { SidebarMenuButton } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UserProfileIcon } from "@/components/icons"


const CTA_CLASS =
  "h-auto py-2 flex items-center gap-2 font-medium text-xs min-w-0 flex-1 text-secondary-foreground"


/**
 * Signed-out account CTA: sign in to sync & share. The remote server comes from
 * the build-time `VITE_API_URL` — there is no in-app server picker. The tooltip
 * reassures that account creation is free and card-less, to lower sign-up friction.
 */
export function SignInCta() {
  const navigate = useNavigate()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarMenuButton className={CTA_CLASS} onClick={() => navigate({ to: "/signin" })}>
          <UserProfileIcon className="size-4 shrink-0" strokeWidth={2} />
          <span>Sign in to sync &amp; share</span>
        </SidebarMenuButton>
      </TooltipTrigger>
      <TooltipContent side="top">
        Signing up is completely free — no credit card required
      </TooltipContent>
    </Tooltip>
  )
}
