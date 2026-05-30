import { useEffect } from "react"
import { type CanvasStore, type NodeId } from "@canvas-harness/core"
import { toast } from "sonner"


/**
 * Block Cmd+C / Cmd+X (and Ctrl+ variants) when the canvas-harness
 * selection contains a folder node.
 *
 * Folders are a Dim0 concept (sub-boards) that canvas-harness's
 * generic clipboard doesn't know about — it would happily copy the
 * folder Node but lose every child note's `parentId` reference on
 * paste (the child's `data.parentId` still points to the old folder
 * id). Rather than build folder-tree-preserving paste in webui, we
 * prevent the copy outright and explain why.
 *
 * Uses `capture: true` so this listener runs BEFORE canvas-harness's
 * own keydown handler — we get to `preventDefault` first.
 *
 * Inputs / textareas inside the canvas chrome are excluded so users
 * can still copy text out of a label editor. Same for `<input>` /
 * `<textarea>` / `contentEditable` targets.
 */
export const useBlockFolderCopy = (store: CanvasStore): void => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCopyOrCut =
        (e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C" || e.key === "x" || e.key === "X")
      if (!isCopyOrCut) return

      // Don't interfere with text-editing copy/cut.
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === "INPUT" || tag === "TEXTAREA") return
        if (target.isContentEditable) return
      }

      const selection = store.getSelection()
      const hasFolder = selection.some((id) => {
        const node = store.getNode(id as NodeId)
        return node?.type === "folder"
      })
      if (!hasFolder) return

      e.preventDefault()
      e.stopPropagation()
      toast.info(
        e.key === "x" || e.key === "X"
          ? "Folders can't be cut — open the folder and cut its contents instead."
          : "Folders can't be copied — open the folder and copy its contents instead.",
      )
    }
    document.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true })
    }
  }, [store])
}
