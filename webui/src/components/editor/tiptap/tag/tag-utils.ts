/** Matches #key or #key:value — not inside words, not starting with a digit. */
export const TAG_RE = /#([a-zA-Z][a-zA-Z0-9_-]*)(?::([^\s#,]+))?/g


export interface TagGroup {
  key: string
  values: string[]
}


/** Scan raw markdown text and return deduplicated, grouped tags. */
export function scanTags(markdown: string): TagGroup[] {
  const groups = new Map<string, Set<string>>()
  const re = new RegExp(TAG_RE.source, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const key = m[1].toLowerCase()
    const value = m[2] ?? ""
    if (!groups.has(key)) groups.set(key, new Set())
    if (value) groups.get(key)!.add(value)
    else groups.get(key) // ensure key exists with empty set for plain #tag
  }
  return Array.from(groups.entries()).map(([key, values]) => ({
    key,
    values: Array.from(values),
  }))
}
