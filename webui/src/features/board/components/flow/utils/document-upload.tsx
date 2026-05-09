import { useState } from "react"
import { CancelStatusIcon, CheckCircleStatusIcon, LoaderRefreshIcon } from "@/components/icons"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useParseDocument } from "@/features/board/api/parse-document"
import { useGraphStore } from "@/features/board/store/graph-store"
import { useAppStore } from "@/store"
import { FREE_PLAN_DOCUMENT_LIMIT_TOOLTIP, isDocumentUploadLimited } from "@/features/board/lib/board-limit"

export interface DocumentUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const LoadingIcon = () => (
  <LoaderRefreshIcon className="size-4 animate-spin [animation-duration:750ms]" />
)

const SuccessIcon = () => (
  <CheckCircleStatusIcon className="text-foreground size-4" />
)

const ErrorIcon = () => (
  <CancelStatusIcon className="text-destructive size-4" />
)


/**
 * Lazily-mounted body for the document upload dialog. Subscriptions to the
 * graph store (nodes count for plan-limit check, board scope) live here so
 * they only run while the dialog is open. When the dialog is closed the
 * body unmounts entirely and stops paying any subscription cost.
 */
const DocumentUploadDialogBody = ({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void
}) => {
  const boardId = useGraphStore((state) => state.boardId)
  const rootId = useGraphStore((state) => state.rootId)
  const documentCount = useGraphStore((state) =>
    state.nodes.filter((n) => n.data?.type === "document").length,
  )
  const userPlan = useAppStore((state) => state.userPlan)
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { parseDocumentAsync } = useParseDocument()
  const documentUploadLimited = isDocumentUploadLimited(userPlan, documentCount)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file || !boardId || submitting) return
    if (documentUploadLimited) {
      toast.error(FREE_PLAN_DOCUMENT_LIMIT_TOOLTIP)
      return
    }

    setSubmitting(true)
    const startedAt = Date.now()
    const formatElapsed = () => `${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}s`
    const id = toast(`Parsing & Analyzing document… ${formatElapsed()}`, { icon: <LoadingIcon />, duration: Infinity })
    const timer = window.setInterval(() => {
      toast(`Parsing & Analyzing document… ${formatElapsed()}`, { id, icon: <LoadingIcon />, duration: Infinity })
    }, 1000)
    onOpenChange(false)
    try {
      await parseDocumentAsync({ boardId, file, rootId })
      window.clearInterval(timer)
      toast.dismiss(id)
      const finalElapsed = formatElapsed()
      toast.success(`Document parsed. (${finalElapsed})`, { icon: <SuccessIcon />, duration: 3000 })
      setFile(null)
    } catch (err) {
      console.error("Failed to parse document:", err)
      window.clearInterval(timer)
      toast.dismiss(id)
      const finalElapsed = formatElapsed()
      toast.error(`Failed to parse document. (${finalElapsed})`, { icon: <ErrorIcon />, duration: 4000 })
    } finally {
      window.clearInterval(timer)
      setSubmitting(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Input
          type="file"
          accept="application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-muted-foreground">PDF files only.</p>
        <p className="text-xs text-muted-foreground">
          Document must stay within both limits: 30 pages max and 5 MB max.
        </p>
        {documentUploadLimited && (
          <p className="text-xs text-destructive">
            {FREE_PLAN_DOCUMENT_LIMIT_TOOLTIP}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!file || !boardId || submitting || documentUploadLimited}>
          {submitting ? "Parsing…" : "Upload & Parse"}
        </Button>
      </div>
    </form>
  )
}


/**
 * Dialog for uploading a document and triggering parsing. The outer
 * Dialog wrapper stays mounted for animation purposes; the body — which
 * holds the graph-store subscription used for the plan-limit check —
 * mounts only while `open` is true.
 */
export const DocumentUploadDialog = ({
  open,
  onOpenChange,
}: DocumentUploadDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
        </DialogHeader>
        {open && <DocumentUploadDialogBody onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  )
}
