import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"


export interface DocHeading {
  level: 1 | 2 | 3
  text: string
  pos: number
}


/**
 * Walks the editor's doc and returns a live list of headings (h1–h3) with
 * their absolute positions. Stays in sync with the doc via `editor.on("update")`.
 */
export function useDocHeadings(editor: Editor): DocHeading[] {
  const [headings, setHeadings] = useState<DocHeading[]>([])

  const refresh = useCallback(() => {
    const list: DocHeading[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        const level = node.attrs.level as number
        if (level >= 1 && level <= 3) {
          list.push({
            level: level as 1 | 2 | 3,
            text: node.textContent,
            pos,
          })
        }
        return false
      }
      return true
    })
    setHeadings(list)
  }, [editor])

  useEffect(() => {
    refresh()
    editor.on("update", refresh)
    return () => {
      editor.off("update", refresh)
    }
  }, [editor, refresh])

  return headings
}
