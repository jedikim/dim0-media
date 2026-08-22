import { beforeEach, describe, expect, it, vi } from "vitest"


const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock("@/api", () => ({ apiFetch }))

import {
  fetchImageAssetBlob,
  ensureImageGenerationOutputNode,
  getImageGeneration,
  imageGenerationErrorDetail,
  imageGenerationErrorMessage,
  listImageModels,
  startImageGeneration,
  uploadImageAsset,
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


  it("sends only the recreate choice to the canonical output-node PUT", async () => {
    apiFetch.mockResolvedValue({
      generation_uid: "gen/two",
      output_node_uid: "a".repeat(32),
      output_asset_uid: "b".repeat(32),
      created: true,
      recreated: false,
    })

    await ensureImageGenerationOutputNode("board/one", "gen/two", true)

    expect(apiFetch).toHaveBeenCalledWith({
      path: "/boards/board%2Fone/image-generations/gen%2Ftwo/output-node",
      method: "PUT",
      body: { recreate: true },
      signal: undefined,
    })
  })


  it("uploads multipart bytes to the exact board asset collection", async () => {
    apiFetch.mockResolvedValue({ asset_uid: "a".repeat(32) })
    const blob = new Blob(["png"], { type: "image/png" })

    await uploadImageAsset("board/one", blob, "reference.png")

    expect(apiFetch).toHaveBeenCalledWith(expect.objectContaining({
      path: "/boards/board%2Fone/image-assets",
      method: "POST",
      headers: { Accept: "application/json" },
      body: expect.any(FormData),
    }))
    const body = apiFetch.mock.calls[0][0].body as FormData
    expect(body.get("file")).toBeInstanceOf(File)
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


  it("parses only a validated FastAPI detail dictionary", () => {
    const detail = { code: "reference_too_large", message: "Safe server message." }
    expect(imageGenerationErrorDetail(
      new Error(`413 Request Entity Too Large - ${JSON.stringify({ detail })}`),
    )).toEqual(detail)
    expect(imageGenerationErrorDetail(
      new Error('422 Unprocessable Entity - {"detail":"plain string"}'),
    )).toBeNull()
    expect(imageGenerationErrorDetail(new Error("422 Unprocessable Entity - {broken")))
      .toBeNull()
    expect(imageGenerationErrorDetail(new Error("422 Unprocessable Entity"))).toBeNull()
  })


  it("uses fixed copy for known codes and hides unknown server values", () => {
    const secret = "raw-provider-secret-value"
    const known = new Error(`413 Too Large - ${JSON.stringify({
      detail: { code: "reference_too_large", message: secret },
    })}`)
    const unknown = new Error(`422 Invalid - ${JSON.stringify({
      detail: { code: "future_provider_code", message: secret },
    })}`)

    expect(imageGenerationErrorMessage(known)).toBe(
      "참조 이미지 한 장의 파일 크기가 제한을 초과했습니다.",
    )
    expect(imageGenerationErrorMessage(known)).not.toContain(secret)
    expect(imageGenerationErrorDetail(unknown)?.code).toBe("future_provider_code")
    expect(imageGenerationErrorMessage(unknown)).toBe(
      "선택한 모델이 이 요청을 지원하지 않습니다.",
    )
    expect(imageGenerationErrorMessage(unknown)).not.toContain(secret)
  })


  it("maps canonical result-node errors without exposing server details", () => {
    const secret = "qdrant-internal-secret"
    const error = new Error(`409 Conflict - ${JSON.stringify({
      detail: { code: "canonical_collision", message: secret },
    })}`)

    expect(imageGenerationErrorMessage(error)).toBe(
      "결과 노드 식별자가 기존 보드 데이터와 충돌합니다.",
    )
    expect(imageGenerationErrorMessage(error)).not.toContain(secret)
  })


  it("maps a materialization race without exposing server details", () => {
    const secret = "qdrant-race-internal-secret"
    const error = new Error(`409 Conflict - ${JSON.stringify({
      detail: { code: "materialization_raced", message: secret },
    })}`)

    expect(imageGenerationErrorMessage(error)).toBe(
      "결과 노드 준비 중 보드가 변경되었습니다. 잠시 후 다시 시도해 주세요.",
    )
    expect(imageGenerationErrorMessage(error)).not.toContain(secret)
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
