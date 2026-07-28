/**
 * MiniAppRepo — per-note mini-app widget state over the `StorageEngine` port.
 *
 * The local analog of the backend's /mini-app-state endpoints. State is whatever
 * the widget JSON-serializes and is stored opaque (validated at the mini-app
 * boundary, not here). One row per note; no history in v1.
 */
import type { StorageEngine } from "@/features/board/persist/local/engine"


type MiniAppRow = { noteId: string; state: unknown }


export class MiniAppRepo {
  private readonly engine: StorageEngine


  constructor(engine: StorageEngine) {
    this.engine = engine
  }


  /** Fetch a note's saved state, or `undefined` when none exists. */
  async getState(noteId: string): Promise<unknown> {
    const row = await this.engine.get<MiniAppRow>("mini_app_state", noteId)
    return row?.state ?? undefined
  }


  /** Persist a note's state, overwriting any previous value. */
  async putState(noteId: string, state: unknown): Promise<void> {
    await this.engine.put<MiniAppRow>("mini_app_state", { noteId, state })
  }


  /** Remove a note's saved state. */
  async deleteState(noteId: string): Promise<void> {
    await this.engine.delete("mini_app_state", noteId)
  }
}
