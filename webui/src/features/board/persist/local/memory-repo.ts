/**
 * MemoryRepo — the agent's durable facts (board + global scope) over the
 * `StorageEngine` port (Phase 3 of the agent-context work).
 *
 * Writes are additive with `hash` dedup (no LLM mutation loop): an identical fact
 * is a no-op, and a write that would push a scope past its char cap is REJECTED
 * with the current entries returned, so the model can consolidate and retry in the
 * same turn. Deletes are soft (tombstones) so a removal can propagate under sync
 * (Phase 7); `list` hides tombstoned records.
 *
 * `bucket` (`board:<id>` | `global`) collapses (scope, boardId) into one indexed
 * string — global's null `boardId` can't ride a compound index, so the bucket is
 * the single lookup key for both scopes.
 */
import type { MemoryKind, MemoryRecord, MemoryScope } from "./idb"
import type { StorageEngine } from "./engine"


/** A single-key index range (inclusive both ends) — exact bucket lookup. */
const eq = (value: string) => ({ lower: value, upper: value })


/** Per-scope character budget (model-independent, Hermes-style). Tune later. */
export const BOARD_MEM_CHARS = 4000
export const GLOBAL_MEM_CHARS = 4000


/** The indexable bucket key for a (scope, boardId) pair. */
export const memoryBucket = (scope: MemoryScope, boardId: string | null): string =>
  scope === "board" ? `board:${boardId ?? ""}` : "global"


/** Normalize a fact body for hashing: trim, collapse inner whitespace, lowercase. */
const normalizeBody = (body: string): string => body.trim().replace(/\s+/g, " ").toLowerCase()


/** Deterministic 32-bit string hash (djb2) as hex — enough for dedup, no crypto. */
export const memoryHash = (body: string): string => {
  const s = normalizeBody(body)
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}


/** The char weight of a record toward its scope cap (the fact + its retrieval key). */
const recordChars = (r: MemoryRecord): number => r.title.length + r.summary.length + r.body.length


/** Sum the char weight of a set of records (the scope's used budget). */
const sumChars = (records: MemoryRecord[]): number => records.reduce((sum, r) => sum + recordChars(r), 0)


/** The per-scope char cap. */
const capFor = (scope: MemoryScope): number => (scope === "board" ? BOARD_MEM_CHARS : GLOBAL_MEM_CHARS)


export type AddResult = { ok: true; record: MemoryRecord } | { ok: false; reason: "over_cap"; entries: MemoryRecord[] }


export type UpdateResult = { ok: true } | { ok: false; reason: "over_cap"; entries: MemoryRecord[] } | { ok: false; reason: "not_found" }


export class MemoryRepo {
  private readonly engine: StorageEngine


  constructor(engine: StorageEngine) {
    this.engine = engine
  }


  /** Live (non-tombstoned) records for a scope, oldest first. */
  async list(scope: MemoryScope, boardId: string | null): Promise<MemoryRecord[]> {
    const all = await this.engine.list<MemoryRecord>("memories", { index: "by-bucket", range: eq(memoryBucket(scope, boardId)) })
    return all.filter((r) => !r.deleted).sort((a, b) => a.createdAt - b.createdAt)
  }


  /** One record by id (including tombstoned), or undefined — for ownership checks. */
  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.engine.get<MemoryRecord>("memories", id)
  }


  /** Total char weight of a scope's live records (capacity display + cap check). */
  async charCount(scope: MemoryScope, boardId: string | null): Promise<number> {
    return sumChars(await this.list(scope, boardId))
  }


  /**
   * Additively save a fact. An identical body (same hash) returns the existing
   * record unchanged. A write that would exceed the scope's char cap is rejected
   * with the current entries, so the caller consolidates and retries.
   */
  async add(input: {
    scope: MemoryScope
    boardId: string | null
    kind: MemoryKind
    title: string
    summary: string
    body: string
    id: string
    now: number
  }): Promise<AddResult> {
    const { scope, boardId } = input
    const entries = await this.list(scope, boardId)
    const hash = memoryHash(input.body)
    const existing = entries.find((r) => r.hash === hash)
    if (existing) return { ok: true, record: existing }

    const incoming = input.title.length + input.summary.length + input.body.length
    if (sumChars(entries) + incoming > capFor(scope)) return { ok: false, reason: "over_cap", entries }

    const record: MemoryRecord = {
      id: input.id,
      scope,
      boardId: scope === "board" ? boardId : null,
      bucket: memoryBucket(scope, boardId),
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      body: input.body,
      hash,
      createdAt: input.now,
      updatedAt: input.now,
      dirty: true,
      serverRev: null,
    }
    await this.engine.put("memories", record)
    return { ok: true, record }
  }


  /**
   * Patch a record's editable fields; re-hashes when the body changes. Enforces
   * the same per-scope char cap as `add` (a grow that would overflow is rejected
   * with the scope's entries), and reports `not_found` for an unknown/tombstoned
   * id so a caller never misreports a no-op as success.
   */
  async update(id: string, patch: Partial<Pick<MemoryRecord, "title" | "summary" | "body" | "kind">>, now: number): Promise<UpdateResult> {
    const current = await this.engine.get<MemoryRecord>("memories", id)
    if (!current || current.deleted) return { ok: false, reason: "not_found" }
    const body = patch.body ?? current.body
    // Apply only DEFINED patch fields — spreading `...patch` would clobber an
    // untouched field to undefined when the caller omits it (passes undefined).
    const next: MemoryRecord = {
      ...current,
      title: patch.title ?? current.title,
      summary: patch.summary ?? current.summary,
      kind: patch.kind ?? current.kind,
      body,
      hash: patch.body !== undefined ? memoryHash(body) : current.hash,
      updatedAt: now,
      dirty: true,
    }
    // Cap check against the scope's OTHER live records (this record is being
    // replaced), so an edit can't grow memory past the budget `add` guards.
    const others = (await this.list(current.scope, current.boardId)).filter((r) => r.id !== id)
    if (sumChars(others) + recordChars(next) > capFor(current.scope)) return { ok: false, reason: "over_cap", entries: [...others, current] }
    await this.engine.put("memories", next)
    return { ok: true }
  }


  /** Soft-delete: mark a tombstone so the removal survives a reload / propagates.
   *  Returns false for an unknown/already-tombstoned id (nothing changed). */
  async remove(id: string, now: number): Promise<boolean> {
    const current = await this.engine.get<MemoryRecord>("memories", id)
    if (!current || current.deleted) return false
    await this.engine.put("memories", { ...current, deleted: true, updatedAt: now, dirty: true })
    return true
  }
}
