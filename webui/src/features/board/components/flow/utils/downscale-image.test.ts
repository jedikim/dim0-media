import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { downscaleImage } from "./downscale-image"


describe("downscaleImage", () => {
  const fillRect = vi.fn()
  const drawImage = vi.fn()


  beforeEach(() => {
    fillRect.mockReset()
    drawImage.mockReset()
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({
      width: 64,
      height: 32,
      close: vi.fn(),
    }))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect,
      drawImage,
    } as unknown as CanvasRenderingContext2D)
  })


  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })


  it("preserves WebP alpha and reports the actual encoded MIME", async () => {
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback, requestedType) => {
        expect(requestedType).toBe("image/webp")
        callback(new Blob(["encoded-webp"], { type: "image/webp" }))
      })

    const result = await downscaleImage(
      new File(["transparent"], "cutout.webp", { type: "image/webp" }),
    )

    expect(fillRect).not.toHaveBeenCalled()
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(toBlob).toHaveBeenCalledTimes(1)
    expect(result.mimeType).toBe("image/webp")
    expect(result.blob.type).toBe("image/webp")
  })


  it("uses a safe browser fallback MIME instead of the requested WebP type", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback) => {
        callback(new Blob(["fallback-png"], { type: "image/png" }))
      })

    const result = await downscaleImage(
      new File(["transparent"], "cutout.webp", { type: "image/webp" }),
    )

    expect(fillRect).not.toHaveBeenCalled()
    expect(result.mimeType).toBe("image/png")
  })


  it("keeps the existing white JPEG background behavior", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback, requestedType) => {
        expect(requestedType).toBe("image/jpeg")
        callback(new Blob(["encoded-jpeg"], { type: "image/jpeg" }))
      })

    const result = await downscaleImage(
      new File(["source"], "photo.jpg", { type: "image/jpeg" }),
    )

    expect(fillRect).toHaveBeenCalledWith(0, 0, 64, 32)
    expect(result.mimeType).toBe("image/jpeg")
  })
})
