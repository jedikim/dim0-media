import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "@/features/agent/types/chat"
import type { ServerTranscript } from "@/features/agent/api/chat-transcript"


const listChatTranscripts = vi.fn<(boardId: string) => Promise<ServerTranscript[]>>()


const loadMessages = vi.fn<(chatUid: string) => Promise<ChatMessage[]>>()


const saveMessages =
  vi.fn<
    (chatUid: string, boardId: string, messages: ChatMessage[], label?: string, updatedAt?: number) => Promise<void>
  >()


vi.mock("@/features/agent/api/chat-transcript", () => ({
  listChatTranscripts: (boardId: string) => listChatTranscripts(boardId),
}))
vi.mock("@/features/agent/store/chat-persist", () => ({
  loadMessages: (chatUid: string) => loadMessages(chatUid),
  saveMessages: (chatUid: string, boardId: string, messages: ChatMessage[], label?: string, updatedAt?: number) =>
    saveMessages(chatUid, boardId, messages, label, updatedAt),
}))

const { seedTranscriptsFromServer } = await import("./seed-transcripts")


const msg = (id: string): ChatMessage => ({ id, role: "user", content: { markdown: id }, chatUid: "c1", properties: {} })


describe("seedTranscriptsFromServer", () => {
  beforeEach(() => {
    listChatTranscripts.mockReset()
    loadMessages.mockReset()
    saveMessages.mockReset()
  })

  it("writes a server transcript into the local store, preserving its recency stamp", async () => {
    listChatTranscripts.mockResolvedValue([
      { chatUid: "c1", label: "Chat 1", transcript: [msg("a"), msg("b")], updatedAt: "2026-07-20T10:00:00Z" },
    ])
    loadMessages.mockResolvedValue([]) // nothing local yet (fresh device)

    await seedTranscriptsFromServer("board-1")

    // The server's updatedAt is threaded through so openBoard doesn't reorder seeded chats.
    expect(saveMessages).toHaveBeenCalledWith(
      "c1",
      "board-1",
      [msg("a"), msg("b")],
      "Chat 1",
      Date.parse("2026-07-20T10:00:00Z"),
    )
  })

  it("never clobbers a chat that already exists locally", async () => {
    listChatTranscripts.mockResolvedValue([
      { chatUid: "c1", label: "server", transcript: [msg("old")] },
    ])
    loadMessages.mockResolvedValue([msg("local-newer")]) // local copy present

    await seedTranscriptsFromServer("board-1")

    expect(saveMessages).not.toHaveBeenCalled()
  })

  it("skips empty server transcripts", async () => {
    listChatTranscripts.mockResolvedValue([{ chatUid: "c1", transcript: [] }])

    await seedTranscriptsFromServer("board-1")

    expect(loadMessages).not.toHaveBeenCalled()
    expect(saveMessages).not.toHaveBeenCalled()
  })

  it("swallows network/auth failures (seeding is best-effort)", async () => {
    listChatTranscripts.mockRejectedValue(new Error("401"))

    await expect(seedTranscriptsFromServer("board-1")).resolves.toBeUndefined()
    expect(saveMessages).not.toHaveBeenCalled()
  })
})
