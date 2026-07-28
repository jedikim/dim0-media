import { describe, expect, it } from "vitest"
import type { BoardMeta } from "@/features/board/model"
import type { BoardListItem } from "@/features/board/api/list-boards"
import { partitionBoards, selectOnDeviceBoards } from "./partition-boards"


const USER = "user-1"
const ROOT = "root" // the signed-out sentinel (see isSignedIn)


const local = (
  id: string,
  createdAt: number,
  kind: BoardMeta["kind"] = "local-only",
  ownerId?: string,
): BoardMeta => ({
  id,
  title: id,
  kind,
  ownerId,
  visibility: "private",
  createdAt,
  updatedAt: createdAt,
})


const synced = (uid: string, createdAt: string): BoardListItem => ({
  uid,
  type: "graph",
  readonly: false,
  visibility: "private",
  createdAt,
  role: "owner",
})


describe("partitionBoards", () => {
  it("puts local-only boards on-device when synced is undefined (signed out)", () => {
    const { onDevice, synced: syncedOut } = partitionBoards(
      [local("a", 1), local("b", 2)],
      undefined,
      ROOT,
    )
    expect(onDevice.map((b) => b.id)).toEqual(["b", "a"])
    expect(syncedOut).toEqual([])
  })

  it("dedupes: a board in both lists shows only under synced (keyed by id)", () => {
    const { onDevice, synced: syncedOut } = partitionBoards(
      [local("a", 1), local("shared", 2, "synced", USER)],
      [synced("shared", "2024-01-01T00:00:00Z")],
      USER,
    )
    expect(onDevice.map((b) => b.id)).toEqual(["a"])
    expect(syncedOut.map((b) => b.uid)).toEqual(["shared"])
  })

  it("sorts each group newest first (local by epoch ms, synced by ISO date)", () => {
    const { onDevice, synced: syncedOut } = partitionBoards(
      [local("old", 100), local("new", 200)],
      [synced("s-old", "2023-01-01T00:00:00Z"), synced("s-new", "2025-01-01T00:00:00Z")],
      USER,
    )
    expect(onDevice.map((b) => b.id)).toEqual(["new", "old"])
    expect(syncedOut.map((b) => b.uid)).toEqual(["s-new", "s-old"])
  })

  it("handles both empty", () => {
    expect(partitionBoards([], [], ROOT)).toEqual({ onDevice: [], synced: [] })
  })
})


describe("selectOnDeviceBoards", () => {
  it("hides a promoted (kind=synced) replica when signed out — no cross-session leak", () => {
    // Logout clears the remote list; the leftover synced replica belongs to a
    // user account and must NOT resurface under "on device".
    const onDevice = selectOnDeviceBoards(
      [local("a", 1), local("promoted", 2, "synced", USER)],
      undefined,
      ROOT,
    )
    expect(onDevice.map((b) => b.id)).toEqual(["a"])
  })

  it("keeps the owner's synced replica reachable offline (remote list empty)", () => {
    // Signed in but the backend list is empty/errored (offline): the owner's own
    // promoted board must stay visible via its local replica, not vanish.
    const onDevice = selectOnDeviceBoards(
      [local("mine", 1, "synced", USER)],
      undefined,
      USER,
    )
    expect(onDevice.map((b) => b.id)).toEqual(["mine"])
  })

  it("hides a synced replica owned by a different account", () => {
    // Same device, a different user signed in: a replica owned by someone else
    // must not show, even though we're signed in.
    const onDevice = selectOnDeviceBoards(
      [local("theirs", 1, "synced", "user-2")],
      undefined,
      USER,
    )
    expect(onDevice).toEqual([])
  })

  it("drops a board already in the synced list (kind flip not yet landed)", () => {
    // Backend adopted the board but the local kind flip hasn't committed; the
    // id/uid match keeps it off-device so it never shows twice.
    const onDevice = selectOnDeviceBoards(
      [local("pending", 1, "local-only")],
      [synced("pending", "2024-01-01T00:00:00Z")],
      USER,
    )
    expect(onDevice).toEqual([])
  })
})
