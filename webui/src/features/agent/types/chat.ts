import type { ReasoningStep } from "./stream"

export type MessageRole = "user" | "assistant" | "system"

/**
 * ChatMessage represents a message in a chat conversation.
 */
export interface ChatMessage {
  id: string
  role: MessageRole
  content: {
    markdown: string
  }
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  chatUid: string
  properties: {
    reasoning?: {
      type: "reasoning",
      reasoning: ReasoningStep[]
    }
    context?: {
      type: "text"
      text: string
    }
  }
  streaming?: boolean
  isDeepResearch?: boolean
  sentAt?: string
}


export interface Chat {
  id: number
  uid: string
  label?: string
  userUid?: string
  graphUid?: string
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
}


/**
 * LocalChat — canonical persisted chat metadata (local-first). Field names track
 * the backend `Chat` (uid → id, graph_uid → boardId) so the sync spine can map
 * chats 1:1. Timestamps are epoch ms (local storage convention).
 */
export interface LocalChat {
  id: string
  boardId: string
  label?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}


/**
 * LocalMessage — a `ChatMessage` as persisted, plus the insertion `order` used to
 * restore conversation order on load (message ids don't sort chronologically).
 */
export type LocalMessage = ChatMessage & { order: number }
