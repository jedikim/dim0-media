import { useMemo } from "react"
import type { ReactNode } from "react"
import { useNavigate } from "@tanstack/react-router"
import { ThemedWelcome } from "@/features/agent/components/chat/welcome-message"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { CloudArrowUpIcon } from "@/components/icons"
import { useAppStore } from "@/store"
import { isSignedIn } from "@/lib/auth"
import { useListBoards } from "../api/list-boards"
import { BoardCard } from "../components/board-card"
import { LocalBoardCard, NewLocalBoardCard } from "../local/local-dashboard"
import { useLocalBoards } from "../local/use-local-boards"
import { useEnableSync } from "../local/use-enable-sync"
import { partitionBoards } from "./partition-boards"


/**
 * Unified board index: "On this device" (local-only replicas, no account) +
 * "Synced" (backend boards — backed up, multi-device, shareable). Signed-out
 * users see only the on-device group; signing in reveals the synced group. A
 * promoted board renders once, under Synced (partitionBoards dedupes by id).
 */
export function BoardsHome({
  className,
  hideTitle = false,
}: {
  className?: string
  hideTitle?: boolean
}) {
  const navigate = useNavigate()
  const userId = useAppStore((s) => s.userId)
  const { boards: localBoards, ready, createBoard, deleteBoard, renameBoard, refresh } =
    useLocalBoards()
  const { data: syncedBoards, isLoading } = useListBoards(userId)
  const { enableSync, pendingId } = useEnableSync()

  const { onDevice, synced } = useMemo(
    () => partitionBoards(localBoards, syncedBoards, userId),
    [localBoards, syncedBoards, userId],
  )

  const openLocal = (id: string): void => {
    void navigate({ to: "/local/$boardId", params: { boardId: id } })
  }

  const handleCreateLocal = async (): Promise<void> => {
    const meta = await createBoard("Untitled board")
    if (meta) openLocal(meta.id)
  }

  const signedIn = isSignedIn(userId)

  return (
    <div className={cn("w-full h-full", className)}>
      {!hideTitle && (
        <div className="pt-8 pb-4">
          <ThemedWelcome name="Dog" message="Note Boards" />
        </div>
      )}

      <div className="mx-auto max-w-5xl p-4 space-y-10">
        <Section
          title="On this device"
          hint="Private to this browser — no account needed"
          footer={
            ready && onDevice.length === 0
              ? "No local boards yet — create one above."
              : null
          }
        >
          <CardCell>
            <NewLocalBoardCard onClick={() => void handleCreateLocal()} />
          </CardCell>
          {onDevice.map((board) => (
            <CardCell key={board.id}>
              <LocalBoardCard
                board={board}
                onOpen={() => openLocal(board.id)}
                onDelete={() => void deleteBoard(board.id)}
                onRename={(title) => void renameBoard(board.id, title)}
                onEnableSync={() => {
                  void enableSync(board.id, board.title).then((r) => {
                    if (r.ok) void refresh()
                  })
                }}
                syncing={pendingId === board.id}
              />
            </CardCell>
          ))}
        </Section>

        <Section
          title="Synced"
          hint="Backed up, multi-device, shareable"
          footer={
            signedIn && !isLoading && synced.length === 0
              ? "No synced boards yet. Enable sync on a local board to back it up and share it."
              : signedIn && isLoading
                ? "Loading…"
                : null
          }
        >
          {signedIn ? (
            synced.map((board) => (
              <CardCell key={board.uid}>
                <BoardCard board={board} />
              </CardCell>
            ))
          ) : (
            // Signed-out: reveal the feature with a calm, ignorable CTA where the
            // boards would be — not a modal/nag. Local-first stays the default.
            <CardCell>
              <SyncedSignInCta onSignIn={() => void navigate({ to: "/signin" })} />
            </CardCell>
          )}
        </Section>
      </div>
    </div>
  )
}


/** A titled board group: header + hint + a responsive card grid + optional footer note. */
function Section({
  title,
  hint,
  footer,
  children,
}: {
  title: string
  hint?: string
  footer?: string | null
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div
        className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 place-items-center"
        role="list"
        aria-label={title}
      >
        {children}
      </div>
      {footer && (
        <div className="text-center mt-6 text-muted-foreground text-sm">
          {footer}
        </div>
      )}
    </section>
  )
}


/** Centering wrapper matching the existing dashboard card cells. */
function CardCell({ children }: { children: ReactNode }) {
  return (
    <div className="w-full h-full flex justify-center items-center">{children}</div>
  )
}


/**
 * Signed-out placeholder for the Synced group: a calm, value-first card inviting
 * sign-in to unlock sync/share. Deliberately non-blocking — it sits where boards
 * would, and ignoring it costs nothing (local-first stays the default).
 */
function SyncedSignInCta({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="w-64 h-60 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-6 text-center">
      <CloudArrowUpIcon className="size-8 text-muted-foreground" strokeWidth={2} />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Sync &amp; share your boards</p>
        <p className="text-xs text-muted-foreground">
          Sign in to back them up and open them on any device.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={onSignIn}>
        Sign in
      </Button>
    </div>
  )
}
