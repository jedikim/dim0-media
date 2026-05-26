import type { Parent, Text, RootContent } from "mdast"


/**
 * Node types whose text descendants should not receive inline decorations
 * like highlight marks or tag chips. `link` covers autolinks where the
 * visible URL contains a `#fragment` we'd otherwise misread as a tag;
 * `linkReference` is the reference-style equivalent; `image` is included
 * as a safety net (it has no `children` field, so the recursion never
 * actually descends into one — listing it documents intent).
 */
const SKIP_TYPES = new Set<string>(["link", "linkReference", "image"])


/**
 * Walk every `text` node in a tree, skipping descents into link/image
 * containers. mdast `code` and `inlineCode` nodes don't expose their
 * payload as `text` children (they use a string `value`), so code spans
 * are naturally excluded — no extra check needed.
 */
export function visitTextNodes(
  parent: Parent,
  fn: (node: Text, index: number, parent: Parent) => void,
): void {
  const children = parent.children
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as RootContent
    if (child.type === "text") {
      fn(child, i, parent)
    } else if (SKIP_TYPES.has(child.type)) {
      continue
    } else if ("children" in child && Array.isArray((child as Parent).children)) {
      visitTextNodes(child as Parent, fn)
    }
  }
}
