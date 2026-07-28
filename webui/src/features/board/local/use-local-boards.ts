import { useCallback, useEffect, useRef, useState } from "react"
import { create } from "zustand"
import type { BoardMeta } from "@/features/board/model"
import { newLocalBoard } from "@/features/board/persist/local/board-registry"
import type { BoardRegistry } from "@/features/board/persist/local/board-registry"
import { requestPersistentStorage } from "@/features/board/persist/local/persist-storage"
import { getLocalStores } from "@/features/local-stores"


/**
 * Shared revision counter, bumped on every local-board mutation. Each
 * `useLocalBoards` instance subscribes and re-reads on change, so a create /
 * delete / rename from one mount (e.g. the top-left header) is reflected in the
 * others (sidebar LOCAL list, dashboard cards) without a remount — the registry
 * itself has no change notification, and the instances hold independent state.
 */
const useLocalBoardsRevision = create<{ rev: number; bump: () => void }>((set) => ({
  rev: 0,
  bump: () => set((s) => ({ rev: s.rev + 1 })),
}))


/** List/create/delete/rename local-only boards via the shared BoardRegistry — offline, no account. */
export function useLocalBoards() {
  const [boards, setBoards] = useState<BoardMeta[]>([])
  const [ready, setReady] = useState(false)
  const registryRef = useRef<BoardRegistry | null>(null)
  const rev = useLocalBoardsRevision((s) => s.rev)
  const bump = useLocalBoardsRevision((s) => s.bump)

  useEffect(() => {
    void requestPersistentStorage()
    let cancelled = false
    void getLocalStores().then((stores) => {
      if (cancelled) return
      registryRef.current = stores.boards
      return stores.boards.listBoards().then((list) => {
        if (!cancelled) {
          setBoards(list)
          setReady(true)
        }
      })
    })
    // The engine is app-wide (owned by the composition root) — don't close it here.
    return () => {
      cancelled = true
      registryRef.current = null
    }
  }, [])

  // Re-read whenever any instance mutates (shared revision bump). No-op on the
  // first render (rev 0) — the registry isn't open yet; the mount effect loads.
  useEffect(() => {
    const registry = registryRef.current
    if (registry) void registry.listBoards().then(setBoards)
  }, [rev])

  const refresh = useCallback(async () => {
    const registry = registryRef.current
    if (registry) setBoards(await registry.listBoards())
  }, [])

  const createBoard = useCallback(
    async (title: string): Promise<BoardMeta | null> => {
      const registry = registryRef.current
      if (!registry) return null
      const meta = newLocalBoard(title.trim() || "Untitled board", Date.now())
      await registry.createBoard(meta)
      bump()
      return meta
    },
    [bump],
  )

  const deleteBoard = useCallback(
    async (id: string): Promise<void> => {
      const registry = registryRef.current
      if (!registry) return
      await registry.deleteBoard(id)
      bump()
    },
    [bump],
  )

  const renameBoard = useCallback(
    async (id: string, title: string): Promise<void> => {
      const registry = registryRef.current
      if (!registry) return
      await registry.renameBoard(id, title.trim() || "Untitled board")
      bump()
    },
    [bump],
  )

  return { boards, ready, createBoard, deleteBoard, renameBoard, refresh }
}
