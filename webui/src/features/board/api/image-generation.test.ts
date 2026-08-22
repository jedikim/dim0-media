import { beforeEach, describe, expect, it, vi } from "vitest"


const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock("@/api", () => ({ apiFetch }))

import {
  fetchImageAssetBlob,
  getImageGeneration,
  imageGenerationErrorMessage,
  listImageModels,
  startImageGeneration,
} from "./image-generation"


const model = {
  model_id: "model-1",
  display_name: "Model One",
  supports_text_to_image: true,
  supports_image_to_image: false,
  max_reference_images: 0,
  supported_resolutions: ["1K"],
  supported_aspect_ratios: ["1:1"],
  supported_qualities: null,
  max_output_images: 1,
  verified_at: "2026-08-21",
}


describe("image generation API client", () => {
  beforeEach(() => {
    apiFetch.mockReset()
  })


  it("serializes a T2I request with ordered empty references", async () => {
    apiFetch.mockResolvedValue({ generation_uid: "gen-1", status: "started" })

    await startImageGeneration({
      graphId: "board/one",
      clientRequestUid: "11111111-1111-4111-8111-111111111111",
      modelId: "model-1",
      prompt: "a blue bird",
      parameters: { aspect_ratio: "1:1", resolution: "1K" },
      generatorNodeUid: "node-1",
    })

    expect(apiFetch).toHaveBeenCalledWith(expect.objectContaining({
      path: "/boards/board%2Fone/image-generations",
      method: "POST",
      body: {
        client_request_uid: "11111111-1111-4111-8111-111111111111",
        model_id: "model-1",
        prompt: "a blue bird",
        parameters: { aspect_ratio: "1:1", resolution: "1K" },
        reference_asset_uids: [],
        generator_node_uid: "node-1",
      },
    }))
  })


  it("uses board-scoped encoded GET and authenticated blob routes", async () => {
    apiFetch.mockResolvedValue({})

    await getImageGeneration("board/one", "gen/two")
    await fetchImageAssetBlob("board/one", "asset/two")

    expect(apiFetch).toHaveBeenNthCalledWith(1, {
      path: "/boards/board%2Fone/image-generations/gen%2Ftwo",
      signal: undefined,
    })
    expect(apiFetch).toHaveBeenNthCalledWith(2, {
      path: "/boards/board%2Fone/image-assets/asset%2Ftwo/content",
      responseType: "blob",
      signal: undefined,
    })
  })


  it("caches a successful model catalog", async () => {
    apiFetch.mockResolvedValue({ models: [model] })

    const first = await listImageModels()
    const second = await listImageModels()

    expect(first).toEqual([model])
    expect(second).toBe(first)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })


  it("exposes only fixed safe error messages", () => {
    const rawSecret = "provider-body-with-secret"
    expect(imageGenerationErrorMessage(new Error(`503 Service Unavailable - ${rawSecret}`)))
      .toBe("이미지 생성 서비스가 일시적으로 중단되었습니다.")
    expect(imageGenerationErrorMessage(new Error(rawSecret))).not.toContain(rawSecret)
    expect(imageGenerationErrorMessage(new Error(`409 Conflict - ${rawSecret}`)))
      .toBe("요청 식별자가 다른 내용에 이미 사용되었습니다. 다시 생성해 주세요.")
  })
})


describe("failed model cache", () => {
  it("does not cache a rejected model request", async () => {
    vi.resetModules()
    apiFetch.mockReset()
    apiFetch
      .mockRejectedValueOnce(new Error("503 unavailable"))
      .mockResolvedValueOnce({ models: [model] })
    const fresh = await import("./image-generation")

    await expect(fresh.listImageModels()).rejects.toThrow("503")
    await expect(fresh.listImageModels()).resolves.toEqual([model])
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})
