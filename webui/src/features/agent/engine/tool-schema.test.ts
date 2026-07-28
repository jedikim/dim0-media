import { describe, expect, it } from "vitest"
import { z } from "zod"
import { freshStore } from "@/test/canvas"
import { runAgent } from "./agent-loop"
import { defineTool } from "./types"
import type { LlmClient, LlmMessage, LlmToolDef, LlmTurn, ToolContext } from "./types"
import { createNote, writeNote } from "./tools"


const noCtx = {} as ToolContext


type JsonSchema = {
  type?: string
  properties?: Record<string, { description?: string }>
  required?: string[]
  $schema?: string
}


/** Drain an async generator (we only care about side effects here). */
const drain = async (gen: AsyncGenerator<unknown>): Promise<void> => {
  for await (const ev of gen) void ev
}


describe("defineTool — runtime validation", () => {
  const echo = defineTool({
    name: "echo",
    description: "double a number",
    parameters: z.object({ n: z.number(), tag: z.string().optional() }),
    run: async ({ n }) => ({ doubled: n * 2 }),
  })


  it("runs with valid, typed args", async () => {
    expect(await echo.run({ n: 3 }, noCtx)).toEqual({ doubled: 6 })
  })


  it("returns a structured error (not a throw) on a wrong-typed arg", async () => {
    const out = (await echo.run({ n: "nope" }, noCtx)) as { error?: string }
    expect(out.error).toMatch(/invalid arguments/)
    expect(out.error).toContain("n")
  })


  it("returns an error on a missing required arg", async () => {
    const out = (await echo.run({}, noCtx)) as { error?: string }
    expect(out.error).toMatch(/invalid arguments/)
  })


  it("does not run the handler (no side effects) when args are invalid", async () => {
    // write_note requires `content`; an invalid call must not create a node.
    const store = freshStore("c")
    const out = (await writeNote.run({}, { store } as ToolContext)) as { error?: string }
    expect(out.error).toMatch(/invalid arguments/)
    expect(store.getAllNodes()).toHaveLength(0)
  })
})


// Captures the tool defs the loop actually sends to the model.
class CapturingLlm implements LlmClient {
  tools: LlmToolDef[] = []
  async complete(_messages: LlmMessage[], tools: LlmToolDef[]): Promise<LlmTurn> {
    this.tools = tools
    return { kind: "text", text: "done" }
  }
}


const defOf = (llm: CapturingLlm, name: string): LlmToolDef => {
  const def = llm.tools.find((t) => t.name === name)
  if (!def) throw new Error(`no tool def for ${name}`)
  return def
}


describe("tool schema on the wire (Zod → JSON Schema)", () => {
  it("carries per-arg descriptions and drops the $schema tag", async () => {
    const llm = new CapturingLlm()
    await drain(runAgent({ userMessage: "hi", tools: [createNote], llm, ctx: { store: freshStore("c") } }))

    const schema = defOf(llm, "create_note").parameters as JsonSchema
    expect(schema.type).toBe("object")
    expect(schema.$schema).toBeUndefined()
    expect(schema.properties?.title.description).toMatch(/title/i)
    expect(schema.properties?.body.description).toBeTruthy()
  })


  it("derives required vs optional (write_note.content is required, label is not)", async () => {
    const llm = new CapturingLlm()
    await drain(runAgent({ userMessage: "hi", tools: [writeNote], llm, ctx: { store: freshStore("c") } }))

    const schema = defOf(llm, "write_note").parameters as JsonSchema
    expect(schema.required).toContain("content")
    expect(schema.required ?? []).not.toContain("label")
  })
})
