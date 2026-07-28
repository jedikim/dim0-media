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
import { useEffect } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import camelcaseKeys from "camelcase-keys"
import { API_URL } from "@/config/api"
import { mintCollabTicket } from "@/features/board/api/collab-ticket"
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
): void => {
  const userEmail = useAppStore((s) => s.userEmail)
  const userId = useAppStore((s) => s.userId)

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
                mintTicket: async (id) => (await mintCollabTicket(id)).ticket,
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
