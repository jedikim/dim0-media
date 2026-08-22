import { beforeEach, describe, expect, it, vi } from "vitest"
import { asNodeId, createCanvasStore, type CanvasStore } from "@canvas-harness/core"

import { resolveReferenceAssetUids } from "./image-reference-resolution"


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
const assetUid = (value: string): string => value.repeat(32).slice(0, 32)


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
})
