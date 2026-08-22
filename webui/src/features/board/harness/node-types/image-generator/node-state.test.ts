import { describe, expect, it } from "vitest"

import {
  CLEARED_ACTIVE_GENERATION_UID,
  CLEARED_IMAGE_PENDING_REQUEST,
  isOwnedPendingImageRequest,
  parsePendingImageRequest,
  readKeywordProperty,
  serializePendingImageRequest,
  type PendingImageRequest,
} from "./node-state"


const snapshot: PendingImageRequest = {
  version: 1,
  boardUid: "board-1",
  generatorNodeUid: "node-1",
  initiatorUserUid: "user-1",
  clientRequestUid: "11111111-1111-4111-8111-111111111111",
  modelId: "model-1",
  prompt: "a blue bird",
  parameters: { quality: "low", aspect_ratio: "1:1", resolution: "1K" },
}


describe("image generator node state", () => {
  it("serializes and parses a canonical versioned request", () => {
    const raw = serializePendingImageRequest(snapshot)

    expect(raw).toBe(
      '{"version":1,"boardUid":"board-1","generatorNodeUid":"node-1",' +
      '"initiatorUserUid":"user-1",' +
      '"clientRequestUid":"11111111-1111-4111-8111-111111111111",' +
      '"modelId":"model-1","prompt":"a blue bird",' +
      '"parameters":{"aspect_ratio":"1:1","resolution":"1K","quality":"low"}}',
    )
    expect(parsePendingImageRequest(raw)).toEqual({
      ...snapshot,
      parameters: { aspect_ratio: "1:1", resolution: "1K", quality: "low" },
    })
  })


  it.each([
    "not json",
    "{}",
    JSON.stringify({ ...snapshot, version: 2 }),
    JSON.stringify({ ...snapshot, clientRequestUid: "not-a-uuid" }),
    JSON.stringify({ ...snapshot, prompt: "  " }),
    JSON.stringify({ ...snapshot, parameters: { quality: "" } }),
    JSON.stringify({ ...snapshot, parameters: { reference_asset_uids: ["asset-1"] } }),
  ])("rejects corrupt or unsupported pending data without casting it (%s)", (raw) => {
    expect(parsePendingImageRequest(raw)).toBeNull()
  })


  it("validates snapshot ownership against user, board, and node", () => {
    expect(isOwnedPendingImageRequest(snapshot, "board-1", "node-1", "user-1")).toBe(true)
    expect(isOwnedPendingImageRequest(snapshot, "board-2", "node-1", "user-1")).toBe(false)
    expect(isOwnedPendingImageRequest(snapshot, "board-1", "node-2", "user-1")).toBe(false)
    expect(isOwnedPendingImageRequest(snapshot, "board-1", "node-1", "user-2")).toBe(false)
  })


  it("uses explicit empty property sentinels for deep-merge clears", () => {
    expect(CLEARED_IMAGE_PENDING_REQUEST).toEqual({
      type: "text",
      text: "",
      searchable: false,
    })
    expect(CLEARED_ACTIVE_GENERATION_UID).toEqual({ type: "keyword", value: "" })
    expect(readKeywordProperty(CLEARED_ACTIVE_GENERATION_UID)).toBeNull()
  })
})
