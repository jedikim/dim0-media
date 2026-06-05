import { lazy, Suspense } from "react"
import { cn } from "@/lib/utils"
import type { IconPickerProps } from "./icon-picker"


/**
 * Lazily-imported picker. Pulling this module does NOT load the curated
 * icon set — both `icon-picker` and `picker-set` (with its 261 Phosphor
 * imports) are split into their own chunk that resolves on first render.
 *
 * Consumers should import from this file, never from `./icon-picker`
 * directly, so the lazy boundary is preserved.
 */
const LazyIconPickerImpl = lazy(() =>
  import("./icon-picker").then((module) => ({ default: module.IconPicker })),
)


export const LazyIconPicker = (props: IconPickerProps) => {
  return (
    <Suspense fallback={<IconPickerFallback className={props.className} />}>
      <LazyIconPickerImpl {...props} />
    </Suspense>
  )
}


type IconPickerFallbackProps = {
  className?: string
}


/**
 * Skeleton placeholder shown while the picker chunk is loading. Matches
 * the picker's outer dimensions so the surrounding popover doesn't jump.
 */
const IconPickerFallback = ({ className }: IconPickerFallbackProps) => {
  return (
    <div
      className={cn(
        "flex h-[460px] w-[360px] animate-pulse flex-col rounded-md border bg-popover",
        className,
      )}
      aria-hidden="true"
    />
  )
}


export type { IconPickerProps, IconPickerValue } from "./icon-picker"
