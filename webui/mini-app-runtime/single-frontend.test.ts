import { describe, expect, it } from "vitest"
import { isSingleFrontend } from "./single-frontend"


describe("isSingleFrontend", () => {
  it("is true for an opaque sandbox origin even when a host origin is injected", () => {
    // The default container: docker-entrypoint injects a non-empty VITE_HOST_ORIGIN,
    // but the single-frontend iframe is opaque ("null") → must stay single-frontend
    // (the regression: the injected origin used to force strict-origin mode).
    expect(isSingleFrontend("http://localhost:3000", "null")).toBe(true)
  })

  it("is false in cross-origin mode (real runtime origin + configured host origin)", () => {
    expect(isSingleFrontend("https://host.example", "https://runtime.example")).toBe(false)
  })

  it("is true when no host origin is configured (same-origin dev)", () => {
    expect(isSingleFrontend(undefined, "http://localhost:5173")).toBe(true)
    expect(isSingleFrontend("", "http://localhost:5173")).toBe(true)
  })

  it("falls back to cross-origin when a host origin is set but no window origin is known", () => {
    expect(isSingleFrontend("https://host.example", undefined)).toBe(false)
  })
})
