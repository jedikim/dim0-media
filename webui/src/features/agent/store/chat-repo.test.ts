import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { engineCases } from "@/test/engines"
import type { StorageEngine } from "@/features/board/persist/local/engine"
import type { ChatMessage } from "@/features/agent/types/chat"
import { ChatRepo } from "./chat-repo"


const msg = (id: string, text: string, chatUid = "c1"): ChatMessage => ({
  id,
  role: "assistant",
  content: { markdown: text },
  chatUid,
  properties: {},
})


// Run the full ChatRepo suite against every StorageEngine — proves it's engine-agnostic.
for (const { label, make } of engineCases) describe(`ChatRepo (${label})`, () => {
  let engine: StorageEngine
  let repo: ChatRepo


  beforeEach(async () => {
    engine = await make()
    repo = new ChatRepo(engine)
  })


  afterEach(() => {
    engine.close()
  })

  it("round-trips a transcript in conversation (insertion) order, not key order", async () => {
    // ids chosen so key order ("aaa" < "zzz") differs from insertion order.
    await repo.saveTranscript("c1", "b1", [msg("zzz", "first"), msg("aaa", "second")])
    expect((await repo.getMessages("c1")).map((m) => m.content.markdown)).toEqual(["first", "second"])
  })


  it("replaces a chat's transcript on re-save", async () => {
    await repo.saveTranscript("c1", "b1", [msg("m1", "a")])
    await repo.saveTranscript("c1", "b1", [msg("m1", "a"), msg("m2", "b")])
    expect(await repo.getMessages("c1")).toHaveLength(2)
  })


  it("keeps chats isolated from each other", async () => {
    await repo.saveTranscript("c1", "b1", [msg("m1", "hi")])
    await repo.saveTranscript("c2", "b1", [msg("m1", "yo", "c2"), msg("m2", "!", "c2")])
    expect(await repo.getMessages("c1")).toHaveLength(1)
    expect(await repo.getMessages("c2")).toHaveLength(2)
  })


  it("lists a board's chats most-recent first, scoped to the board", async () => {
    await repo.saveTranscript("c1", "b1", [msg("m1", "a")], "First", 100)
    await repo.saveTranscript("c2", "b1", [msg("m1", "b", "c2")], "Second", 300)
    await repo.saveTranscript("c3", "b2", [msg("m1", "c", "c3")], "Elsewhere", 200)

    const b1 = await repo.listByBoard("b1")
    expect(b1.map((c) => c.id)).toEqual(["c2", "c1"]) // 300 before 100
    expect((await repo.listByBoard("b2")).map((c) => c.label)).toEqual(["Elsewhere"])
  })


  it("preserves label and createdAt across a save that omits the label", async () => {
    await repo.saveTranscript("c1", "b1", [msg("m1", "a")], "Labeled", 100)
    await repo.saveTranscript("c1", "b1", [msg("m1", "a"), msg("m2", "b")], undefined, 200)

    const chat = await repo.getChat("c1")
    expect(chat?.label).toBe("Labeled")
    expect(chat?.createdAt).toBe(100)
    expect(chat?.updatedAt).toBe(200)
  })


  it("deleteChat removes the chat and its whole transcript", async () => {
    await repo.saveTranscript("c1", "b1", [msg("m1", "a"), msg("m2", "b")], "Doomed")
    await repo.saveTranscript("c2", "b1", [msg("m1", "keep", "c2")], "Survivor")

    await repo.deleteChat("c1")

    expect(await repo.getChat("c1")).toBeUndefined()
    expect(await repo.getMessages("c1")).toHaveLength(0)
    // The other chat is untouched.
    expect(await repo.getChat("c2")).toBeDefined()
    expect(await repo.getMessages("c2")).toHaveLength(1)
  })


  it("deleteMessage removes one message, leaving the rest", async () => {
    await repo.saveTranscript("c1", "b1", [msg("m1", "a"), msg("m2", "b"), msg("m3", "c")])
    await repo.deleteMessage("c1", "m2")
    expect((await repo.getMessages("c1")).map((m) => m.id)).toEqual(["m1", "m3"])
  })


  it("getChat returns undefined for an unknown chat", async () => {
    expect(await repo.getChat("ghost")).toBeUndefined()
  })
})
