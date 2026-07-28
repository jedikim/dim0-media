import { beforeEach, describe, expect, it } from "vitest"
import { useByokStore } from "./byok-store"


// The store is a module singleton; reset to defaults before each test.
const reset = () => {
  useByokStore.setState({
    provider: "openrouter",
    llm: {},
    configured: false,
    searchEngine: "perplexity",
    search: {},
    codeKey: "",
  })
  localStorage.clear()
}


describe("byok-store — per-provider model keys", () => {
  beforeEach(reset)

  it("keeps each provider's key; setting one doesn't wipe the other", () => {
    const s = useByokStore.getState()
    s.setLlm({ provider: "openrouter", apiKey: "sk-or", model: "" })
    s.setLlm({ provider: "openai", apiKey: "sk-oa", model: "gpt-5.4" })

    const st = useByokStore.getState()
    expect(st.llm.openrouter?.apiKey).toBe("sk-or")
    expect(st.llm.openai?.apiKey).toBe("sk-oa")
    // active provider is the last set → asConfig reflects it
    expect(st.asConfig()).toEqual({ provider: "openai", apiKey: "sk-oa", model: "gpt-5.4" })
  })

  it("switching the active provider surfaces that provider's saved key", () => {
    const s = useByokStore.getState()
    s.setLlm({ provider: "openrouter", apiKey: "sk-or", model: "" })
    s.setLlm({ provider: "openai", apiKey: "sk-oa", model: "" })

    useByokStore.getState().setProvider("openrouter")
    expect(useByokStore.getState().asConfig()?.apiKey).toBe("sk-or")
    expect(useByokStore.getState().configured).toBe(true)
  })

  it("configured tracks the ACTIVE provider's key", () => {
    useByokStore.getState().setLlm({ provider: "openai", apiKey: "sk-oa", model: "" })
    expect(useByokStore.getState().configured).toBe(true)
    useByokStore.getState().setProvider("openrouter") // no key yet
    expect(useByokStore.getState().configured).toBe(false)
  })

  it("persists keys to localStorage by default (survives reload) until cleared", () => {
    useByokStore.getState().setLlm({ provider: "openai", apiKey: "sk-oa", model: "m" })
    useByokStore.getState().setSearchKey("exa", "exa-k")
    // Written to storage without any opt-in.
    expect(localStorage.getItem("dim0.byok")).toContain("sk-oa")
    expect(localStorage.getItem("dim0.byok")).toContain("exa-k")
    // Forget wipes both the state and the stored copy.
    useByokStore.getState().clear()
    expect(localStorage.getItem("dim0.byok")).toBeNull()
    expect(useByokStore.getState().asConfig()).toBeNull()
  })
})


describe("byok-store — per-engine search keys (the tavily→linkup bug)", () => {
  beforeEach(reset)

  it("keeps each engine's key; keying a second engine doesn't wipe the first", () => {
    const s = useByokStore.getState()
    s.setSearchKey("tavily", "tvly-1")
    s.setSearchKey("linkup", "lk-1") // active becomes linkup

    const st = useByokStore.getState()
    expect(st.search.tavily).toBe("tvly-1") // still there
    expect(st.search.linkup).toBe("lk-1")
  })

  it("selecting an engine never clears keys; searchByok follows the active engine", () => {
    const s = useByokStore.getState()
    s.setSearchKey("tavily", "tvly-1")
    s.setSearchKey("linkup", "lk-1")

    useByokStore.getState().setSearchEngine("tavily")
    expect(useByokStore.getState().searchByok()).toEqual({ engine: "tavily", apiKey: "tvly-1" })

    // switch to an unkeyed engine → no byok credential, but keys survive
    useByokStore.getState().setSearchEngine("perplexity")
    expect(useByokStore.getState().searchByok()).toBeNull()
    expect(useByokStore.getState().search.tavily).toBe("tvly-1")
    expect(useByokStore.getState().search.linkup).toBe("lk-1")
  })
})
