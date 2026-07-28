import { describe, expect, it } from "vitest"
import { isSignedIn, LOGGED_OUT_USER_ID } from "./auth"


describe("isSignedIn", () => {
  it("treats the logged-out sentinel as NOT signed in (the whole point)", () => {
    expect(LOGGED_OUT_USER_ID).toBe("root")
    // Regression guard: "root" is truthy, so `!!userId` would wrongly say signed-in
    // and fire authed requests logged-out → 401 → forced sign-in.
    expect(isSignedIn("root")).toBe(false)
  })

  it("is false for empty / nullish", () => {
    expect(isSignedIn("")).toBe(false)
    expect(isSignedIn(null)).toBe(false)
    expect(isSignedIn(undefined)).toBe(false)
  })

  it("is true for a real account id", () => {
    expect(isSignedIn("user-123")).toBe(true)
  })
})
