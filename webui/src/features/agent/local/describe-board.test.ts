import { beforeEach, describe, expect, it } from "vitest"
import { resetIdb } from "@/test/canvas"
import { ScriptedLlm } from "@/test/llm"
import { BoardRegistry, newLocalBoard } from "@/features/board/persist/local/board-registry"
import type { ChatMessage } from "@/features/agent/types/chat"
import { buildLabelInput, cleanTitle, describeBoardTitle, maybeAutoLabelBoard } from "./describe-board"


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
