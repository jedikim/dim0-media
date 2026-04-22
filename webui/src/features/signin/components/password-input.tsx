import * as React from "react"
import { ViewIcon, ViewOffIcon } from "@/components/icons"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

type Props = React.ComponentProps<typeof Input>

export function PasswordInput(props: Props) {
  const [show, setShow] = React.useState(false)

  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        {...props}
        className={`pr-9 ${props.className ?? ""}`}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setShow((v) => !v)}
        className="absolute right-1.5 top-1.5 h-7 w-7 rounded-lg text-muted-foreground"
        tabIndex={-1}
      >
        {show ? (
          <ViewOffIcon className="h-4 w-4" strokeWidth={2} />
        ) : (
          <ViewIcon className="h-4 w-4" strokeWidth={2} />
        )}
      </Button>
    </div>
  )
}
