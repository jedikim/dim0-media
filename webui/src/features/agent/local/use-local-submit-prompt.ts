import { useCallback } from "react"
import { useNavigate } from "@tanstack/react-router"
import { generateUuid, trimText } from "@/lib/common"
import { getCanvasStoreRef } from "@/features/board/harness/canvas-store-ref"
import { arrangeCreatedNodes } from "@/features/board/harness/agent/arrange-created-nodes"
import { runAgent } from "@/features/agent/engine/agent-loop"
import { resolveAgentLlm } from "@/features/agent/engine/services/local-llm"
import { collectSourceUrls, makeWebSearchTool, resolveSearchClient } from "@/features/agent/engine/web-search"
import { makeCodeInterpreterTool, resolveCodeClient } from "@/features/agent/engine/code-interpreter"
import { makeFetchTool, resolveFetchClient } from "@/features/agent/engine/fetch-url"
import { postProcessUrlCitations } from "@/features/agent/utils/citations"
import { isOverQuotaError } from "@/features/agent/engine/services/run"
import { createFlushGate } from "@/features/agent/utils/stream/throttle"
import { useIsSignedIn } from "@/lib/auth"
import { agentBuildTools, searchNotes } from "@/features/agent/engine/tools"
import { skillTools } from "@/features/agent/engine/skills"
import { getSearchIndexRef } from "@/features/board/search/search-index-ref"
import { getDocIndexRef } from "@/features/board/search/doc-index-ref"
import { rebuildDocIndex } from "@/features/board/search/use-doc-index"
import { getLocalStores } from "@/features/local-stores"
import type { SnapshotMetaRecord } from "@/features/board/persist/local/idb"
import { getBoardPersistenceRef } from "@/features/board/persist/local/board-persistence-ref"
import { makeDocSearchTool } from "@/features/agent/engine/doc-search"
import { resolveConfirmDecision, useToolConfirm, type ToolConfirmDecision } from "@/features/agent/engine/tool-confirm-store"
import { useToolTrustStore } from "@/features/agent/settings/tool-trust-store"
import type { AgentEvent } from "@/features/agent/engine/types"
import { planSystemPrompt } from "@/features/agent/prompts"
import { useByokStore } from "@/features/agent/byok/byok-store"
import { useChatStore } from "@/features/agent/store/chat-store"
import { byokModelForId } from "@/features/agent/types/model-catalog"
import { useBoardAppStore } from "@/features/board/harness/store/board-app-store"
import { useLocalMessagesStore } from "@/features/agent/store/local-messages-store"
import { putChatTranscript } from "@/features/agent/api/chat-transcript"
import type { ChatMessage } from "@/features/agent/types/chat"
import { agentLog } from "@/features/agent/engine/debug"
import type { CanvasStore } from "@canvas-harness/core"
import { latestAssistantText, stepsFromEvents } from "./agent-event-to-step"
import { toLlmHistory } from "./chat-history"
import { maybeAutoLabelBoard } from "./describe-board"
import { buildBoardSnapshot, readRecentOps, renderBoardSnapshot } from "./board-snapshot"
import { wrapWithMessageContext } from "./message-context"


/** Submit-time inputs forwarded from the composer; backend-only fields are ignored. */
type LocalSubmitOptions = {
  /** Selected-node / active-surface context to prepend to the agent's prompt. */
  messageContext?: string
}


// Note-building tools + full-text search + on-demand skill loaders.
const AGENT_TOOLS = [...agentBuildTools, searchNotes, ...skillTools]


let counter = 0
const mintId = (): string => `local-${Date.now()}-${counter++}`


/**
 * Assemble the deterministic board-snapshot block (no LLM) for the system prompt:
 * node inventory, folder outline, selection, and changes since you last checked.
 *
 * Reads the per-device "seen" cursor (`snapshot_meta`) but does NOT advance it —
 * that happens at turn end (`advanceBoardSnapshotCursor`), AFTER the agent's own
 * writes are committed, so the agent's edits this turn are not reported back to it
 * next turn as user "recent changes". So recent changes span sessions (first open
 * after being away shows what moved while you were gone) and, mid-session, show
 * only what the USER touched between turns.
 */
const buildBoardBlock = async (store: CanvasStore, rootId: string | null, boardId: string): Promise<string> => {
  // Auxiliary context — a storage hiccup (transient IDB error, blocked upgrade)
  // must degrade to an empty block, never abort the turn.
  try {
    const { engine, boards } = await getLocalStores()
    const cursor = await engine.get<SnapshotMetaRecord>("snapshot_meta", boardId)
    // First time on this device: no baseline yet, so report nothing as "recent"
    // (the turn-end advance establishes the baseline).
    const recent = cursor === undefined ? [] : await readRecentOps(engine, boardId, cursor.seenSeq)
    const meta = await boards.getBoard(boardId)
    const snapshot = buildBoardSnapshot(store, rootId, recent)
    return renderBoardSnapshot(snapshot, { title: meta?.title ?? "Untitled board" })
  } catch (e) {
    agentLog.error("buildBoardBlock", e)
    return ""
  }
}


/**
 * Advance the per-device snapshot cursor to the current oplog max. Runs at turn
 * end (awaited, after the agent's writes are flushed), so those writes are marked
 * "seen" and won't resurface as recent changes next turn.
 */
const advanceBoardSnapshotCursor = async (boardId: string): Promise<void> => {
  // Commit the board's debounced writes (the agent's creates + arrange moves this
  // turn) to the oplog FIRST — otherwise readRecentOps reads a stale tail and the
  // cursor lands below the agent's ops, re-reporting them next turn as user changes.
  await getBoardPersistenceRef()?.flush()
  const { engine } = await getLocalStores()
  const cursor = await engine.get<SnapshotMetaRecord>("snapshot_meta", boardId)
  const from = cursor?.seenSeq ?? 0
  const ops = await readRecentOps(engine, boardId, from)
  const maxSeq = ops.reduce((m, r) => Math.max(m, r.seq), from)
  if (cursor === undefined || maxSeq !== from) {
    await engine.put<SnapshotMetaRecord>("snapshot_meta", { boardId, seenSeq: maxSeq })
  }
}


/**
 * Local analog of `useSubmitPrompt`: runs the frontend engine against the live
 * board and streams its events into the local message store as a `ChatMessage`
 * with `ReasoningStep[]` — so the existing rich chat UI renders it unchanged.
 * Mints a chat on the first turn (mirrors the backend creating a chat) and
 * labels it from the opening prompt.
 *
 * When `syncTranscript` is set (a synced board in browser-agent mode), the
 * finished transcript is also backed up to the server for cross-device access —
 * a fire-and-forget mirror of the local persist, never part of the turn's path.
 */
export function useLocalSubmitPrompt(boardId: string, syncTranscript = false) {
  // Source of truth for the client agent: byok-store (keys + search engine) plus
  // service availability. Deliberately NOT chat-store's webSearchEngine /
  // enabledTools / useDeepResearch — those feed only the retiring backend path.
  const asConfig = useByokStore((s) => s.asConfig)
  const searchByok = useByokStore((s) => s.searchByok)
  const searchEngine = useByokStore((s) => s.searchEngine)
  const codeByok = useByokStore((s) => s.codeByok)
  // The active model chosen in Settings → General (shared with the online chat).
  const llmModel = useChatStore((s) => s.llmModel)
  const llmCatalog = useChatStore((s) => s.llmCatalog)
  const signedIn = useIsSignedIn()
  const setMessages = useLocalMessagesStore((s) => s.setMessages)
  const setChatUid = useLocalMessagesStore((s) => s.setChatUid)
  const persist = useLocalMessagesStore((s) => s.persist)
  const navigate = useNavigate()

  return useCallback(
    async (prompt: string, options: LocalSubmitOptions = {}): Promise<void> => {
      // Selected-node / surface context, captured at submit time by the composer.
      const messageContext = options.messageContext?.trim() || undefined
      const store = getCanvasStoreRef()
      const config = asConfig()
      // One run id per user message: every managed call in this turn (LLM +
      // tools) carries it, so the server meters the whole run as a single unit
      // (deduped by X-Run-Id; see backend meter_run).
      const runId = generateUuid()
      // Translate the selected model to the BYOK provider's model string (used
      // only on the signed-out/direct path); undefined for "auto".
      const byokModel =
        config && llmModel && llmModel !== "auto"
          ? byokModelForId(llmCatalog, llmModel, config.provider)
          : undefined
      // The agent's LLM: BYOK if a key is set, else managed (our keys) when
      // signed in. Null only when signed out with no key.
      const llm = store ? resolveAgentLlm(config, { signedIn, runId, model: llmModel, byokModel }) : null
      // Current folder layer at submit time — new notes are born here (not
      // rescoped after the fact). Read imperatively so it's always current.
      const rootId = useBoardAppStore.getState().rootId

      // Reuse the active chat, or mint one on the first turn.
      const existingUid = useLocalMessagesStore.getState().chatUid
      const isNewChat = !existingUid
      const chatUid = existingUid ?? generateUuid()
      if (isNewChat) setChatUid(chatUid)
      const label = isNewChat ? trimText(prompt, 40) : undefined

      // Prior turns become context (captured before the new turn is appended)
      // so the agent remembers the conversation.
      const history = toLlmHistory(useLocalMessagesStore.getState().messages)

      // Stamp creation time (mirrors backend Message.created_at) so the UI
      // shows a real timestamp instead of "Pending…".
      const createdAt = new Date().toISOString()
      const assistantId = mintId()
      // Display the raw prompt; stash the context under properties.context so the
      // "Context" chip renders (mirrors the online path). The agent itself gets
      // the wrapped prompt below.
      const userMessage: ChatMessage = {
        id: mintId(),
        role: "user",
        content: { markdown: prompt },
        chatUid,
        properties: messageContext ? { context: { type: "text", text: messageContext } } : {},
        createdAt,
      }
      const base: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: { markdown: "" },
        chatUid,
        properties: { reasoning: { type: "reasoning", reasoning: [] } },
        streaming: true,
        createdAt,
      }

      setMessages([...useLocalMessagesStore.getState().messages, userMessage, base])

      // Replace the assistant message by id (robust to ordering / later turns).
      const patch = (msg: ChatMessage): void => {
        setMessages(useLocalMessagesStore.getState().messages.map((m) => (m.id === assistantId ? msg : m)))
      }

      if (!store || !llm) {
        patch({ ...base, content: { markdown: store ? "Set your API key first." : "No active board." }, streaming: false })
        await persist(label)
        return
      }

      const events: AgentEvent[] = []
      const render = (streaming: boolean): void => {
        patch({
          ...base,
          content: { markdown: latestAssistantText(events) },
          properties: { reasoning: { type: "reasoning", reasoning: stepsFromEvents(events, boardId) } },
          streaming,
        })
      }

      const createdNodeIds: string[] = []
      // Coalesce token-delta repaints to ~10fps (shared with the backend-agent
      // stream builder). Structural events (tool start/result) force an
      // immediate repaint; the final frame below always flushes.
      const gate = createFlushGate()
      try {
        const system = planSystemPrompt(new Date().toLocaleString())
        // Deterministic board awareness (no LLM), injected as a standing section.
        const boardBlock = await buildBoardBlock(store, rootId, boardId)
        const systemWithBoard = boardBlock ? `${system}\n\n## BOARD\n${boardBlock}` : system
        const search = getSearchIndexRef() ?? undefined
        // External services are managed (signed in); include each tool only when
        // resolvable, so a signed-out user isn't offered an unavailable capability.
        const webSearch = resolveSearchClient({ signedIn, runId, engine: searchEngine, byok: searchByok() })
        const code = resolveCodeClient({ signedIn, runId, byokKey: codeByok() })
        const fetchUrl = resolveFetchClient({ signedIn, runId })
        // Offer doc_search only when the board actually has indexed document chunks.
        // The index rebuilds asynchronously on board load, so a question asked
        // before that resolves would see count() === 0; fall back to the persisted
        // chunks and build the index on the spot so grounding isn't silently lost.
        const docIndex = getDocIndexRef()
        let hasDocs = !!docIndex && docIndex.count() > 0
        if (docIndex && !hasDocs) {
          const { docs } = await getLocalStores()
          if ((await docs.chunksForBoard(boardId)).length > 0) {
            await rebuildDocIndex(docIndex, boardId)
            hasDocs = docIndex.count() > 0
          }
        }
        const tools = [
          ...AGENT_TOOLS,
          ...(webSearch ? [makeWebSearchTool(webSearch)] : []),
          ...(code ? [makeCodeInterpreterTool(code)] : []),
          ...(fetchUrl ? [makeFetchTool(fetchUrl)] : []),
          ...(hasDocs && docIndex ? [makeDocSearchTool(docIndex)] : []),
        ]
        // When documents are attached, steer grounding + citation-by-title (titles
        // are unique per board, so a title names exactly one document).
        const systemWithDocs = hasDocs
          ? `${systemWithBoard}\n\nThis board has uploaded documents. Use \`doc_search(query)\` — full-text over their contents — and for anything they could answer, call it FIRST, before answering from your own knowledge; ground the answer in the returned passages and cite each document by its exact title. (\`search_notes\` covers the board's own notes.)`
          : systemWithBoard
        const userMessageForAgent = wrapWithMessageContext(prompt, messageContext)
        // Gate off-board tools (network/code) behind a user confirmation, so a
        // prompt-injected tool call can't silently exfiltrate or run code. A
        // standing per-tool "always allow" grant (Settings) skips the prompt for
        // that tool. Both ports are read via getState() per call, so a mid-run
        // toggle (on OR off) applies to the next call.
        const confirmTool = (req: { name: string; args: Record<string, unknown> }): Promise<ToolConfirmDecision> =>
          resolveConfirmDecision(
            req.name,
            useToolTrustStore.getState().isAutoAllowed,
            () => useToolConfirm.getState().request(req),
          )
        for await (const ev of runAgent({ system: systemWithDocs, userMessage: userMessageForAgent, history, tools, llm, ctx: { store, rootId, search, confirmTool } })) {
          // Streaming yields a cumulative assistant_text per token — replace the
          // previous snapshot in place instead of appending one event per token.
          const prev = events[events.length - 1]
          if (ev.type === "assistant_text" && prev?.type === "assistant_text") events[events.length - 1] = ev
          else events.push(ev)
          // Track notes CREATED this turn so we can arrange + recenter them. A
          // write_note that rewrote an existing note reports `created: false` —
          // excluding it keeps a user-placed note from being relocated/reselected.
          if (
            ev.type === "tool_result" &&
            (ev.toolName === "write_note" || ev.toolName === "create_note") &&
            ev.result && typeof ev.result === "object" && "id" in ev.result &&
            (ev.result as { created?: unknown }).created === true
          ) {
            createdNodeIds.push(String((ev.result as { id: unknown }).id))
          }
          const now = Date.now()
          if (gate.shouldFlush(now, { force: ev.type !== "assistant_text" })) {
            render(true)
            gate.markFlushed(now)
          }
        }
        // Snap any mangled/truncated links in the final answer back to the real
        // web-search sources, so the sources panel (parsed from the text) is
        // accurate. In-place so the final render + persistence use the fix.
        const sources = collectSourceUrls(events)
        if (sources.length > 0) {
          const answer = latestAssistantText(events)
          const corrected = postProcessUrlCitations(answer, sources)
          if (corrected !== answer) {
            for (let i = events.length - 1; i >= 0; i -= 1) {
              if (events[i].type === "assistant_text") {
                events[i] = { type: "assistant_text", text: corrected }
                break
              }
            }
          }
        }
        render(false)
        // Post-turn arrange (frontend analog of backend rearrange_created_notes).
        await arrangeCreatedNodes(store, createdNodeIds)
        // Recenter the canvas on the freshly created nodes — parity with the
        // online path's `?center=` navigation, which useCenterFromUrl reads to
        // fit the union rect (zoom-capped) and select them.
        if (createdNodeIds.length > 0) {
          void navigate({
            to: ".",
            replace: true,
            search: (prev: Record<string, unknown>) => ({ ...prev, center: createdNodeIds.join(",") }),
          })
        }
      } catch (e) {
        agentLog.error("runAgent", e)
        // Mark it as an error so it doesn't read like a normal answer. An
        // over-quota rejection (429) gets a friendly upgrade nudge instead of a
        // raw error string.
        const text = isOverQuotaError(e)
          ? "⚠️ You've reached your daily AI limit. Upgrade your plan, or add your own API key in settings to keep going."
          : `⚠️ Agent error: ${e instanceof Error ? e.message : String(e)}`
        events.push({ type: "assistant_text", text })
        render(false)
      } finally {
        await persist(label)
        const { chatUid: savedUid, messages } = useLocalMessagesStore.getState()
        agentLog.turnDone(savedUid, messages.length)
        // Back up the finished transcript to the server (Phase 2 cross-device),
        // mirroring the local persist. Fire-and-forget and gated on sign-in: a
        // failed or unauthenticated backup must never surface as a turn error.
        if (syncTranscript && signedIn && savedUid) {
          void putChatTranscript(savedUid, boardId, messages, label).catch((e) =>
            agentLog.error("putChatTranscript", e),
          )
        }
        // Auto-label a still-"Untitled" board from its first turn (fire-and-forget).
        void maybeAutoLabelBoard(boardId, messages, resolveAgentLlm(config, { signedIn, runId, model: llmModel, byokModel }))
        // Mark everything up to now (incl. the agent's own writes this turn) as
        // "seen", so next turn's snapshot reports only what the USER changed.
        // Awaited (not fire-and-forget): the cursor must be committed before this
        // turn's callback resolves, so a fast back-to-back prompt can't read the
        // stale cursor and re-report the agent's own writes as user changes.
        await advanceBoardSnapshotCursor(boardId).catch((e) => agentLog.error("advanceBoardSnapshotCursor", e))
      }
    },
    [asConfig, searchByok, searchEngine, codeByok, llmModel, llmCatalog, signedIn, syncTranscript, setMessages, setChatUid, persist, boardId, navigate],
  )
}
