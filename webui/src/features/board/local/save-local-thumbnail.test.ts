import { beforeEach, describe, expect, it } from "vitest"
import { resetIdb } from "@/test/canvas"
import { getLocalStores } from "@/features/local-stores"
import { newLocalBoard } from "@/features/board/persist/local/board-registry"
import { saveLocalThumbnail } from "./save-local-thumbnail"


beforeEach(() => {
  resetIdb()
})


describe("saveLocalThumbnail", () => {
  it("encodes the blob as a data URL and stores it on the board", async () => {
    const { boards } = await getLocalStores()
    const board = newLocalBoard("Shot", 1000)
    await boards.createBoard(board)

    await saveLocalThumbnail({ boardId: board.id, blob: new Blob(["png-bytes"], { type: "image/png" }) })

    const thumb = (await boards.getBoard(board.id))?.thumbnail
    expect(thumb).toMatch(/^data:image\/png;base64,/)
  })
})
