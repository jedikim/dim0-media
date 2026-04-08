import { useCallback, useEffect } from 'react'
import { useGraphStore } from '../store/graph-store'
import { convertNoteToNode } from '../utils/graph'
import { useAppStore } from '@/store'
import type { Note } from '../types/note'
import type { NoteNode, LinkEdge } from '../types/flow'
import type { Link } from '../types/link'
import { generateUuid } from '@/lib/common'
import { useShallow } from 'zustand/shallow'
import {
  clearBoardClipboard,
  loadBoardClipboard,
  saveBoardClipboard,
  type BoardClipboardMode,
  type BoardClipboardPayload,
} from '../utils/clipboard'

type CopyPasteOptions = {
  /**
   * Maximum absolute jitter in pixels applied to both x and y for a paste operation
   * A single shared dx,dy is generated per paste and applied to all pasted nodes
   * @default 30
   */
  jitterMax?: number
  /**
   * Enable built-in keybindings:
   * - Ctrl/Cmd+C to copy
   * - Ctrl/Cmd+V and Ctrl/Cmd+B to paste
   * @default true
   */
  shortcuts?: boolean
  /**
   * Optional filter that decides which selected nodes are copyable
   */
  isCopyableNode?: (node: NoteNode) => boolean
}

type Jitter = { dx: number, dy: number }

const isFolderNode = (node: NoteNode) => node.data?.style?.type === 'folder'

type SelectedClipboardData = {
  notes: Note[]
  pointNodes: NoteNode[]
  edges: LinkEdge[]
}

export function useCopyPasteNodes(opts: CopyPasteOptions = {}) {
  const { jitterMax = 30, shortcuts = true, isCopyableNode } = opts

  const userId = useAppStore(state => state.userId)

  const boardId = useGraphStore(state => state.boardId)
  const rootId = useGraphStore(state => state.rootId)
  const nodes = useGraphStore(useShallow(state => state.nodes))
  const edges = useGraphStore(useShallow(state => state.edges))
  const setNodesPersist = useGraphStore(state => state.setNodesPersist)
  const setEdgesPersist = useGraphStore(state => state.setEdgesPersist)

  const randJitter = useCallback(() => {
    const r = Math.random() * 2 - 1
    return r * jitterMax
  }, [jitterMax])

  const getSelectedNoteNodes = useCallback((): NoteNode[] => {
    const selected = nodes.filter(n => n.selected) as NoteNode[]
    const nonFolderSelected = selected.filter(node => !isFolderNode(node))
    return isCopyableNode ? nonFolderSelected.filter(isCopyableNode) : nonFolderSelected
  }, [nodes, isCopyableNode])

  /**
   * Collects the currently selected copyable graph payload.
   */
  const collectSelectedClipboardData = useCallback((): SelectedClipboardData | null => {
    const selectedNodes = getSelectedNoteNodes()
    if (!selectedNodes.length) {
      return null
    }

    const selectedIds = new Set(selectedNodes.map(n => n.id))
    const selectedEdges = edges.filter(e => e.selected)
    if (selectedEdges.length > 0) {
      for (const edge of selectedEdges) {
        selectedIds.add(edge.source)
        selectedIds.add(edge.target)
      }
    }

    const selectedWithEdges = nodes.filter(n => selectedIds.has(n.id)) as NoteNode[]

    const notes = selectedWithEdges
      .map(n => (n.data?.note ?? n.data) as Note | undefined)
      .filter((v): v is Note => v?.type === 'note' && v.style?.type !== 'folder')

    const pointNodes = selectedWithEdges.filter(
      n => (n.data as { kind?: string }).kind === 'point'
    )

    if (!notes.length && !pointNodes.length) {
      return null
    }

    // copy edges whose source & target are both in the selected node set
    const connectingEdges = edges.filter(
      e => selectedIds.has(e.source) && selectedIds.has(e.target),
    )

    return {
      notes,
      pointNodes,
      edges: connectingEdges,
    }
  }, [getSelectedNoteNodes, edges, nodes])

  /**
   * Persists the selected clipboard payload or clears older clipboard content.
   */
  const persistSelection = useCallback((mode: BoardClipboardMode) => {
    const selection = collectSelectedClipboardData()
    if (!selection) {
      clearBoardClipboard()
      return null
    }

    const payload: BoardClipboardPayload = {
      version: 1,
      mode,
      copiedAt: new Date().toISOString(),
      sourceBoardId: boardId,
      sourceRootId: rootId,
      notes: selection.notes,
      pointNodes: selection.pointNodes,
      edges: selection.edges,
    }
    saveBoardClipboard(payload)
    return payload
  }, [boardId, collectSelectedClipboardData, rootId])

  /**
   * Copies currently selected note nodes + connecting edges into persisted clipboard state.
   */
  const copySelected = useCallback(() => {
    persistSelection('copy')
  }, [persistSelection])

  /**
   * Cuts the current selection immediately and persists it for later paste.
   */
  const cutSelected = useCallback(() => {
    const payload = persistSelection('cut')
    if (!payload) return

    const removedNodeIds = new Set([
      ...payload.notes.map((note) => note.id),
      ...payload.pointNodes.map((node) => node.id),
    ])
    const removedEdgeIds = new Set(payload.edges.map((edge) => edge.id))

    setNodesPersist(curr => curr.filter(node => !removedNodeIds.has(node.id)))
    setEdgesPersist(curr => curr.filter(edge => !removedEdgeIds.has(edge.id)))
  }, [persistSelection, setEdgesPersist, setNodesPersist])

  /**
   * Returns a cloned note with a shared offset applied
   */
  const cloneNoteWithOffset = useCallback((note: Note, offset: Jitter): Note => {
    const ox = note.properties?.nodePosition?.position?.x ?? 0
    const oy = note.properties?.nodePosition?.position?.y ?? 0
    const nx = ox + offset.dx
    const ny = oy + offset.dy
    const isSlide = note.style?.type === 'slide'
    const slideName = note.properties?.slideName?.text
    const nextSlideName = slideName
      ? slideName.endsWith(' (copy)')
        ? slideName
        : `${slideName} (copy)`
      : undefined

    const cloned: Note = {
      ...note,
      id: generateUuid(),
      graphUid: boardId ?? note.graphUid,
      parentId: rootId,
      properties: {
        ...note.properties,
        nodePosition: {
          ...(note.properties?.nodePosition ?? { type: 'position' }),
          type: 'position',
          position: { x: nx, y: ny },
        },
        ...(isSlide && nextSlideName
          ? {
              slideName: {
                ...(note.properties.slideName ?? { type: 'text' }),
                type: 'text',
                text: nextSlideName,
              },
            }
          : {}),
      },
    }

    return cloned
  }, [boardId, rootId])

  const computeSelectionCenter = useCallback((notes: Note[], pointNodes: NoteNode[]) => {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const note of notes) {
      const pos = note.properties?.nodePosition?.position
      if (!pos) continue
      minX = Math.min(minX, pos.x)
      minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x)
      maxY = Math.max(maxY, pos.y)
    }

    for (const node of pointNodes) {
      minX = Math.min(minX, node.position.x)
      minY = Math.min(minY, node.position.y)
      maxX = Math.max(maxX, node.position.x)
      maxY = Math.max(maxY, node.position.y)
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null
    }

    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  }, [])

  /**
   * Pastes the copied notes + edges as new nodes/edges,
   * applying a single shared jitter for the whole batch.
   */
  const pasteCopied = useCallback(async () => {
    if (!boardId || !userId) return
    const clipboard = loadBoardClipboard()
    const copiedNotes = clipboard?.notes ?? null
    const copiedPointNodes = clipboard?.pointNodes ?? null
    const copiedEdges = clipboard?.edges ?? null

    if ((!copiedNotes || !copiedNotes.length) && (!copiedPointNodes || !copiedPointNodes.length)) return

    const lastCursor = useGraphStore.getState().lastCursorPosition
    const selectionCenter = computeSelectionCenter(copiedNotes ?? [], copiedPointNodes ?? [])
    const baseOffset = lastCursor && selectionCenter
      ? { dx: lastCursor.x - selectionCenter.x, dy: lastCursor.y - selectionCenter.y }
      : { dx: 0, dy: 0 }

    // one shared jitter per paste to preserve the internal structure
    const jitter = { dx: randJitter(), dy: randJitter() }
    const pasteOffset = { dx: jitter.dx + baseOffset.dx, dy: jitter.dy + baseOffset.dy }

    // clone notes with offset
    const clonedNotes = (copiedNotes ?? []).map(note => cloneNoteWithOffset(note, pasteOffset))

    // build node id mapping: original note id -> cloned note id
    const idMap = new Map<string, string>()
    copiedNotes?.forEach((orig, idx) => {
      const clone = clonedNotes[idx]
      idMap.set(orig.id, clone.id)
    })

    const pointNodes = copiedPointNodes ?? []

    // convert cloned notes to nodes
    const maxZ = nodes.reduce((acc, n) => {
      const kind = (n.data as { kind?: string }).kind
      const nodeType = (n.data as { style?: { type?: string } }).style?.type
      if (kind === 'point' || nodeType === 'slide') return acc
      return Math.max(acc, n.zIndex ?? 0)
    }, 0)
    let zCursor = maxZ + 1

    const newNodes = clonedNotes
      .map(convertNoteToNode)
      .map(n => ({
        ...n,
        selected: true,
        zIndex: (n.data as { style?: { type?: string } }).style?.type === 'slide' ? -1000 : zCursor++
      }))

    const edgePlans = (copiedEdges ?? []).map(edge => {
      const sourceNode = pointNodes.find(n => n.id === edge.source)
      const targetNode = pointNodes.find(n => n.id === edge.target)
      const isLine = !!sourceNode && !!targetNode
      const newId = generateUuid()
      if (isLine) {
        idMap.set(edge.source, `${newId}-start`)
        idMap.set(edge.target, `${newId}-end`)
      }
      return { edge, sourceNode, targetNode, isLine, newId }
    })

    for (const node of pointNodes) {
      if (!idMap.has(node.id)) {
        idMap.set(node.id, generateUuid())
      }
    }

    const clonedPointNodes: NoteNode[] = pointNodes.map((node) => {
      const newId = idMap.get(node.id)
      if (!newId) return node
      const attachedToNodeId = (node.data as { attachedToNodeId?: string }).attachedToNodeId
      return {
        ...node,
        id: newId,
        zIndex: 1001,
        position: {
          x: node.position.x + pasteOffset.dx,
          y: node.position.y + pasteOffset.dy,
        },
        selected: true,
        data: {
          ...node.data,
          attachedToNodeId: attachedToNodeId ? idMap.get(attachedToNodeId) ?? attachedToNodeId : undefined,
          endpointActive: true,
        },
      }
    })

    const newEdges: LinkEdge[] = []
    for (const { edge, sourceNode, targetNode, isLine, newId } of edgePlans) {
      const newSource = idMap.get(edge.source)
      const newTarget = idMap.get(edge.target)
      if (!newSource || !newTarget) continue

      const oldLink = edge.data as Link | undefined
      const newLink: Link | undefined = oldLink
        ? {
            ...oldLink,
            id: newId,
            source: newSource,
            target: newTarget,
            graphUid: boardId,
            parentId: rootId,
            createdAt: new Date().toISOString(),
            updatedAt: undefined,
            deletedAt: undefined,
          }
        : undefined

      const finalLinkData = newLink ?? (edge.data as Link | undefined)
      const sanitizedLink = finalLinkData
        ? {
            ...finalLinkData,
            properties: {
              ...finalLinkData.properties,
              edgeControlPoint: { type: 'position' as const },
              ...(isLine
                ? {
                    startPoint: {
                      type: 'position' as const,
                      position: {
                        x: (sourceNode?.position.x ?? 0) + pasteOffset.dx,
                        y: (sourceNode?.position.y ?? 0) + pasteOffset.dy,
                      },
                    },
                    endPoint: {
                      type: 'position' as const,
                      position: {
                        x: (targetNode?.position.x ?? 0) + pasteOffset.dx,
                        y: (targetNode?.position.y ?? 0) + pasteOffset.dy,
                      },
                    },
                  }
                : {}),
            },
          }
        : undefined

      newEdges.push({
        ...edge,
        id: newId,
        source: newSource,
        target: newTarget,
        selected: true,
        data: sanitizedLink,
      })
    }

    // update nodes (persisted): clear selection then append new nodes
    setNodesPersist(curr => {
      const cleared = curr.map(n => ({ ...n, selected: false }))
      return [...cleared, ...newNodes, ...clonedPointNodes]
    })

    // update edges (persisted): clear selection then append new edges
    if (newEdges.length > 0) {
      setEdgesPersist(curr => {
        const cleared = curr.map(e => ({ ...e, selected: false }))
        return [...cleared, ...newEdges]
      })
    }

    if (clipboard?.mode === 'cut') {
      clearBoardClipboard()
    }
  }, [
    boardId,
    rootId,
    userId,
    randJitter,
    cloneNoteWithOffset,
    computeSelectionCenter,
    setNodesPersist,
    setEdgesPersist,
    nodes
  ])

  useEffect(() => {
    if (!shortcuts) return

    const isEditable = () => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return true
      const tag = el.tagName.toLowerCase()
      return !(tag === 'input' || tag === 'textarea' || el.isContentEditable)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isEditable()) return
      const mod = e.metaKey || e.ctrlKey

      // copy
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        copySelected()
        return
      }

      // cut
      if (mod && e.key.toLowerCase() === 'x') {
        e.preventDefault()
        cutSelected()
        return
      }

      // paste: prefer V, also support B
      if (mod && (e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'b')) {
        e.preventDefault()
        pasteCopied()
      }
    }

    const onPaste = (e: ClipboardEvent) => {
      if (!isEditable()) return
      // we’re not reading clipboard content; use it as a signal to paste our clones
      e.preventDefault()
      pasteCopied()
    }

    const listenerOptions: AddEventListenerOptions = { capture: true }
    document.addEventListener('keydown', onKeyDown, listenerOptions)
    document.addEventListener('paste', onPaste, listenerOptions)

    return () => {
      document.removeEventListener('keydown', onKeyDown, listenerOptions)
      document.removeEventListener('paste', onPaste, listenerOptions)
    }
  }, [shortcuts, copySelected, cutSelected, pasteCopied])

  return {
    /**
     * Copies the currently selected, copyable nodes (and connecting edges) into the buffer
     */
    copySelected,
    /**
     * Cuts the current selection into the persisted clipboard and removes it immediately.
     */
    cutSelected,
    /**
     * Pastes buffered nodes + edges as new elements, applying a shared jitter per paste
     */
    pasteCopied,
    /**
     * Returns true if there is anything in the copy buffer
     */
    hasCopied: () => {
      const clipboard = loadBoardClipboard()
      return !!clipboard?.notes.length || !!clipboard?.edges.length || !!clipboard?.pointNodes.length
    },
  }
}
