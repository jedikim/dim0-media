import { describe, expect, it, vi } from "vitest"
import { asNodeId, createCanvasStore } from "@canvas-harness/core"

import {
  CLEARED_IMAGE_ASSET_UID,
  IMAGE_REFERENCE_CHANGED_MESSAGE,
  imageDataUrlToBlob,
  materializeImageNodeAsset,
  readImageAssetUid,
} from "./image-reference-assets"


const BOARD_ID = "board-1"
const NODE_ID = asNodeId("image-1")
const ASSET_UID = "a".repeat(32)
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo="
const OTHER_PNG_DATA_URL = "data:image/png;base64,c2FmZQ=="


const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}


const imageNode = (src = PNG_DATA_URL) => ({
  id: NODE_ID,
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
    properties: {},
    src,
  },
})


describe("image reference assets", () => {
  it("treats malformed and cleared keyword values as unregistered", () => {
    expect(readImageAssetUid({ type: "keyword", value: ASSET_UID })).toBe(ASSET_UID)
    expect(readImageAssetUid({ type: "keyword", value: "not-an-asset" })).toBeNull()
    expect(readImageAssetUid(CLEARED_IMAGE_ASSET_UID)).toBeNull()
  })


  it("decodes only bounded supported data URLs", () => {
    expect(imageDataUrlToBlob(PNG_DATA_URL).type).toBe("image/png")
    expect(() => imageDataUrlToBlob("https://example.test/image.png")).toThrow()
    expect(() => imageDataUrlToBlob("data:image/gif;base64,R0lGODlh")).toThrow()
    expect(() => imageDataUrlToBlob("data:image/png,not-base64")).toThrow()
  })


  it("materializes only on explicit invocation and patches the UID immediately", async () => {
    const store = createCanvasStore()
    store.addNode(imageNode())
    const upload = vi.fn().mockResolvedValue({
      asset_uid: ASSET_UID,
      mime_type: "image/png",
      width: 1,
      height: 1,
      byte_size: 8,
      content_sha256: "b".repeat(64),
    })
    expect(upload).not.toHaveBeenCalled()

    await expect(materializeImageNodeAsset({
      store,
      graphId: BOARD_ID,
      nodeId: NODE_ID,
      upload,
    })).resolves.toBe(ASSET_UID)

    expect(upload).toHaveBeenCalledTimes(1)
    const data = store.getNode(NODE_ID)?.data as {
      properties: { imageAssetUid: { value: string } }
    }
    expect(data.properties.imageAssetUid.value).toBe(ASSET_UID)
  })


  it("preserves the uploaded asset but does not patch a source changed in flight", async () => {
    const store = createCanvasStore()
    store.addNode(imageNode())
    type UploadResponse = {
      asset_uid: string
      mime_type: "image/png"
      width: number
      height: number
      byte_size: number
      content_sha256: string
    }
    const response = deferred<UploadResponse>()
    const upload = vi.fn(() => response.promise)
    const materialization = materializeImageNodeAsset({
      store,
      graphId: BOARD_ID,
      nodeId: NODE_ID,
      upload,
      expectedVersion: { src: PNG_DATA_URL, assetUid: null },
    })
    await Promise.resolve()
    const data = store.getNode(NODE_ID)?.data as { src: string; properties: Record<string, unknown> }
    data.src = OTHER_PNG_DATA_URL
    response.resolve({
      asset_uid: ASSET_UID,
      mime_type: "image/png",
      width: 1,
      height: 1,
      byte_size: 8,
      content_sha256: "b".repeat(64),
    })

    await expect(materialization).rejects.toThrow(IMAGE_REFERENCE_CHANGED_MESSAGE)
    expect(data.properties.imageAssetUid).toBeUndefined()
    expect(upload).toHaveBeenCalledTimes(1)
  })


  it("reuses an existing asset without another upload", async () => {
    const store = createCanvasStore()
    const node = imageNode()
    node.data.properties = {
      imageAssetUid: { type: "keyword", value: ASSET_UID },
    }
    store.addNode(node)
    const upload = vi.fn()

    await expect(materializeImageNodeAsset({
      store,
      graphId: BOARD_ID,
      nodeId: NODE_ID,
      upload,
    })).resolves.toBe(ASSET_UID)
    expect(upload).not.toHaveBeenCalled()
  })


  it("rejects foreign-board and non-data sources without uploading", async () => {
    const store = createCanvasStore()
    store.addNode(imageNode("file:///tmp/image.png"))
    const upload = vi.fn()

    await expect(materializeImageNodeAsset({
      store,
      graphId: "other-board",
      nodeId: NODE_ID,
      upload,
    })).rejects.toThrow("이 보드")
    await expect(materializeImageNodeAsset({
      store,
      graphId: BOARD_ID,
      nodeId: NODE_ID,
      upload,
    })).rejects.toThrow("등록할 수 없습니다")
    expect(upload).not.toHaveBeenCalled()
  })
})
