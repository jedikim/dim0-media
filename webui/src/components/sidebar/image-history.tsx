import { useNavigate, useRouterState } from "@tanstack/react-router"

import { ImageGenerationIcon } from "@/components/icons"
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"


/** Navigate signed-in users to the global read-only AI image history. */
export function ImageHistoryMenuItem() {
  const navigate = useNavigate()
  const active = useRouterState({ select: (state) => state.location.pathname === "/image-history" })
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        className="truncate text-xs font-medium"
        onClick={() => navigate({ to: "/image-history" })}
      >
        <ImageGenerationIcon className="size-4 shrink-0 text-sidebar-icon-1" weight={active ? "fill" : undefined} />
        <span>AI image history</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
