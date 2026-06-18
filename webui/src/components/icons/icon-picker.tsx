import { useMemo, useState } from "react"
import { useTheme } from "@/components/theme-provider"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { resolveIconDisplayColor } from "./icon-color-resolver"
import {
  filterPickerCategories,
  ICON_COLOR_PRESETS,
  PICKER_CATEGORIES,
  type ColorPreset,
  type PickerCategory,
  type PickerIconEntry,
} from "./picker-set"


export type IconPickerValue = {
  name: string
  color: string | null
}


export type IconPickerProps = {
  /** Currently selected icon (name + color) — drives selected ring + grid tint. */
  value?: IconPickerValue | null
  /** Fires when an icon is committed (icon click, or color click while an icon is set). */
  onChange: (value: IconPickerValue) => void
  /**
   * Fires when the user explicitly clicks "Remove". Omit to hide the
   * Remove button entirely. Kept distinct from `onChange` so a color
   * click with no icon picked yet (a preview action) isn't confused
   * with an explicit removal.
   */
  onRemove?: () => void
  className?: string
}


const DEFAULT_COLOR = ICON_COLOR_PRESETS[0].value


/**
 * Notion-style icon picker: search bar over a scrollable list of category
 * sections, with a color strip footer. Intended to be mounted via React.lazy
 * from consumers so the curated icon set ships in its own chunk.
 *
 * The active color is local state. It seeds from `value.color` on mount
 * and propagates back through `onChange` only when an icon is actually
 * committed (icon click, or color click while an icon is already set).
 * That keeps "preview color while picking" separate from "save."
 */
export const IconPicker = ({ value, onChange, onRemove, className }: IconPickerProps) => {
  const [query, setQuery] = useState("")
  const [activeColor, setActiveColor] = useState<string | null>(value?.color ?? DEFAULT_COLOR)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const selectedName = value?.name ?? null

  const filtered = useMemo(
    () => filterPickerCategories(PICKER_CATEGORIES, query),
    [query],
  )

  const hasResults = filtered.some((category) => category.icons.length > 0)

  const handleIconClick = (name: string) => {
    onChange({ name, color: activeColor })
  }

  const handleColorClick = (color: string | null) => {
    setActiveColor(color)
    // Only propagate when an icon is already committed — otherwise this
    // is a preview-only adjustment that lives in local state until the
    // user picks an icon (which then carries the color out via onChange).
    if (selectedName !== null) {
      onChange({ name: selectedName, color })
    }
  }

  return (
    <div
      className={cn(
        "flex h-[460px] w-[360px] flex-col rounded-md border bg-popover text-popover-foreground shadow-md",
        className,
      )}
    >
      <div className="border-b p-2">
        <Input
          autoFocus
          placeholder="Search icons..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8"
        />
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
        {hasResults ? (
          filtered.map((category) =>
            category.icons.length === 0 ? null : (
              <CategorySection
                key={category.id}
                category={category}
                selectedName={selectedName}
                activeColor={activeColor}
                isDark={isDark}
                onSelect={handleIconClick}
              />
            ),
          )
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No icons match "{query}"
          </div>
        )}
      </div>

      <ColorStrip
        activeColor={activeColor}
        canRemove={selectedName !== null && onRemove !== undefined}
        isDark={isDark}
        onColorClick={handleColorClick}
        onRemove={onRemove ?? (() => {})}
      />
    </div>
  )
}


type CategorySectionProps = {
  category: PickerCategory
  selectedName: string | null
  activeColor: string | null
  isDark: boolean
  onSelect: (name: string) => void
}


const CategorySection = ({ category, selectedName, activeColor, isDark, onSelect }: CategorySectionProps) => {
  return (
    <section className="mb-3 last:mb-0">
      <h3 className="mb-1 px-1 text-xs font-medium text-muted-foreground">
        {category.label}
      </h3>
      <div className="grid grid-cols-8 gap-1">
        {category.icons.map((icon) => (
          <IconCell
            key={icon.name}
            icon={icon}
            isSelected={selectedName === icon.name}
            color={activeColor}
            isDark={isDark}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
}


type IconCellProps = {
  icon: PickerIconEntry
  isSelected: boolean
  color: string | null
  isDark: boolean
  onSelect: (name: string) => void
}


const IconCell = ({ icon, isSelected, color, isDark, onSelect }: IconCellProps) => {
  const Glyph = icon.component
  // Resolve through the same helper IconPropertyView uses so the picker
  // grid previews match the icon's final on-canvas appearance in dark
  // mode — without this the grid stayed in light-mode hex while the
  // saved icon rendered dark-adapted.
  const displayColor = resolveIconDisplayColor(color, isDark)

  return (
    <button
      type="button"
      title={icon.name}
      aria-label={icon.name}
      onClick={() => onSelect(icon.name)}
      style={{ color: displayColor }}
      className={cn(
        "flex aspect-square items-center justify-center rounded-md transition-colors hover:bg-accent",
        !color && "text-foreground",
        isSelected && "bg-accent ring-2 ring-ring",
      )}
    >
      <Glyph size={20} weight="regular" />
    </button>
  )
}


type ColorStripProps = {
  activeColor: string | null
  canRemove: boolean
  isDark: boolean
  onColorClick: (color: string | null) => void
  onRemove: () => void
}


const ColorStrip = ({ activeColor, canRemove, isDark, onColorClick, onRemove }: ColorStripProps) => {
  return (
    <div className="flex items-center gap-1 border-t p-2">
      <div className="flex flex-1 items-center gap-1">
        {ICON_COLOR_PRESETS.map((preset) => (
          <ColorChip
            key={preset.id}
            preset={preset}
            isActive={preset.value === activeColor}
            isDark={isDark}
            onClick={() => onColorClick(preset.value)}
          />
        ))}
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Remove
        </button>
      )}
    </div>
  )
}


type ColorChipProps = {
  preset: ColorPreset
  isActive: boolean
  isDark: boolean
  onClick: () => void
}


const ColorChip = ({ preset, isActive, isDark, onClick }: ColorChipProps) => {
  // Same resolver as the grid + the on-canvas IconPropertyView so the
  // chip swatch matches what the icon will actually look like once
  // committed. CSS-var presets (e.g. "Default") pass through unchanged.
  const displayColor = resolveIconDisplayColor(preset.value, isDark)

  return (
    <button
      type="button"
      title={preset.label}
      aria-label={preset.label}
      aria-pressed={isActive}
      onClick={onClick}
      style={{ backgroundColor: preset.value ? displayColor : undefined }}
      className={cn(
        "h-5 w-5 rounded-full border border-border transition-transform hover:scale-110",
        !preset.value && "bg-foreground",
        isActive && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
      )}
    />
  )
}
