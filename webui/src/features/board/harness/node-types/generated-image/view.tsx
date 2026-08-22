import type { NodeId } from "@canvas-harness/core"
import { useNode } from "@canvas-harness/react"

import { ImageStackIcon } from "@/components/icons"
import { useAuthedImage } from "@/features/board/hooks/use-authed-image"
import type { NoteNodeData } from "../../convert/note-to-node"
import {
  GENERATED_IMAGE_UNAVAILABLE_MESSAGE,
  readGeneratedImageAssociation,
} from "./node-state"


/** Render one immutable generated asset without persisting a browser URL. */
export function GeneratedImageView({ id }: { id: NodeId }) {
  const node = useNode(id)
  const data = (node?.data ?? {}) as NoteNodeData
  const properties = data.properties ?? {}
  const association = readGeneratedImageAssociation(properties)
  const valid = association !== null && !!data.graphUid
  const { url, failed } = useAuthedImage(
    data.graphUid || null,
    valid ? association.assetUid : null,
  )

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
    </div>
  )
}
