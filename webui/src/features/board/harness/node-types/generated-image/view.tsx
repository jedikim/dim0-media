import { useCallback, useEffect, useRef, useState } from "react"
import type { NodeId } from "@canvas-harness/core"
import { useNode } from "@canvas-harness/react"
import { toast } from "sonner"

import { ImageStackIcon } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  fetchImageAssetBlob,
  getImageGenerationDetails,
  type GenerationDetails,
} from "@/features/board/api/image-generation"
import { useAuthedImage } from "@/features/board/hooks/use-authed-image"
import type { NoteNodeData } from "../../convert/note-to-node"
import { useStopCanvasGesture } from "../../shared-views"
import {
  GENERATED_IMAGE_UNAVAILABLE_MESSAGE,
  readGeneratedImageAssociation,
} from "./node-state"


const DOWNLOAD_ERROR_MESSAGE = "원본 이미지를 다운로드하지 못했습니다."
const DETAILS_ERROR_MESSAGE = "생성 정보를 불러오지 못했습니다."


/** Map only supported raster Blob MIME types to deterministic extensions. */
function generatedImageExtension(mimeType: string): "png" | "jpg" | "webp" | null {
  if (mimeType === "image/png") return "png"
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  return null
}


/** Render one authenticated immutable reference thumbnail while details are open. */
function GeneratedReferenceThumbnail({
  graphId,
  assetUid,
  ordinal,
}: {
  graphId: string
  assetUid: string
  ordinal: number
}) {
  const { url, failed } = useAuthedImage(graphId, assetUid)
  return (
    <div className="relative size-20 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40">
      {url ? (
        <img
          className="size-full object-contain"
          src={url}
          alt={`생성 참조 ${ordinal + 1}`}
        />
      ) : (
        <span className="grid size-full place-items-center px-2 text-center text-[10px] text-muted-foreground">
          {failed ? "불러올 수 없음" : "불러오는 중"}
        </span>
      )}
      <span className="absolute bottom-0 left-0 rounded-tr bg-background/90 px-1 text-[10px] font-semibold">
        {ordinal + 1}
      </span>
    </div>
  )
}


/** Render lazy, read-only provenance for one immutable generated image. */
function GenerationDetailsDialog({
  graphId,
  generationUid,
  open,
  onOpenChange,
}: {
  graphId: string
  generationUid: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [details, setDetails] = useState<GenerationDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDetails(null)
    setError(null)
    if (!open) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let alive = true
    setLoading(true)
    void getImageGenerationDetails(graphId, generationUid, controller.signal)
      .then((next) => {
        if (!alive || next.generation_uid !== generationUid) return
        setDetails(next)
      })
      .catch((fetchError: unknown) => {
        if (!alive || (fetchError instanceof Error && fetchError.name === "AbortError")) return
        setError(DETAILS_ERROR_MESSAGE)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      controller.abort()
    }
  }, [generationUid, graphId, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>생성 정보</DialogTitle>
          <DialogDescription>저장된 생성 요청과 당시 참조 이미지입니다.</DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">생성 정보를 불러오는 중입니다.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {details && (
          <div className="flex min-h-0 flex-col gap-4 text-sm">
            <section className="space-y-1">
              <h3 className="font-medium">프롬프트</h3>
              <p className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3">
                {details.prompt}
              </p>
            </section>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">모델</dt>
              <dd className="break-all">{details.model_id}</dd>
              <dt className="text-muted-foreground">비율</dt>
              <dd>{details.parameters.aspect_ratio ?? "—"}</dd>
              <dt className="text-muted-foreground">해상도</dt>
              <dd>{details.parameters.resolution ?? "—"}</dd>
              <dt className="text-muted-foreground">품질</dt>
              <dd>{details.parameters.quality ?? "—"}</dd>
              <dt className="text-muted-foreground">참조</dt>
              <dd>{details.references.length}장</dd>
            </dl>
            {details.references.length > 0 && (
              <div aria-label="Generation references" className="flex gap-2 overflow-x-auto pb-1">
                {details.references.map((reference) => (
                  <GeneratedReferenceThumbnail
                    key={`${reference.ordinal}:${reference.asset_uid}`}
                    graphId={graphId}
                    assetUid={reference.asset_uid}
                    ordinal={reference.ordinal}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}


/** Render one immutable generated asset with read-only provenance actions. */
export function GeneratedImageView({ id }: { id: NodeId }) {
  const node = useNode(id)
  const data = (node?.data ?? {}) as NoteNodeData
  const properties = data.properties ?? {}
  const association = readGeneratedImageAssociation(properties)
  const graphId = data.graphUid || null
  const valid = association !== null && graphId !== null
  const { url, failed } = useAuthedImage(
    graphId,
    valid ? association.assetUid : null,
  )
  const actionsRef = useRef<HTMLDivElement>(null)
  const downloadControllerRef = useRef<AbortController | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  useStopCanvasGesture(actionsRef)

  useEffect(() => {
    downloadControllerRef.current?.abort()
    downloadControllerRef.current = null
    setDownloading(false)
    return () => {
      downloadControllerRef.current?.abort()
    }
  }, [association?.assetUid, association?.generationUid, graphId])

  const downloadOriginal = useCallback(async (): Promise<void> => {
    if (!graphId || !association || downloading || downloadControllerRef.current) return
    const controller = new AbortController()
    downloadControllerRef.current = controller
    setDownloading(true)
    try {
      const blob = await fetchImageAssetBlob(graphId, association.assetUid, controller.signal)
      if (controller.signal.aborted) return
      const extension = generatedImageExtension(blob.type)
      if (!extension) throw new Error("Unsupported generated image MIME")
      const objectUrl = URL.createObjectURL(blob)
      try {
        const link = document.createElement("a")
        link.href = objectUrl
        link.download = `generated-${association.generationUid}.${extension}`
        document.body.appendChild(link)
        link.click()
        link.remove()
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        toast.error(DOWNLOAD_ERROR_MESSAGE)
      }
    } finally {
      if (downloadControllerRef.current === controller) {
        downloadControllerRef.current = null
        if (!controller.signal.aborted) setDownloading(false)
      }
    }
  }, [association, downloading, graphId])

  if (!node) return null
  return (
    <div className="pointer-events-none relative h-full w-full overflow-hidden rounded-xl border border-border bg-muted/30 shadow-sm">
      {url ? (
        <img className="size-full object-contain" src={url} alt="생성된 이미지 결과" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
          <ImageStackIcon className="size-6" />
          <span className="text-xs">
            {!valid || failed ? GENERATED_IMAGE_UNAVAILABLE_MESSAGE : "생성 이미지를 불러오는 중입니다."}
          </span>
        </div>
      )}
      <div
        ref={actionsRef}
        className="pointer-events-auto absolute bottom-2 right-2 flex gap-1 rounded-md bg-background/90 p-1 shadow-sm"
      >
        <button
          type="button"
          className="rounded px-2 py-1 text-[11px] text-foreground disabled:opacity-50"
          disabled={!valid || downloading}
          onClick={() => void downloadOriginal()}
        >
          {downloading ? "다운로드 중…" : "원본 다운로드"}
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-[11px] text-foreground disabled:opacity-50"
          disabled={!valid}
          onClick={() => setDetailsOpen(true)}
        >
          생성 정보
        </button>
      </div>
      {valid && association && graphId && (
        <GenerationDetailsDialog
          graphId={graphId}
          generationUid={association.generationUid}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      )}
    </div>
  )
}
