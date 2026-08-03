import { afterEach, describe, expect, it, vi } from "vitest"
import { getEffectiveApiBase } from "./desktop-config"


afterEach(() => {
  vi.unstubAllEnvs()
})


describe("getEffectiveApiBase", () => {
  it("returns undefined when VITE_API_URL is unset", () => {
    vi.stubEnv("VITE_API_URL", "")
    expect(getEffectiveApiBase()).toBeUndefined()
  })

  it("returns the baked origin when set", () => {
    vi.stubEnv("VITE_API_URL", "https://vendor.example")
    expect(getEffectiveApiBase()).toBe("https://vendor.example")
  })

  it("normalizes to a bare origin (drops a path + trailing slash)", () => {
    vi.stubEnv("VITE_API_URL", "https://vendor.example/api/")
    expect(getEffectiveApiBase()).toBe("https://vendor.example")
  })

  it("fills a missing scheme with https for a public host (not origin 'null')", () => {
    vi.stubEnv("VITE_API_URL", "vendor.example")
    expect(getEffectiveApiBase()).toBe("https://vendor.example")
  })

  it("fills a missing scheme with http for localhost / LAN hosts", () => {
    vi.stubEnv("VITE_API_URL", "localhost:8888")
    expect(getEffectiveApiBase()).toBe("http://localhost:8888")
    vi.stubEnv("VITE_API_URL", "192.168.1.10:8888")
    expect(getEffectiveApiBase()).toBe("http://192.168.1.10:8888")
  })

  it("degrades to undefined on a malformed value (rather than an unusable base)", () => {
    vi.stubEnv("VITE_API_URL", "https://")
    expect(getEffectiveApiBase()).toBeUndefined()
  })

  it("trims surrounding whitespace", () => {
    vi.stubEnv("VITE_API_URL", "  https://vendor.example  ")
    expect(getEffectiveApiBase()).toBe("https://vendor.example")
  })
})
