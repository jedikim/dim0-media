import React from "react"
import type { Components } from "react-markdown"
import "katex/dist/katex.min.css"
import "./markdown-view.css"
import { cn } from "@/lib/utils"
import { CustomTable } from "./custom-table"
import { Pre } from "./custom-pre"
import { MarkdownLink } from "./markdown-link"
import { Streamdown } from "streamdown"
import { codePlugin } from "./streamdown-code-plugin"
import { expandPageBlocks } from "./expand-page-blocks"
import { expandToggleBlocks } from "./expand-toggle-blocks"
import { expandTocBlocks } from "./expand-toc-blocks"
import { remarkHighlight } from "./remark-highlight"
import { remarkTag } from "./remark-tag"
import { sanitizeMathDelimiters } from "./sanitize-math"
import { useTheme } from "@/components/theme-provider"
import { type ShikiThemePair } from "@/components/theme-constants"
import type { BundledTheme } from "shiki"

import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeRaw from "rehype-raw"


const DISPLAY_MATH_RE = /\\\[([\s\S]+?)\\\]/g
const INLINE_MATH_RE = /\\\(([\s\S]+?)\\\)/g


/**
 * Rewrites LaTeX-style math delimiters into the `$$` form that remark-math parses.
 * Lets the model emit `\(...\)` and `\[...\]`, which do not collide with currency `$` in prose.
 * Single-dollar math is disabled on the renderer side, so both inline and block map to `$$...$$`;
 * remark-math treats same-line `$$...$$` as inline and own-line `$$...$$` as display.
 */
function normalizeMathDelimiters(src: string): string {
  // Cheap gate: skip both regex passes when the doc has no LaTeX delimiters.
  // Matters under streaming where this runs per chunk on every text body.
  if (!src.includes("\\(") && !src.includes("\\[")) return src
  return src
    .replace(DISPLAY_MATH_RE, (_, body) => `\n$$\n${body}\n$$\n`)
    .replace(INLINE_MATH_RE, (_, body) => `$$${body}$$`)
}

/** -------------------------------------------------------
 *  transparent scrollbars
 *  ------------------------------------------------------*/
let __mkScrollbarInjected = false
function ensureScrollbarStyleInjected() {
  if (__mkScrollbarInjected) return
  if (typeof document === "undefined") return

  const style = document.createElement("style")
  style.setAttribute("data-mk-scrollbars", "true")
  style.innerHTML = `
    .mk-scroll { scrollbar-width: thin; scrollbar-color: rgba(120,120,130,.5) transparent; }
    .mk-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
    .mk-scroll::-webkit-scrollbar-track { background: transparent; }
    .mk-scroll::-webkit-scrollbar-thumb { background: rgba(120,120,130,.5); border-radius: 9999px; }
    .mk-scroll::-webkit-scrollbar-thumb:hover { background: rgba(120,120,130,.7); }
  `
  document.head.appendChild(style)
  __mkScrollbarInjected = true
}

/** -------------------------------------------------------
 *  CustomLink — typed + small
 *  ------------------------------------------------------*/
const CustomLink = MarkdownLink

/** -------------------------------------------------------
 *  Typed wrappers for common elements
 *  ------------------------------------------------------*/
function H1(props: React.HTMLAttributes<HTMLHeadingElement>) {
  // Handwriting font for H1 — gives the canvas sheet preview a hand-drawn
  // "page title" feel that contrasts with the body text below.
  return <h1 className="mt-7 scroll-m-20 pb-2 text-2xl font-handwriting font-medium tracking-tight first:mt-0" {...props} />
}

function H2(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className="mt-6 scroll-m-20 text-xl font-medium tracking-tight" {...props} />
}

function H3(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className="mt-5 scroll-m-20 text-lg font-medium tracking-tight" {...props} />
}

function H4(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h4 className="mt-4 scroll-m-20 text-base font-medium tracking-tight" {...props} />
}

function P(props: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className="
        leading-7 text-base [&:not(:first-child)]:mt-4
        break-words whitespace-normal
        min-w-0
      "
      {...props}
    />
  )
}

function Blockquote(props: React.BlockquoteHTMLAttributes<HTMLElement>) {
  return <blockquote className="mt-4 border-l-2 pl-6 italic text-base" {...props} />
}

function Ul(props: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className="
        my-6 ml-6 list-disc [&>li]:mt-2
        break-words whitespace-normal
        min-w-0
      "
      {...props}
    />
  )
}

function Ol(props: React.HTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      className="
        my-6 ml-6 list-decimal [&>li]:mt-2
        break-words whitespace-normal
        min-w-0
      "
      {...props}
    />
  )
}

function Li(props: React.LiHTMLAttributes<HTMLLIElement>) {
  return <li className="break-words min-w-0" {...props} />
}

function Img(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      {...props}
      className={cn("max-w-full h-auto rounded-lg my-4", props.className)}
      style={{ ...(props.style || {}), height: "auto", maxWidth: "100%" }}
      alt={props.alt || ""}
    />
  )
}

function Tr(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className="m-0 border-t border-foreground/60 p-0 bg-transparent" {...props} />
}

function Th(props: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className="
        border-b border-foreground/60 px-4 py-2 text-left font-bold
        [&[align=center]]:text-center [&[align=right]]:text-right
        whitespace-nowrap
        bg-transparent
      "
      {...props}
    />
  )
}

function Td(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className="
        px-4 py-2 text-left
        [&[align=center]]:text-center [&[align=right]]:text-right
        align-top
        break-words
        bg-transparent
      "
      {...props}
    />
  )
}

function Thead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-transparent" {...props} />
}

function Tbody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="bg-transparent" {...props} />
}

function Hr(props: React.HTMLAttributes<HTMLHRElement>) {
  return <hr className="my-6 border-foreground/20 bg-muted/10" {...props} />
}

/** components map — fully typed and safe */
const components = {
  h1: H1,
  h2: H2,
  h3: H3,
  h4: H4,
  p: P,
  blockquote: Blockquote,
  ul: Ul,
  ol: Ol,
  li: Li,
  a: CustomLink,
  img: Img,
  table: CustomTable,
  tr: Tr,
  th: Th,
  td: Td,
  hr: Hr,
  thead: Thead,
  tbody: Tbody,
  b: (props: React.HTMLAttributes<HTMLElement>) => <b className="font-semibold" {...props} />,
  strong: (props: React.HTMLAttributes<HTMLElement>) => <strong className="font-semibold" {...props} />,
  em: (props: React.HTMLAttributes<HTMLElement>) => <em className="italic" {...props} />,
  del: (props: React.HTMLAttributes<HTMLElement>) => <del className="line-through" {...props} />,
  pre: Pre,
} satisfies Components


/**
 * Module-level constants so identity stays stable across renders. react-
 * markdown / Streamdown invalidate internal caches when these arrays change
 * reference — recreating them inline on every render is needlessly expensive,
 * especially under streaming (re-parse per chunk).
 */
const REMARK_PLUGINS = [
  remarkGfm,
  // singleDollarTextMath disabled: bare `$` stays literal (currency, prose).
  // Math must arrive as `\(...\)` / `\[...\]` and is normalized to `$$` above.
  [remarkMath, { singleDollarTextMath: false }],
  remarkHighlight,
  remarkTag,
] as const

const REHYPE_PLUGINS = [
  // rehype-raw expands the inline `<mark>` / `<span>` HTML produced by the
  // highlight + tag remark plugins, and the `<details>`/`<summary>` HTML
  // emitted by `expandToggleBlocks`. Must run before any rehype pass that
  // consumes those elements; rehype-katex is unaffected (it operates on
  // remark-math nodes).
  rehypeRaw,
  rehypeKatex,
] as const

const STREAMDOWN_PLUGINS_STATIC = { code: codePlugin } as const


/** Run the string-level preprocessors that translate non-CommonMark
 *  directives into something remark understands. Cheap early-exits guard
 *  each step so chunks without the relevant markers cost a single
 *  `String.includes` check. Order matters: `:::page` expands to inline
 *  links first so its block markers can't confuse the toggle matcher. */
function preprocess(content: string): string {
  let s = expandPageBlocks(content)
  s = expandToggleBlocks(s)
  s = expandTocBlocks(s)
  return normalizeMathDelimiters(sanitizeMathDelimiters(s))
}

/** -------------------------------------------------------
 * Renderer: GFM + math override + mermaid
 * ------------------------------------------------------*/
const Renderer: React.FC<{
  content: string
  isStreaming?: boolean
  shikiThemes: ShikiThemePair
}> = ({ content, isStreaming, shikiThemes }) => {
  const normalized = preprocess(content)

  return (
    <div>
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        components={components}
        shikiTheme={shikiThemes as [BundledTheme, BundledTheme]}
        remarkPlugins={REMARK_PLUGINS as never}
        rehypePlugins={REHYPE_PLUGINS as never}
        plugins={isStreaming ? undefined : STREAMDOWN_PLUGINS_STATIC}
      >
        {normalized}
      </Streamdown>
    </div>
  )
}


/**
 * MarkdownView Props
 */
export interface MarkdownViewProps {
  content: string
  isStreaming?: boolean
}


/**
 * MarkdownView
 *
 * A React component that renders markdown content with support for GFM, math, and custom styling.
 */
export const MarkdownView: React.FC<MarkdownViewProps> = React.memo(
  ({ content, isStreaming = false }) => {
    const { shikiThemes } = useTheme()

    React.useEffect(() => {
      ensureScrollbarStyleInjected()
    }, [])

    return (
      <div className="mk-content w-full min-w-0">
        <Renderer content={content} isStreaming={isStreaming} shikiThemes={shikiThemes} />
      </div>
    )
  },
  (prev, next) =>
    prev.content === next.content && prev.isStreaming === next.isStreaming
)
