import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { IconProperty } from "@/features/newsfeed/types/properties"
import { LazyIconPicker } from "./icon-picker-lazy"
import type { IconPickerValue } from "./icon-picker-lazy"
import { IconPropertyView } from "./icon-property-view"
import { iconToPickerValue, pickerValueToIcon } from "./picker-value-mapping"


export type NoteIconControlProps = {
  /** Current icon (inner discriminated union — not the IconProperty wrapper). */
  icon: IconProperty["icon"] | null | undefined
  /** Called with the next inner icon value, or `null` to clear. */
  onChange: (next: IconProperty["icon"] | null) => void
  /** Pixel size of the displayed icon when one is set. */
  iconSize?: number
  /** Custom node for the "Add icon" affordance shown when no icon is set. */
  addIconLabel?: ReactNode
  className?: string
}


const DEFAULT_ADD_LABEL = "+ Add icon"


/**
 * Editable icon affordance for a note. Renders either the current icon
 * (click to reopen picker) or a hover-revealed "Add icon" button, with
 * the picker living in a popover. Owns the popover open state and the
 * mapping between `IconProperty.icon` and the picker's `IconPickerValue`.
 *
 * Callers stay focused on persistence — the `onChange` callback receives
 * either the next inner icon value (e.g. `{type:'phosphor', name, color}`)
 * or `null` for removal.
 */
export const NoteIconControl = ({
  icon,
  onChange,
  iconSize = 56,
  addIconLabel = DEFAULT_ADD_LABEL,
  className,
}: NoteIconControlProps) => {
  const [open, setOpen] = useState(false)

  const pickerValue = iconToPickerValue(icon)

  const handlePickerChange = (value: IconPickerValue) => {
    onChange(pickerValueToIcon(value))
  }

  const handleRemove = () => {
    onChange(null)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {icon ? (
          <button
            type="button"
            aria-label="Change icon"
            className={cn(
              "-ml-2 rounded-md p-2 transition-colors hover:bg-accent",
              className,
            )}
          >
            <IconPropertyView icon={icon} size={iconSize} />
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              "rounded-md px-2 py-1 text-sm text-muted-foreground opacity-0 transition-opacity",
              "hover:bg-accent hover:text-accent-foreground",
              "group-hover:opacity-100 data-[state=open]:opacity-100",
              className,
            )}
          >
            {addIconLabel}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-auto border-0 bg-transparent p-0 shadow-none"
      >
        <LazyIconPicker
          value={pickerValue}
          onChange={handlePickerChange}
          onRemove={handleRemove}
        />
      </PopoverContent>
    </Popover>
  )
}
