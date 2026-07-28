import { describe, expect, it, vi } from "vitest"
import type { CodeClient } from "./services/clients"
import type { ToolContext } from "./types"
import { makeCodeInterpreterTool, managedCodeClient, resolveCodeClient, type CodePost } from "./code-interpreter"


const resp = (over: Partial<Awaited<ReturnType<CodePost>>> = {}) => ({
  status: "success" as const,
  stdout: "",
  stderr: "",
  duration_ms: 5,
  ...over,
})


describe("managedCodeClient", () => {
  it("maps a success result to ok:true (no error)", async () => {
    const post = vi.fn<CodePost>(async () => resp({ stdout: "42\n" }))
    const result = await managedCodeClient({ post }).run("print(6*7)", "python")
    expect(post).toHaveBeenCalledWith({ code: "print(6*7)", language: "python" })
    expect(result).toEqual({ ok: true, stdout: "42\n", stderr: "", error: undefined })
  })

  it("maps an error result to ok:false with the stderr as error", async () => {
    const post = vi.fn<CodePost>(async () => resp({ status: "error", stderr: "NameError: x" }))
    const result = await managedCodeClient({ post }).run("print(x)", "python")
    expect(result.ok).toBe(false)
    expect(result.error).toBe("NameError: x")
  })
})


describe("makeCodeInterpreterTool", () => {
  it("runs the client with the code + language", async () => {
    const run = vi.fn(async () => ({ ok: true, stdout: "ok" }))
    const client: CodeClient = { run }
    const out = await makeCodeInterpreterTool(client).run({ code: "1+1", language: "javascript" }, {} as ToolContext)
    expect(run).toHaveBeenCalledWith("1+1", "javascript")
    expect(out).toEqual({ ok: true, stdout: "ok" })
  })

  it("defaults language to python when omitted", async () => {
    const run = vi.fn(async () => ({ ok: true }))
    await makeCodeInterpreterTool({ run }).run({ code: "1+1" }, {} as ToolContext)
    expect(run).toHaveBeenCalledWith("1+1", "python")
  })

  it("rejects an unsupported language via schema validation", async () => {
    const run = vi.fn(async () => ({ ok: true }))
    const out = (await makeCodeInterpreterTool({ run }).run({ code: "x", language: "ruby" }, {} as ToolContext)) as { error?: string }
    expect(out.error).toBeDefined()
    expect(run).not.toHaveBeenCalled()
  })
})


describe("resolveCodeClient", () => {
  it("signed in → a managed client; signed out → null", () => {
    expect(resolveCodeClient({ signedIn: true })).not.toBeNull()
    expect(resolveCodeClient({ signedIn: false })).toBeNull()
  })
})
