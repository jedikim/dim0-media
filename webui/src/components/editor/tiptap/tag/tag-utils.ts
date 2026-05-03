/** Matches #key or #key:value — not inside words, not starting with a digit. */
export const TAG_RE = /#([a-zA-Z][a-zA-Z0-9_-]*)(?::([^\s#,]+))?/g


export interface TagGroup {
  key: string
  values: string[]
}


/** Bucket label for plain `#tag` entries (those without a `:value`). */
const PLAIN_TAGS_KEY = "tags"


/**
 * Scan raw markdown text and return deduplicated, grouped tags.
 * Plain `#tag` entries collapse under a single "tags" bucket; `#key:value`
 * entries group by their key. Both yield rows with values to render.
 */
export function scanTags(markdown: string): TagGroup[] {
  const groups = new Map<string, Set<string>>()
  const re = new RegExp(TAG_RE.source, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const name = m[1].toLowerCase()
    const value = m[2]
    if (value) {
      if (!groups.has(name)) groups.set(name, new Set())
      groups.get(name)!.add(value)
    } else {
      if (!groups.has(PLAIN_TAGS_KEY)) groups.set(PLAIN_TAGS_KEY, new Set())
      groups.get(PLAIN_TAGS_KEY)!.add(name)
    }
  }
  return Array.from(groups.entries()).map(([key, values]) => ({
    key,
    values: Array.from(values),
  }))
}
