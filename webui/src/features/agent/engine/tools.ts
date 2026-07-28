/**
 * The agent's tools (A4) — OURS, executed LOCALLY against the canvas store.
 *
 * Each tool is defined from a Zod parameter schema (`defineTool`): the schema
 * types the handler, validates the model's call at runtime, and becomes the JSON
 * Schema the LLM sees — one source of truth, no hand-written schema + coercion.
 * Each mutation is wrapped in `store.batch()` so an agent action is ONE undoable
 * batch (INV-8) and flows through the same persistence + search + sync pipeline
 * as a human edit. No server round-trips for these.
 */
import { z } from "zod"
import { asEdgeId, asNodeId } from "@canvas-harness/core"
import type { Node } from "@canvas-harness/core"
import type { DimEdgeData, DimNodeData } from "@/features/board/model"
import { pickRandomColorOfShade } from "@/features/board/lib/colors/tailwind"
import { AUTOFIT_DISABLED_TYPES } from "@/features/board/harness/convert/note-to-node"
import { beneathBorderOrigin } from "@/features/board/harness/agent/beneath-border"
import { validateMiniAppSource } from "@/features/mini-app/validate"
import { defineTool } from "./types"
import type { Tool } from "./types"
import { estimateNoteSize } from "./note-size"


/**
 * A random Tailwind-200 fill per note (mirrors the backend's
 * `random.choice(TAILWIND_200_ADAPTED)` in notes/service.py). Stored as
 * `_storedColors` so the harness theme hooks project the display style for the
 * current mode — without this, agent notes render with the lib's non-theme-aware
 * default (always light). Black text reads on every light-200 swatch; the dark
 * variant is derived on theme flip.
 */
const randomNoteColors = (): DimNodeData["_storedColors"] => ({
  backgroundColor: pickRandomColorOfShade(200)?.hex ?? "#dbeafe",
  strokeColor: "#00000000",
  textColor: "#000000",
})


// Default box size per canvas node type (mirrors backend get_default_note_size).
const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  rect: { w: 320, h: 180 },
  ellipse: { w: 320, h: 320 },
  diamond: { w: 340, h: 340 },
  sheet: { w: 440, h: 440 },
  "mini-app": { w: 720, h: 440 },
  widget: { w: 480, h: 320 },
  "code-sandbox": { w: 560, h: 360 },
}


/** Content-fit size for a note, falling back to the type's default box. */
const noteGeometry = (nodeType: string, content: string): { w: number; h: number } => {
  const base = DEFAULT_SIZE[nodeType] ?? { w: 320, h: 180 }
  const fitted = estimateNoteSize(nodeType, base.w, content)
  return fitted ? { w: fitted.width, h: fitted.height } : base
}


/** Fresh SyncMeta stamp for a created/updated entity. */
const meta = (): DimNodeData["meta"] => {
  const t = Date.now()
  return { v: 1, createdAt: t, updatedAt: t }
}


// Map a prompt-level note_type to a canvas node type. Shapes the agent can't
// render distinctly (ellipse/diamond) fall back to the default rectangle.
const NODE_TYPE: Record<string, string> = {
  rectangle: "rect",
  rect: "rect",
  sheet: "sheet",
  "mini-app": "mini-app",
  widget: "widget",
  "code-sandbox": "code-sandbox",
}
const toNodeType = (t: string): string => NODE_TYPE[t] ?? "rect"


export const createNote = defineTool({
  name: "create_note",
  description: "Create a note on the board with a title and optional body.",
  parameters: z.object({
    id: z.string().optional().describe("Optional explicit id; omit to auto-generate."),
    title: z.string().optional().describe("Short note title (the heading, stored separately from the body)."),
    body: z.string().optional().describe("The note body — prose or markdown."),
    x: z.number().optional().describe("Optional x canvas position; defaults beneath existing content (auto-arranged after the turn)."),
    y: z.number().optional().describe("Optional y canvas position; defaults beneath existing content (auto-arranged after the turn)."),
  }),
  run: async ({ id, title = "", body = "", x, y }, ctx) => {
    const nodeId = asNodeId(id || ctx.store.generateId())
    const { w, h } = noteGeometry("rect", body)
    // Default new notes beneath the current graph border (mirrors the backend's
    // compute_note_position); explicit coords from the model still win.
    const origin = beneathBorderOrigin(ctx.store)
    ctx.store.batch(() => {
      ctx.store.addNode({
        id: nodeId,
        type: "rect",
        x: x ?? origin.x,
        y: y ?? origin.y,
        w,
        h,
        angle: 0,
        groups: [],
        content: body,
        data: { label: title, parentId: ctx.rootId ?? undefined, meta: meta(), _storedColors: randomNoteColors() } satisfies DimNodeData,
      })
    })
    return { id: String(nodeId), created: true }
  },
})


export const updateNote = defineTool({
  name: "update_note",
  description: "Update a note's title and/or body.",
  parameters: z.object({
    id: z.string().describe("Id of the note to update."),
    title: z.string().optional().describe("New title; omit to leave unchanged."),
    body: z.string().optional().describe("New body; omit to leave unchanged."),
  }),
  run: async ({ id, title, body }, ctx) => {
    const nid = asNodeId(id)
    const node = ctx.store.getNode(nid)
    if (!node) return { error: "note not found" }

    const patch: Partial<Node> = {}
    if (typeof body === "string") patch.content = body
    if (typeof title === "string") {
      patch.data = { ...(node.data as DimNodeData | undefined), label: title, meta: meta() }
    }
    ctx.store.batch(() => ctx.store.updateNode(nid, patch))
    return { id: String(nid) }
  },
})


export const linkNotes = defineTool({
  name: "link_notes",
  description: "Create a directed link from one note to another.",
  parameters: z.object({
    sourceId: z.string().describe("Exact id of the note the arrow starts from."),
    targetId: z.string().describe("Exact id of the note the arrow points to."),
    label: z.string().optional().describe("Optional short label on the edge, e.g. 'yes', 'no', 'then', 'reads', 'causes'."),
  }),
  run: async ({ sourceId, targetId, label }, ctx) => {
    const id = asEdgeId(ctx.store.generateId())
    const src = asNodeId(sourceId)
    const tgt = asNodeId(targetId)
    // Attach at each node's CENTER (local frame is from top-left). canvas-harness
    // auto-clips the center→center line to each node's border, so the endpoint
    // lands at the border facing the peer — the backend's _edge_anchor_offset,
    // for free, and it re-clips live as `arrangeCreatedNodes` moves the nodes.
    const center = (nodeId: typeof src): { x: number; y: number } => {
      const node = ctx.store.getNode(nodeId)
      return node ? { x: node.w / 2, y: node.h / 2 } : { x: 0, y: 0 }
    }
    ctx.store.batch(() => {
      ctx.store.addEdge({
        id,
        source: { nodeId: src, localOffset: center(src) },
        target: { nodeId: tgt, localOffset: center(tgt) },
        pathStyle: "bezier",
        groups: [],
        data: { label: label || undefined, parentId: ctx.rootId ?? undefined, meta: meta() } satisfies DimEdgeData,
      })
    })
    return { id: String(id) }
  },
})


export const writeNote = defineTool({
  name: "write_note",
  description: "Create a new note, or fully rewrite an existing one when note_id is given. note_type: rectangle | sheet | mini-app | widget.",
  parameters: z.object({
    content: z.string().describe("The complete note body after this write — prose, markdown, code, or widget source."),
    label: z.string().optional().describe("Optional short title, stored separately from the body."),
    note_type: z.string().optional().describe("Visual note type: rectangle | sheet | mini-app | widget."),
    note_id: z.string().optional().describe("Existing note id to fully rewrite; omit to create a new note."),
  }),
  run: async ({ content, label, note_type, note_id }, ctx) => {
    const nodeType = toNodeType(note_type ?? "")

    // Custom types render only a preview of `content`, so disable the lib's
    // grow-to-fit AT CREATION (mirrors backend note_to_wire_node). Setting it
    // here — not just via the reactive stamp hook — means the node is born with
    // autoFit off and the lib never grows it before the flag lands.
    const autoFitStyle = AUTOFIT_DISABLED_TYPES.has(nodeType) ? { autoFit: false } : undefined

    // Validate a mini-app before persisting, so a malformed one is rejected with
    // line/col for the agent to fix this turn (not a silently-broken note).
    if (nodeType === "mini-app") {
      const v = validateMiniAppSource(content)
      if (!v.ok) {
        return { error: `mini-app invalid: ${v.message}${v.line ? ` (line ${v.line}:${v.column})` : ""}` }
      }
    }

    if (note_id) {
      const id = asNodeId(note_id)
      const node = ctx.store.getNode(id)
      if (node) {
        const prev = node.data as DimNodeData | undefined
        ctx.store.batch(() =>
          ctx.store.updateNode(id, {
            type: nodeType,
            content,
            data: { ...prev, label: label || prev?.label || "", meta: meta() },
            ...(autoFitStyle ? { style: { ...(node.style ?? {}), ...autoFitStyle } } : {}),
          }),
        )
        // Rewrote an existing (user-placed) note — NOT a creation, so the turn
        // must not re-arrange or recenter it.
        return { id: String(id), created: false }
      }
    }

    const id = asNodeId(note_id || ctx.store.generateId())
    const { w, h } = noteGeometry(nodeType, content)
    // Born beneath the current graph border (mirrors the backend's
    // compute_note_position); a multi-note turn is re-laid-out afterward.
    const origin = beneathBorderOrigin(ctx.store)
    ctx.store.batch(() => {
      ctx.store.addNode({
        id,
        type: nodeType,
        x: origin.x,
        y: origin.y,
        w,
        h,
        angle: 0,
        groups: [],
        content,
        ...(autoFitStyle ? { style: autoFitStyle } : {}),
        data: { label: label ?? "", parentId: ctx.rootId ?? undefined, meta: meta(), _storedColors: randomNoteColors() } satisfies DimNodeData,
      })
    })
    return { id: String(id), created: true }
  },
})


export const getNote = defineTool({
  name: "get_note",
  description: "Read an existing note's label, content, and type.",
  parameters: z.object({
    note_id: z.string().describe("Id of the note to read."),
  }),
  run: async ({ note_id }, ctx) => {
    const id = asNodeId(note_id)
    const node = ctx.store.getNode(id)
    if (!node) return { error: "note not found" }
    return {
      id: String(id),
      label: (node.data as DimNodeData | undefined)?.label ?? "",
      content: node.content ?? "",
      note_type: node.type,
    }
  },
})


export const editNote = defineTool({
  name: "edit_note",
  description: "Targeted edit: replace `old` with `new` in a note's content or label. Fails unless `old` is unique (or replace_all).",
  parameters: z.object({
    note_id: z.string().describe("Id of the note to edit."),
    field: z.enum(["content", "label"]).describe("Which field to edit."),
    old: z.string().describe("Exact substring to find; must be unique unless replace_all is set."),
    new: z.string().describe("Replacement text for `old`."),
    replace_all: z.boolean().optional().describe("When true, replace every occurrence of `old` instead of requiring uniqueness."),
  }),
  run: async ({ note_id, field, old, new: replacement, replace_all }, ctx) => {
    const id = asNodeId(note_id)
    const node = ctx.store.getNode(id)
    if (!node) return { error: "note not found" }

    const prev = node.data as DimNodeData | undefined
    const current = field === "label" ? prev?.label ?? "" : node.content ?? ""

    const occurrences = old ? current.split(old).length - 1 : 0
    if (occurrences === 0) return { error: "`old` not found in field" }
    if (occurrences > 1 && replace_all !== true) {
      return { error: "`old` occurs multiple times; expand it for uniqueness or set replace_all" }
    }
    const updated = replace_all === true ? current.split(old).join(replacement) : current.replace(old, replacement)

    ctx.store.batch(() =>
      field === "label"
        ? ctx.store.updateNode(id, { data: { ...prev, label: updated, meta: meta() } })
        : ctx.store.updateNode(id, { content: updated }),
    )
    return { id: String(id) }
  },
})


// Cap per-hit body + hit count so the tool payload stays lean (mirrors the old
// backend's 500-char / limit-5 shaping — here a touch higher on both).
const SEARCH_SNIPPET_CHARS = 600
const SEARCH_MAX_HITS = 8


/** Coerce to a plain string; a node's label/content is typed string but the store types data generically. */
const asText = (value: unknown): string => (typeof value === "string" ? value : "")


export const searchNotes = defineTool({
  name: "search_notes",
  description:
    "Full-text search the board's existing notes. Returns each match's id, title," +
    " and a content snippet — usually enough to answer without a separate get_note.",
  parameters: z.object({
    query: z.string().describe("Full-text query matched against note titles and bodies."),
  }),
  run: async ({ query }, ctx) => {
    if (!ctx.search) return { results: [] }
    const ids = (await ctx.search.query(query)).slice(0, SEARCH_MAX_HITS)
    const results = ids.map((id) => {
      const node = ctx.store.getNode(asNodeId(id))
      // Title is `data.label`; the body lives in the native `node.content`.
      const title = asText((node?.data as DimNodeData | undefined)?.label)
      const content = asText(node?.content).slice(0, SEARCH_SNIPPET_CHARS)
      return { id, title, content }
    })
    return { results }
  },
})


export const listBoards = defineTool({
  name: "list_boards",
  description: "List the user's boards.",
  parameters: z.object({}),
  run: async (_args, ctx) => {
    if (!ctx.registry) return { boards: [] }
    const boards = await ctx.registry.listBoards()
    return { boards: boards.map((b) => ({ id: b.id, title: b.title })) }
  },
})


export const localTools: Tool[] = [createNote, updateNote, linkNotes, searchNotes, listBoards]


/** The note-building tools the chat agent uses (matches the system prompt's vocabulary). */
export const agentBuildTools: Tool[] = [writeNote, editNote, getNote, linkNotes]
