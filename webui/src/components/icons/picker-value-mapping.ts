import type { IconProperty } from "@/features/newsfeed/types/properties"
import type { IconPickerValue } from "./icon-picker-lazy"


/**
 * Maps a stored `IconProperty.icon` value into the picker's controlled
 * value shape. Only the `phosphor` variant reflects in the picker UI
 * (the only variant the picker can produce); emoji/iconify variants are
 * preserved on the note but the picker opens with no selection so the
 * user can pick fresh.
 */
export const iconToPickerValue = (
  icon: IconProperty["icon"] | null | undefined,
): IconPickerValue | null => {
  if (icon?.type !== "phosphor") return null
  return { name: icon.name, color: icon.color ?? null }
}


/**
 * Inverse of `iconToPickerValue` for committed selections. Always
 * produces a `phosphor` variant — Remove is signaled separately by the
 * picker's `onRemove` callback, not by passing a null name.
 */
export const pickerValueToIcon = (value: IconPickerValue): IconProperty["icon"] => {
  return { type: "phosphor", name: value.name, color: value.color }
}
