import { beforeEach, describe, expect, it } from "vitest"
import type { CanvasStore, Node, NodeId } from "@canvas-harness/core"
import { resetIdb } from "@/test/canvas"
import { ScriptedLlm } from "@/test/llm"
import { BoardRegistry, newLocalBoard } from "@/features/board/persist/local/board-registry"
import { getLocalStores } from "@/features/local-stores"
import type { ChatMessage } from "@/features/agent/types/chat"
import { buildLabelInput, cleanTitle, describeBoardTitle, maybeAutoLabelBoard, maybeDeriveBoardPurpose } from "./describe-board"


const msg = (role: "user" | "assistant", text: string): ChatMessage => ({
  id: `${role}-${text}`,
  role,
  content: { markdown: text },
  chatUid: "c1",
  properties: {},
})


beforeEach(() => resetIdb())


describe("cleanTitle", () => {
  it("strips quotes, a stray JSON wrapper, and extra lines", () => {
    expect(cleanTitle('"Rice Cooking Notes"')).toBe("Rice Cooking Notes")
    expect(cleanTitle('{"title": "Napoleon Overview"}')).toBe("Napoleon Overview")
    expect(cleanTitle("First Line\nsecond")).toBe("First Line")
  })
})


describe("buildLabelInput", () => {
  it("condenses the opening user/assistant turns", () => {
    const out = buildLabelInput([msg("user", "how to cook rice"), msg("assistant", "boil water")])
    expect(out).toContain("user: how to cook rice")
    expect(out).toContain("assistant: boil water")
  })
  it("is empty when there's nothing to name from", () => {
    expect(buildLabelInput([])).toBe("")
  })
})


describe("describeBoardTitle", () => {
  it("returns the model's title", async () => {
    const llm = new ScriptedLlm([{ kind: "text", text: "Rice Cooking Notes" }])
    expect(await describeBoardTitle([msg("user", "cook rice"), msg("assistant", "...")], llm)).toBe("Rice Cooking Notes")
  })
  it("returns null with no transcript", async () => {
    const llm = new ScriptedLlm([{ kind: "text", text: "X" }])
    expect(await describeBoardTitle([], llm)).toBeNull()
  })
})


describe("maybeAutoLabelBoard", () => {
  const seedBoard = async (title: string): Promise<string> => {
    const reg = new BoardRegistry()
    await reg.init()
    const meta = newLocalBoard(title, 1000)
    await reg.createBoard(meta)
    reg.close()
    return meta.id
  }

  const titleOf = async (id: string): Promise<string | undefined> => {
    const reg = new BoardRegistry()
    await reg.init()
    const t = (await reg.getBoard(id))?.title
    reg.close()
    return t
  }

  it("renames a still-Untitled board from its transcript", async () => {
    const id = await seedBoard("Untitled board")
    const llm = new ScriptedLlm([{ kind: "text", text: "Rice Cooking Notes" }])
    await maybeAutoLabelBoard(id, [msg("user", "cook rice"), msg("assistant", "steps")], llm)
    expect(await titleOf(id)).toBe("Rice Cooking Notes")
  })

  it("leaves an already-named board untouched", async () => {
    const id = await seedBoard("My Project")
    const llm = new ScriptedLlm([{ kind: "text", text: "Something Else" }])
    await maybeAutoLabelBoard(id, [msg("user", "hi"), msg("assistant", "yo")], llm)
    expect(await titleOf(id)).toBe("My Project")
  })

  it("no-ops with a null client", async () => {
    const id = await seedBoard("Untitled board")
    await maybeAutoLabelBoard(id, [msg("user", "hi"), msg("assistant", "yo")], null)
    expect(await titleOf(id)).toBe("Untitled board")
  })
})


describe("maybeDeriveBoardPurpose", () => {
  const node = (id: string, label: string): Node =>
    ({ id: id as NodeId, type: "rect", x: 0, y: 0, w: 100, h: 100, angle: 0, z: 0, groups: [], content: "", data: { label: { markdown: label } } }) as unknown as Node

  const fakeStore = (nodes: Node[]): CanvasStore =>
    ({ getAllNodes: () => nodes, getSelection: () => [] as unknown as NodeId[] }) as unknown as CanvasStore

  const seed = async (title: string): Promise<string> => {
    const { boards } = await getLocalStores()
    const meta = newLocalBoard(title, 1000)
    await boards.createBoard(meta)
    return meta.id
  }


  it("derives + persists a purpose on a board that has none yet", async () => {
    const id = await seed("Trip board")
    const llm = new ScriptedLlm([{ kind: "text", text: "A board for planning a Japan trip." }])
    await maybeDeriveBoardPurpose(id, fakeStore([node("n1", "Tokyo"), node("n2", "Kyoto")]), null, llm)
    const meta = await (await getLocalStores()).boards.getBoard(id)
    expect(meta?.context).toBe("A board for planning a Japan trip.")
    expect(meta?.contextDerivedAt).toBeGreaterThan(0)
  })


  it("skips (no model call) when a fresh purpose hasn't drifted", async () => {
    const id = await seed("Trip board")
    const { boards } = await getLocalStores()
    await boards.setBoardContext(id, "existing purpose", { derivedAt: Date.now(), deriveSeq: 0 })
    const llm = new ScriptedLlm([{ kind: "text", text: "SHOULD NOT BE USED" }])
    await maybeDeriveBoardPurpose(id, fakeStore([node("n1", "x")]), null, llm)
    expect((await boards.getBoard(id))?.context).toBe("existing purpose")
  })


  it("no-ops with a null client", async () => {
    const id = await seed("Trip board")
    await maybeDeriveBoardPurpose(id, fakeStore([node("n1", "x")]), null, null)
    expect((await (await getLocalStores()).boards.getBoard(id))?.context).toBeUndefined()
  })
})
