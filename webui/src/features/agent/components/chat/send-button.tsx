import { Button } from "@/components/ui/button"
import { LoaderIcon, SendIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import type React from "react"


interface SendButtonProps extends React.ComponentProps<typeof Button> {
  loadingStatus?: "loaded" | "loading"
}


export function SendButton({  className,
  loadingStatus = "loaded",
  ...props
}: SendButtonProps) {
  return (
    <Button
      className={cn("rounded-lg flex items-center justify-center shadow-none", className)}
      {...props}
      variant={loadingStatus === "loaded" ? 'default' : "ghost"}
      size="icon"
    >
      {
        loadingStatus === "loaded" ?
        <SendIcon className="size-4 shrink-0" strokeWidth={2} /> :
        <LoaderIcon className="size-4 shrink-0 animate-spin" strokeWidth={2} />
      }
    </Button>
  )
}
