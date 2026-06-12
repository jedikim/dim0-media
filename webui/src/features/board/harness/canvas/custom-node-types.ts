/**
 * canvas `node.type` values for Dim0's custom node defs (see
 * `node-types/`). These nodes own their editing surface — an expand
 * dialog, a side panel, or folder navigation — so a double-click must
 * NOT trigger the lib's inline text editor (`beginEdit`).
 *
 * Keep this in sync with the defs registered in
 * `node-types/index.ts → boardNodeTypes`; `custom-node-types.test.ts`
 * guards the parity. The matching style-memory exclusion lives in
 * `use-style-memory.ts → EXCLUDED_TYPES`.
 */
export const CUSTOM_NODE_TYPES: ReadonlySet<string> = new Set([
  "folder",
  "document",
  "sheet",
  "code-sandbox",
  "widget",
  "mini-app",
])
