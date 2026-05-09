import { useState, useEffect, useCallback, useRef, type RefObject } from "react"
import type { Editor } from "@tiptap/react"
import { cn } from "@/lib/utils"

// ── types ────────────────────────────────────────────────────────────────────

interface TocHeading {
  level: 1 | 2 | 3
  text: string
}

interface DocBlock {
  type: string
  level?: number
}

// ── hooks ────────────────────────────────────────────────────────────────────

function useTocData(editor: Editor) {
  const [headings, setHeadings] = useState<TocHeading[]>([])
  const [blocks, setBlocks] = useState<DocBlock[]>([])

  const update = useCallback(() => {
    const nextHeadings: TocHeading[] = []
    const nextBlocks: DocBlock[] = []

    editor.state.doc.forEach((node) => {
      if (node.type.name === "heading") {
        const level = node.attrs.level as 1 | 2 | 3
        nextHeadings.push({ level, text: node.textContent })
        nextBlocks.push({ type: "heading", level })
      } else {
        nextBlocks.push({ type: node.type.name })
      }
    })

    setHeadings(nextHeadings)
    setBlocks(nextBlocks)
  }, [editor])

  useEffect(() => {
    update()
    editor.on("update", update)
    return () => { editor.off("update", update) }
  }, [editor, update])

  return { headings, blocks }
}

function useActiveHeading(
  editor: Editor,
  headingCount: number,
  scrollRef: RefObject<HTMLDivElement | null>,
) {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!editor || !scrollEl || headingCount === 0) return

    const headingEls = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>("h1, h2, h3"),
    )
    if (!headingEls.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (!visible.length) return
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        )
        const idx = headingEls.indexOf(topmost.target as HTMLElement)
        if (idx !== -1) setActiveIndex(idx)
      },
      { root: scrollEl, threshold: 0, rootMargin: "0px 0px -70% 0px" },
    )

    headingEls.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [editor, headingCount, scrollRef])

  return activeIndex
}

// ── minimap line helpers ─────────────────────────────────────────────────────

function lineWidth(type: string, level?: number): string {
  if (type === "heading") {
    if (level === 1) return "88%"
    if (level === 2) return "62%"
    return "42%"
  }
  if (type === "codeBlock") return "78%"
  if (type === "blockquote") return "68%"
  if (type === "bulletList" || type === "orderedList" || type === "taskList")
    return "58%"
  if (type === "horizontalRule") return "84%"
  return "72%"
}

function lineHeight(type: string): string {
  if (type === "codeBlock") return "5px"
  if (type === "heading") return "3px"
  if (type === "horizontalRule") return "1px"
  return "2px"
}

function lineOpacity(type: string, level?: number): number {
  if (type === "heading") {
    if (level === 1) return 0.85
    if (level === 2) return 0.65
    return 0.5
  }
  if (type === "codeBlock" || type === "blockquote") return 0.38
  if (type === "horizontalRule") return 0.3
  return 0.22
}

// ── component ────────────────────────────────────────────────────────────────

interface Props {
  editor: Editor
  scrollRef: RefObject<HTMLDivElement | null>
}

export function TocPanel({ editor, scrollRef }: Props) {
  const [hovered, setHovered] = useState(false)
  const { headings, blocks } = useTocData(editor)
  const activeIndex = useActiveHeading(editor, headings.length, scrollRef)
  const headingButtonsRef = useRef<(HTMLButtonElement | null)[]>([])

  function scrollToHeading(index: number) {
    const els = editor.view.dom.querySelectorAll("h1, h2, h3")
    els[index]?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // Keep the active heading visible inside the scrollable panel — when the
  // panel opens or the active heading changes, scroll its row into view.
  useEffect(() => {
    if (!hovered) return
    headingButtonsRef.current[activeIndex]?.scrollIntoView({ block: "nearest" })
  }, [hovered, activeIndex])

  return (
    <div
      className="relative flex w-9 shrink-0 flex-col pt-5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── minimap ──────────────────────────────────────────── */}
      <div
        className="flex flex-col items-end gap-[4px] px-2 transition-opacity duration-150"
        style={{ opacity: hovered ? 0 : 1 }}
      >
        {blocks.map((block, i) => (
          <div
            key={i}
            className="rounded-full bg-muted-foreground"
            style={{
              width: lineWidth(block.type, block.level),
              height: lineHeight(block.type),
              opacity: lineOpacity(block.type, block.level),
            }}
          />
        ))}
      </div>

      {/* ── hover panel ──────────────────────────────────────── */}
      <div
        className={cn(
          "absolute right-0 top-0 z-20 flex w-52 max-h-[50vh] flex-col rounded-lg border border-border bg-card shadow-lg",
          "transition-all duration-150",
          hovered && headings.length > 0
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none translate-x-1 opacity-0",
        )}
      >
        <p className="shrink-0 px-3 pb-1 pt-2.5 font-sans text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          On this page
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin pb-2">
          {headings.map((h, i) => (
            <button
              key={i}
              ref={(el) => { headingButtonsRef.current[i] = el }}
              type="button"
              onClick={() => scrollToHeading(i)}
              className={cn(
                "w-full truncate rounded-md px-3 py-1 text-left font-sans text-xs transition-colors",
                h.level === 2 && "pl-5",
                h.level === 3 && "pl-7",
                i === activeIndex
                  ? "font-medium text-wiki-link"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {h.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
