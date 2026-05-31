import { useTheme } from "@/components/theme-provider"
import type { TagGroup } from "./tag-utils"
import { getTagColor } from "./tag-color"


type Props = { tags: TagGroup[] }


/** Displays extracted #tag and #key:value tokens grouped by key, above the editor content. */
export function TagPanel({ tags }: Props) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  if (tags.length === 0) return null

  return (
    <div className="tag-panel">
      {tags.map(({ key, values }) => (
        <div key={key} className="tag-row">
          <span className="tag-row-key">{key}</span>
          <div className="tag-row-values">
            {values.map((v) => {
              const { background, foreground } = getTagColor(v, isDark)
              return (
                <span
                  key={v}
                  className="tag-chip"
                  style={{ backgroundColor: background, color: foreground, borderColor: background }}
                >
                  {v}
                </span>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
