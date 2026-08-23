import { SidebarMenu } from "@/components/ui/sidebar"
import { DashboardMenuItem } from "./board"
import { HomeMenuItem } from "./home"
import { ImageHistoryMenuItem } from "./image-history"


/** Render backend workspace links only for a genuinely signed-in user. */
export function WorkspaceMenu({ signedIn }: { signedIn: boolean }) {
  return (
    <SidebarMenu>
      <HomeMenuItem />
      {signedIn && <DashboardMenuItem />}
      {signedIn && <ImageHistoryMenuItem />}
    </SidebarMenu>
  )
}
