import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCanvasStore, type CanvasStore } from "@canvas-harness/core"

import { BoardRuntimeProvider } from "./board-runtime-provider"
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

    await act(async () => {
      await addImage?.(new File(["source"], "source.png", { type: "image/png" }))
    })

    expect(uploadImageAsset).toHaveBeenCalledTimes(1)
    expect(uploadImage).not.toHaveBeenCalled()
    const node = store.getAllNodes()[0]
    const data = node.data as {
      properties: { imageAssetUid: { value: string } }
    }
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
})
