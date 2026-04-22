import { DashboardIcon } from "@/components/icons"
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar"
import { useNavigate, useRouterState } from "@tanstack/react-router"

/**
 * Subscriptions menu item component
 */
export function SubscriptionsMenuItem() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const isActive = pathname === `/subscriptions`

  const handleClick = () => {
    navigate({ to: '/subscriptions' })
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={handleClick}
        className="text-xs font-medium truncate"
        isActive={isActive}
      >
        <DashboardIcon className="shrink-0 size-4 text-sidebar-icon-3" strokeWidth={2} />
        <span>Newsfeed</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
