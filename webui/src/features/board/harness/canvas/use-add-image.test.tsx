import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCanvasStore, type CanvasStore } from "@canvas-harness/core"

import { BoardRuntimeProvider } from "./board-runtime-provider"
import { materializeImageNodeAsset } from "../image-reference-assets"
import { useBoardAppStore } from "../store/board-app-store"
import { useHarnessAddImage } from "./use-add-image"


const { downscaleImage, uploadImage, uploadImageAsset } = vi.hoisted(() => ({
  downscaleImage: vi.fn(),
  uploadImage: vi.fn(),
  uploadImageAsset: vi.fn(),
}))


vi.mock("@/features/board/components/flow/utils/downscale-image", () => ({ downscaleImage }))
vi.mock("@/features/board/api/upload-image", () => ({ uploadImage }))
vi.mock("@/features/board/api/image-generation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/board/api/image-generation")>(),
  uploadImageAsset,
}))


const BOARD_ID = "board-1"
const ASSET_UID = "a".repeat(32)


describe("useHarnessAddImage asset registration", () => {
  let container: HTMLDivElement
  let root: Root
  let store: CanvasStore
  let addImage: ReturnType<typeof useHarnessAddImage> | null


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    store = createCanvasStore()
    addImage = null
    const blob = new Blob(["safe-raster"], { type: "image/png" })
    downscaleImage.mockReset().mockResolvedValue({
      blob,
      width: 40,
      height: 20,
      mimeType: "image/png",
    })
    uploadImage.mockReset().mockResolvedValue({
      dataUrl: "data:image/png;base64,c2FmZQ==",
      filePath: "file://legacy",
    })
    uploadImageAsset.mockReset().mockResolvedValue({
      asset_uid: ASSET_UID,
      mime_type: "image/png",
      width: 40,
      height: 20,
      byte_size: blob.size,
      content_sha256: "b".repeat(64),
    })
    useBoardAppStore.setState({ canEdit: true })
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })


  const mount = (local: boolean): void => {
    const Probe = (): null => {
      addImage = useHarnessAddImage(store, BOARD_ID, null)
      return null
    }
    act(() => root.render(
      <BoardRuntimeProvider local={local}>
        <Probe />
      </BoardRuntimeProvider>,
    ))
  }


  it("registers a synced upload and stores imageAssetUid.value", async () => {
    mount(false)

    let addedNodeId: ReturnType<CanvasStore["addNode"]> | null | undefined
    await act(async () => {
      addedNodeId = await addImage?.(
        new File(["source"], "source.png", { type: "image/png" }),
      )
    })

    expect(uploadImageAsset).toHaveBeenCalledTimes(1)
    expect(uploadImage).not.toHaveBeenCalled()
    const node = store.getAllNodes()[0]
    const data = node.data as {
      properties: { imageAssetUid: { value: string } }
    }
    expect(addedNodeId).toBe(node.id)
    expect(data.properties.imageAssetUid.value).toBe(ASSET_UID)
  })


  it("keeps local-board image insertion on the existing non-asset path", async () => {
    mount(true)

    await act(async () => {
      await addImage?.(new File(["source"], "source.png", { type: "image/png" }))
    })

    expect(uploadImage).toHaveBeenCalledTimes(1)
    expect(uploadImageAsset).not.toHaveBeenCalled()
    const node = store.getAllNodes()[0]
    const data = node.data as { properties: { imageAssetUid?: unknown } }
    expect(data.properties.imageAssetUid).toBeUndefined()
  })


  it("fails closed for a viewer before downscale, upload, or store mutation", async () => {
    useBoardAppStore.setState({ canEdit: false })
    mount(false)

    let added: ReturnType<CanvasStore["addNode"]> | null | undefined
    await act(async () => {
      added = await addImage?.(new File(["source"], "source.png", { type: "image/png" }))
    })

    expect(added).toBeNull()
    expect(downscaleImage).not.toHaveBeenCalled()
    expect(uploadImageAsset).not.toHaveBeenCalled()
    expect(uploadImage).not.toHaveBeenCalled()
    expect(store.getAllNodes()).toEqual([])
  })


  it("falls back only for transient synced upload failures and lazily registers once", async () => {
    uploadImageAsset.mockRejectedValueOnce(new TypeError("network unavailable"))
    mount(false)

    await act(async () => {
      await addImage?.(new File(["source"], "source.png", { type: "image/png" }))
    })

    const [node] = store.getAllNodes()
    const fallbackData = node.data as { properties: { imageAssetUid?: unknown } }
    expect(fallbackData.properties.imageAssetUid).toBeUndefined()
    expect(uploadImageAsset).toHaveBeenCalledTimes(1)

    const lazyUpload = vi.fn().mockResolvedValue({
      asset_uid: ASSET_UID,
      mime_type: "image/png",
      width: 40,
      height: 20,
      byte_size: 8,
      content_sha256: "b".repeat(64),
    })
    await act(async () => {
      await materializeImageNodeAsset({
        store,
        graphId: BOARD_ID,
        nodeId: node.id,
        upload: lazyUpload,
      })
    })

    expect(lazyUpload).toHaveBeenCalledTimes(1)
    const materialized = store.getNode(node.id)?.data as {
      properties: { imageAssetUid: { value: string } }
    }
    expect(materialized.properties.imageAssetUid.value).toBe(ASSET_UID)
  })


  it.each([401, 403, 413, 422])(
    "does not create a fallback node for determinate HTTP %s",
    async (status) => {
      uploadImageAsset.mockRejectedValue(new Error(`${status} rejected - {}`))
      mount(false)

      await act(async () => {
        await addImage?.(new File(["source"], "source.png", { type: "image/png" }))
      })

      expect(store.getAllNodes()).toEqual([])
      expect(uploadImageAsset).toHaveBeenCalledTimes(1)
    },
  )


  it("does not hide an unclassified upload implementation failure", async () => {
    uploadImageAsset.mockRejectedValue(new Error("unexpected parser failure"))
    mount(false)

    await act(async () => {
      await addImage?.(new File(["source"], "source.png", { type: "image/png" }))
    })

    expect(store.getAllNodes()).toEqual([])
  })


  it.each([429, 500, 503])(
    "creates an unregistered fallback node for transient HTTP %s",
    async (status) => {
      uploadImageAsset.mockRejectedValue(new Error(`${status} unavailable - {}`))
      mount(false)

      await act(async () => {
        await addImage?.(new File(["source"], "source.png", { type: "image/png" }))
      })

      expect(store.getAllNodes()).toHaveLength(1)
      const data = store.getAllNodes()[0].data as { properties: { imageAssetUid?: unknown } }
      expect(data.properties.imageAssetUid).toBeUndefined()
    },
  )
})
