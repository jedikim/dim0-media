import { beforeEach, describe, expect, it, vi } from "vitest"
import { asNodeId, createCanvasStore, type CanvasStore } from "@canvas-harness/core"

import {
  ImageReferenceResolutionError,
  resolveReferenceAssetUids,
} from "./image-reference-resolution"
import {
  IMAGE_REFERENCE_CHANGED_MESSAGE,
  IMAGE_REFERENCE_INVALID_RESPONSE_MESSAGE,
  IMAGE_REFERENCE_UNAVAILABLE_MESSAGE,
} from "./image-reference-assets"


const { getImageGeneration, startImageGeneration } = vi.hoisted(() => ({
  getImageGeneration: vi.fn(),
  startImageGeneration: vi.fn(),
}))


vi.mock("@/features/board/api/image-generation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/board/api/image-generation")>(),
  getImageGeneration,
  startImageGeneration,
}))


const BOARD_ID = "board-1"
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo="
const OTHER_PNG_DATA_URL = "data:image/png;base64,c2FmZQ=="
const assetUid = (value: string): string => value.repeat(32).slice(0, 32)


const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}


const addImage = (
  store: CanvasStore,
  id: string,
  { existing, src = PNG_DATA_URL }: { existing?: string; src?: string } = {},
): void => {
  store.addNode({
    id: asNodeId(id),
    type: "image",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    angle: 0,
    z: 0,
    groups: [],
    data: {
      graphUid: BOARD_ID,
      src,
      properties: existing
        ? { imageAssetUid: { type: "keyword", value: existing } }
        : {},
    },
  })
}


const addGenerator = (store: CanvasStore, id: string, generationUid: string): void => {
  store.addNode({
    id: asNodeId(id),
    type: "image-generator",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    angle: 0,
    z: 0,
    groups: [],
    data: {
      graphUid: BOARD_ID,
      properties: {
        activeGenerationUid: { type: "keyword", value: generationUid },
      },
    },
  })
}


const uploaded = (uid: string) => ({
  asset_uid: uid,
  mime_type: "image/png" as const,
  width: 1,
  height: 1,
  byte_size: 8,
  content_sha256: "f".repeat(64),
})


const setGeneratorGeneration = (store: CanvasStore, id: string, generationUid: string): void => {
  const data = store.getNode(asNodeId(id))?.data as {
    properties: { activeGenerationUid: { type: "keyword"; value: string } }
  }
  data.properties.activeGenerationUid = { type: "keyword", value: generationUid }
}


const setImageSource = (store: CanvasStore, id: string, src: string): void => {
  const data = store.getNode(asNodeId(id))?.data as { src: string }
  data.src = src
}


const setImageAsset = (store: CanvasStore, id: string, uid: string): void => {
  const data = store.getNode(asNodeId(id))?.data as {
    properties: { imageAssetUid?: { type: "keyword"; value: string } }
  }
  data.properties.imageAssetUid = { type: "keyword", value: uid }
}


describe("ordered image reference resolution", () => {
  beforeEach(() => {
    getImageGeneration.mockReset()
    startImageGeneration.mockReset()
  })


  it("preserves three-source order and allows repeated asset UIDs", async () => {
    const store = createCanvasStore()
    const shared = assetUid("a")
    addImage(store, "image-1", { existing: shared })
    addGenerator(store, "generator-1", "generation-1")
    addImage(store, "image-2", { existing: shared })
    getImageGeneration.mockResolvedValue({
      status: "succeeded",
      output_asset_uid: assetUid("b"),
    })
    const upload = vi.fn()

    await expect(resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["image-1", "generator-1", "image-2"],
      getCurrentSourceNodeUids: () => ["image-1", "generator-1", "image-2"],
      upload,
    })).resolves.toEqual([shared, assetUid("b"), shared])

    expect(getImageGeneration).toHaveBeenCalledWith(
      BOARD_ID,
      "generation-1",
      undefined,
    )
    expect(upload).not.toHaveBeenCalled()
    expect(startImageGeneration).not.toHaveBeenCalled()
  })


  it("pins a generator UID before its first GET and rejects A-to-B changes", async () => {
    const store = createCanvasStore()
    addGenerator(store, "generator-1", "generation-a")
    const response = deferred<{ status: string; output_asset_uid: string | null }>()
    getImageGeneration.mockImplementationOnce(() => response.promise)

    const resolution = resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["generator-1"],
    })
    await Promise.resolve()
    setGeneratorGeneration(store, "generator-1", "generation-b")
    response.resolve({ status: "started", output_asset_uid: null })

    await expect(resolution).rejects.toThrow(IMAGE_REFERENCE_CHANGED_MESSAGE)
    expect(getImageGeneration).toHaveBeenCalledTimes(1)
    expect(getImageGeneration.mock.calls[0]?.[1]).toBe("generation-a")
    expect(startImageGeneration).not.toHaveBeenCalled()
  })


  it("revalidates a generator resolved before a slower image upload", async () => {
    const store = createCanvasStore()
    addGenerator(store, "generator-1", "generation-a")
    addImage(store, "image-1")
    getImageGeneration.mockResolvedValue({
      status: "succeeded",
      output_asset_uid: assetUid("c"),
    })
    const uploadResponse = deferred<ReturnType<typeof uploaded>>()
    const upload = vi.fn(() => uploadResponse.promise)

    const resolution = resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["generator-1", "image-1"],
      upload,
    })
    await Promise.resolve()
    setGeneratorGeneration(store, "generator-1", "generation-b")
    uploadResponse.resolve(uploaded(assetUid("d")))

    await expect(resolution).rejects.toThrow(IMAGE_REFERENCE_CHANGED_MESSAGE)
    expect(getImageGeneration.mock.calls.map((call) => call[1])).toEqual(["generation-a"])
  })


  it("does not fetch generator B when it changes during an earlier image upload", async () => {
    const store = createCanvasStore()
    addImage(store, "image-1")
    addGenerator(store, "generator-1", "generation-a")
    const uploadResponse = deferred<ReturnType<typeof uploaded>>()
    const upload = vi.fn(() => uploadResponse.promise)

    const resolution = resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["image-1", "generator-1"],
      upload,
    })
    await Promise.resolve()
    setGeneratorGeneration(store, "generator-1", "generation-b")
    uploadResponse.resolve(uploaded(assetUid("d")))

    await expect(resolution).rejects.toThrow(IMAGE_REFERENCE_CHANGED_MESSAGE)
    expect(getImageGeneration).not.toHaveBeenCalled()
  })


  it("keeps an uploaded asset immutable but does not patch a changed image source", async () => {
    const store = createCanvasStore()
    addImage(store, "image-1")
    const uploadedUid = assetUid("d")
    const uploadResponse = deferred<ReturnType<typeof uploaded>>()
    const upload = vi.fn(() => uploadResponse.promise)

    const resolution = resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["image-1"],
      upload,
    })
    await Promise.resolve()
    setImageSource(store, "image-1", OTHER_PNG_DATA_URL)
    uploadResponse.resolve(uploaded(uploadedUid))

    await expect(resolution).rejects.toThrow(IMAGE_REFERENCE_CHANGED_MESSAGE)
    const data = store.getNode(asNodeId("image-1"))?.data as {
      properties: { imageAssetUid?: unknown }
    }
    expect(data.properties.imageAssetUid).toBeUndefined()
    expect(upload).toHaveBeenCalledTimes(1)
  })


  it("rejects a registered image association change during generator resolution", async () => {
    const store = createCanvasStore()
    addGenerator(store, "generator-1", "generation-a")
    addImage(store, "image-1", { existing: assetUid("a") })
    const response = deferred<{ status: string; output_asset_uid: string }>()
    getImageGeneration.mockImplementationOnce(() => response.promise)

    const resolution = resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["generator-1", "image-1"],
    })
    await Promise.resolve()
    setImageAsset(store, "image-1", assetUid("b"))
    response.resolve({ status: "succeeded", output_asset_uid: assetUid("c") })

    await expect(resolution).rejects.toThrow(IMAGE_REFERENCE_CHANGED_MESSAGE)
  })


  it("keeps partial materializations and reuses them after a later failure", async () => {
    const store = createCanvasStore()
    addImage(store, "image-1")
    addImage(store, "image-2")
    addImage(store, "image-3")
    const first = assetUid("1")
    const second = assetUid("2")
    const third = assetUid("3")
    const upload = vi.fn()
      .mockResolvedValueOnce(uploaded(first))
      .mockResolvedValueOnce(uploaded(second))
      .mockRejectedValueOnce(new Error("sanitized upload failure"))

    await expect(resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["image-1", "image-2", "image-3"],
      upload,
    })).rejects.toThrow("sanitized upload failure")

    const firstData = store.getNode(asNodeId("image-1"))?.data as {
      properties: { imageAssetUid: { value: string } }
    }
    const secondData = store.getNode(asNodeId("image-2"))?.data as {
      properties: { imageAssetUid: { value: string } }
    }
    expect(firstData.properties.imageAssetUid.value).toBe(first)
    expect(secondData.properties.imageAssetUid.value).toBe(second)

    upload.mockReset().mockResolvedValue(uploaded(third))
    await expect(resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["image-1", "image-2", "image-3"],
      upload,
    })).resolves.toEqual([first, second, third])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(startImageGeneration).not.toHaveBeenCalled()
  })


  it("rejects duplicate sources, arbitrary paths, and incomplete generators", async () => {
    const store = createCanvasStore()
    addImage(store, "image-1", { src: "file:///tmp/reference.png" })
    addGenerator(store, "generator-1", "generation-1")
    const upload = vi.fn()

    await expect(resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["image-1", "image-1"],
      upload,
    })).rejects.toThrow("두 번")
    await expect(resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["image-1"],
      upload,
    })).rejects.toThrow("등록할 수 없습니다")
    getImageGeneration.mockResolvedValue({ status: "started", output_asset_uid: null })
    await expect(resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["generator-1"],
      upload,
    })).rejects.toThrow("완료된 이미지")
    expect(upload).not.toHaveBeenCalled()
    expect(startImageGeneration).not.toHaveBeenCalled()
  })


  it("normalizes only determinate local materialization errors into safe resolution copy", async () => {
    const store = createCanvasStore()
    addImage(store, "broken-image", { src: "data:image/png;base64,%%broken%%" })
    addImage(store, "invalid-response-image")
    addImage(store, "transport-image")

    const broken = resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["broken-image"],
    })
    await expect(broken).rejects.toThrow(IMAGE_REFERENCE_UNAVAILABLE_MESSAGE)
    await expect(broken).rejects.toBeInstanceOf(ImageReferenceResolutionError)

    const invalidResponse = resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["invalid-response-image"],
      upload: vi.fn().mockResolvedValue({ asset_uid: "not-an-asset" }),
    })
    await expect(invalidResponse).rejects.toThrow(IMAGE_REFERENCE_INVALID_RESPONSE_MESSAGE)
    await expect(invalidResponse).rejects.toBeInstanceOf(ImageReferenceResolutionError)

    const rawUploadError = new Error("500 - private upstream response body")
    const transportFailure = resolveReferenceAssetUids({
      store,
      graphId: BOARD_ID,
      sourceNodeUids: ["transport-image"],
      upload: vi.fn().mockRejectedValue(rawUploadError),
    })
    await expect(transportFailure).rejects.toBe(rawUploadError)
    await expect(transportFailure).rejects.not.toBeInstanceOf(ImageReferenceResolutionError)
    expect(startImageGeneration).not.toHaveBeenCalled()
  })
})
