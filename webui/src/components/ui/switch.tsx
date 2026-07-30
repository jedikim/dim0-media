import { cn } from "@/lib/utils"


type SwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Accessible name when there's no visible <label> wired to the control. */
  label?: string
  disabled?: boolean
  className?: string
}


/**
 * Minimal accessible toggle switch (`role="switch"`). Controlled: the parent
 * owns `checked` and updates it in `onCheckedChange`. Hand-rolled rather than
 * pulling in `@radix-ui/react-switch` — it's a single button with no menu/focus
 * machinery to warrant the dependency.
 */
export const Switch = ({ checked, onCheckedChange, label, disabled = false, className }: SwitchProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onCheckedChange(!checked)}
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
      "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-secondary-foreground/15",
      "disabled:cursor-not-allowed disabled:opacity-50",
      checked ? "bg-primary" : "bg-muted-foreground/30",
      className,
    )}
  >
    <span
      className={cn(
        "inline-block size-4 rounded-full bg-background shadow-sm transition-transform",
        checked ? "translate-x-4" : "translate-x-0.5",
      )}
    />
  </button>
)
