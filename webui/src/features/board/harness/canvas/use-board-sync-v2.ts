/**
 * Mount the offline-first coordinator on a synced board (syncEngine=v2).
 *
 * The v2 sibling of `use-ws-collab`: instead of a thin adapter over a server-
 * authoritative graph, it runs a local IndexedDB replica (BoardPersistence) +
 * `attachBoardSync` over a real WebSocket, with reconnect supervision, snapshot
 * hydration, and inbound theme/geometry normalization. Enabled only when the
 * board is flagged v2 (see `sync-engine-flag`); otherwise a no-op so legacy
 * boards are completely untouched.
 *
 * Hydration reuses `applyGraphToStore` (one `origin:"remote"` batch → no echo).
 * The local replica gives the outbox its offline durability; the welcome
 * snapshot re-hydrates the base on each load (true offline-first load is a
 * follow-up).
 */
import { useEffect, useRef } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import camelcaseKeys from "camelcase-keys"
import { API_URL } from "@/config/api"
import { mintCollabTicket } from "@/features/board/api/collab-ticket"
import type { BoardRole } from "@/features/board/api/get-board"
import { getLocalStores } from "@/features/local-stores"
import { useAppStore } from "@/store"
import type { Graph } from "@/features/board/types/board"
import { buildLocalPresence } from "./presence-identity"
import { BoardPersistence } from "@/features/board/persist/local/board-persistence"
import { setBoardPersistenceRef } from "@/features/board/persist/local/board-persistence-ref"
import { normalizeInboundBatch } from "../sync/inbound-normalize"
import { enrichEdgeMidpoints } from "../sync/outbound-enrich"
import { dedupeRepeatUpdates } from "../sync/outbound-dedupe"
import { ReconnectSupervisor } from "../sync/reconnect-supervisor"
import { attachBoardSync } from "../sync/board-sync"
import type { BoardSyncHandle } from "../sync/board-sync"
import { createWebSocketRelay } from "../sync/ws-relay"
import { applyGraphToStore } from "../persist/snapshot-load"


const wsBaseFromApiUrl = (apiUrl: string): string => apiUrl.replace(/^http/i, "ws")


/** Wire a v2 synced board to the relay via the offline-first coordinator. */
export const useBoardSyncV2 = (
  store: CanvasStore,
  boardId: string | null,
  enabled: boolean,
  rootId: string | null,
  // Reports the caller's board role, resolved from the collab ticket at connect
  // time. The v2 hydrate path can't compute canEdit/role itself (it skips the
  // REST hydrate), so it defaults to read-only and upgrades via this callback.
  onRole?: (role: BoardRole) => void,
): void => {
  const userEmail = useAppStore((s) => s.userEmail)
  const userId = useAppStore((s) => s.userId)
  // Held in a ref so a fresh inline `onRole` each render never re-runs the mount
  // effect (which would tear down + rebuild the coordinator).
  const onRoleRef = useRef(onRole)
  onRoleRef.current = onRole

  useEffect(() => {
    if (!enabled || !boardId) return
    let cancelled = false
    let handle: BoardSyncHandle | null = null
    let supervisor: ReconnectSupervisor | null = null
    let persistence: BoardPersistence | null = null
    let detachPersist: (() => void) | null = null

    void getLocalStores()
      .then((stores) => {
        if (cancelled) return
        persistence = new BoardPersistence(boardId, { engine: stores.engine })
        setBoardPersistenceRef(persistence)
        return persistence.load().then(() => {
          if (cancelled || !persistence) return
          detachPersist = persistence.attach(store) // local replica: outbox + durable edits
          const clientId = store.clientId
          // Seed local presence identity (name + color). Cursor/selection are
          // filled in live by useLocalPresence; attachSync ships changes to peers.
          store.presence.setLocal(buildLocalPresence(userEmail, userId, clientId))
          const supe = new ReconnectSupervisor({ reconnect: () => handle?.reconnect() })
          supervisor = supe
          handle = attachBoardSync({
            store,
            persistence,
            engine: stores.engine,
            boardId,
            clientId,
            connect: (sinceSeq) => {
              supe.onConnecting()
              return createWebSocketRelay({
                boardId,
                clientId,
                sinceSeq,
                rootId: rootId ?? undefined,
                mintTicket: async (id) => {
                  const { ticket, role } = await mintCollabTicket(id)
                  // Ignore a mint that resolved after this board's effect was torn
                  // down (rapid board switch) — else a stale role would clobber the
                  // now-current board's state on the singleton store.
                  if (!cancelled) onRoleRef.current?.(role)
                  return ticket
                },
                wsUrl: (path) => `${wsBaseFromApiUrl(API_URL)}${path}`,
                onClose: (code) => supe.onClose(code),
              })
            },
            onWelcome: () => supe.onWelcome(),
            onSnapshot: (snapshot) => {
              // Server ships snake_case; the converters expect camelCase (same as
              // the REST path). Merge mode: never wipe on an empty/partial payload.
              const graph = camelcaseKeys(
                snapshot as Record<string, unknown>,
                { deep: true },
              ) as unknown as Graph
              applyGraphToStore(store, graph, { mode: "merge" })
            },
            normalizeRemote: (batch) => normalizeInboundBatch(batch, store),
            enrichOutbound: (batch) => enrichEdgeMidpoints(dedupeRepeatUpdates(batch), store),
            coalesceMs: 75, // merge a burst (e.g. rotate's per-tick ops) into one send
          })
        })
      })
      .catch((err) => {
        if (!cancelled) console.error("[sync-v2] mount failed", err)
      })

    const onVisibility = (): void => {
      if (document.visibilityState === "visible") supervisor?.retryNow()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibility)
      supervisor?.stop()
      handle?.detach()
      detachPersist?.()
      setBoardPersistenceRef(null)
      const p = persistence
      if (p) void p.flush().finally(() => p.close())
    }
  }, [store, boardId, enabled, rootId, userEmail, userId])
}
