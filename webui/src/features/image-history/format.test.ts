import { describe, expect, it } from "vitest"

import { formatKnownCostUsd, imageHistoryUserLabel } from "./format"


describe("image history formatting", () => {
  it("distinguishes named and username-only creators", () => {
    expect(imageHistoryUserLabel({ uid: "a", username: "alice", name: "Alice" })).toBe("Alice · @alice")
    expect(imageHistoryUserLabel({ uid: "b", username: "bob", name: null })).toBe("@bob")
    expect(imageHistoryUserLabel({ uid: "c", username: "carol", name: "  " })).toBe("@carol")
  })


  it("keeps unreported, zero, small positive, and malformed costs distinct", () => {
    expect(formatKnownCostUsd(null)).toBe("Not reported")
    expect(formatKnownCostUsd("0")).toBe("$0.0000")
    expect(formatKnownCostUsd("0E-10")).toBe("$0.0000")
    expect(formatKnownCostUsd("0.0500000000")).toBe("$0.0500")
    expect(formatKnownCostUsd("0.00001")).toBe("$0.00001")
    expect(formatKnownCostUsd("12.34565")).toBe("$12.34565")
    expect(formatKnownCostUsd("1.23456E+1")).toBe("$12.3456")
    expect(formatKnownCostUsd("1E-3")).toBe("$0.0010")
    expect(formatKnownCostUsd("not-a-decimal")).toBe("Cost unavailable")
    expect(formatKnownCostUsd("1E+999")).toBe("Cost unavailable")
    expect(formatKnownCostUsd("1E-11")).toBe("Cost unavailable")
  })
})
