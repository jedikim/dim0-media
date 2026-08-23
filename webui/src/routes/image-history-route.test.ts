import { describe, expect, it } from "vitest"

import { clearTokens } from "@/features/signin/auth-storage"
import { router } from "./index"


describe("image history route", () => {
  it("is registered with the verified-auth guard", async () => {
    const route = router.routesByPath["/image-history"]
    expect(route).toBeDefined()
    expect(route.options.beforeLoad).toBeTypeOf("function")

    clearTokens()
    await expect(route.options.beforeLoad?.({} as never)).rejects.toMatchObject({
      options: expect.objectContaining({ to: "/signin" }),
    })
  })
})
