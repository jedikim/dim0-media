import React from "react"
import { useNavigate } from "@tanstack/react-router"
import { LinkIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import { PageRefChip } from "./page-ref-chip"

const boardLinkRe = /^\/boards\/([^/]+)\/([^/]+)\/([^/]+)$/
const PAGE_HREF_PREFIX = "page://"

type MarkdownLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  children?: React.ReactNode
}

/**
 * Pull a usable string title out of the children React node tree.
 * Markdown links can wrap their text in formatting (em, strong); we
 * just want the visible label for the page-ref chip.
 */
const textOf = (node: React.ReactNode): string => {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }
    return textOf(props.children)
  }
  return ""
}

/**
 * Markdown link renderer that routes internal board URLs through the router.
 * `page://<id>` URLs render as a PageRefChip (TipTap interop — see
 * `editor/tiptap/page/page-ref-extension.ts`). External links keep
 * default browser behavior.
 */
export function MarkdownLink({ children, href, ...rest }: MarkdownLinkProps) {
  const navigate = useNavigate()

  // Page-ref short-circuit: don't render an <a> at all. The chip
  // carries the title from the markdown's link text and behaves as a
  // self-contained inline element. v1 has no click target — adding
  // navigate() requires a host PageProvider that knows where pages live.
  if (href?.startsWith(PAGE_HREF_PREFIX)) {
    const title = textOf(children).trim() || "Untitled"
    return <PageRefChip title={title} />
  }

  const content = Array.isArray(children) ? children[0] : children
  const label = typeof content === "string" ? content.replace(/^[[]|[\]]$/g, "") : "source"

  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!href) return
    const match = href.match(boardLinkRe)
    if (!match) return

    event.preventDefault()
    const [, boardId, , targetId] = match
    navigate({
      to: "/boards/$id",
      params: { id: boardId },
      search: (prev: Record<string, unknown>) => ({ ...prev, center_around: targetId }),
    })
  }

  const isExternal = !!href && /^(https?:)?\/\//.test(href)
  const target = isExternal ? "_blank" : rest.target
  const rel = isExternal ? "noreferrer" : rest.rel

  const clName = cn(
    "transition-all inline-block leading-none align-text-bottom text-muted-foreground/70 hover:text-muted-foreground text-xs font-mono bg-card hover:bg-accent rounded-lg",
    isExternal ? "border border-border px-1 py-0.5" : "p-1",
  )

  return (
    <a
      href={href}
      target={target}
      rel={rel}
      className={clName}
      onClick={onClick}
      {...rest}
    >
      {
        isExternal ? label :
        <LinkIcon className='size-3' strokeWidth={2} />
      }
    </a>
  )
}
