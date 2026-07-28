import { describe, expect, it } from "vitest"
import { RUN_ID_HEADER, isOverQuotaError, runIdHeaders } from "./run"


describe("runIdHeaders", () => {
  it("carries the run id under the X-Run-Id header", () => {
    expect(runIdHeaders("run-1")).toEqual({ [RUN_ID_HEADER]: "run-1" })
    expect(RUN_ID_HEADER).toBe("X-Run-Id")
  })

  it("is empty when there's no run id (no header sent)", () => {
    expect(runIdHeaders()).toEqual({})
    expect(runIdHeaders("")).toEqual({})
  })
})


describe("isOverQuotaError", () => {
  it("detects a 429 from either transport's error message", () => {
    // apiFetch shape
    expect(isOverQuotaError(new Error("429 Too Many Requests - over quota"))).toBe(true)
    // stream shape
    expect(isOverQuotaError(new Error("/ai/llm/stream failed: 429"))).toBe(true)
    // non-Error values are coerced
    expect(isOverQuotaError("429")).toBe(true)
  })

  it("does not fire on other errors or incidental digits", () => {
    expect(isOverQuotaError(new Error("500 Internal Server Error"))).toBe(false)
    expect(isOverQuotaError(new Error("timed out after 4290ms"))).toBe(false)
    expect(isOverQuotaError(new Error("network error"))).toBe(false)
    expect(isOverQuotaError(undefined)).toBe(false)
  })
})
