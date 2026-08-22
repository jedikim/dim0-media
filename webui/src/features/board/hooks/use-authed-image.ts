import { useEffect, useState } from "react"

import { fetchImageAssetBlob } from "../api/image-generation"


/** Load a protected image asset and revoke its object URL on replacement or unmount. */
export function useAuthedImage(graphId: string | null, assetUid: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setUrl(null)
    setFailed(false)
    if (!graphId || !assetUid) return

    const controller = new AbortController()
    let alive = true
    let objectUrl: string | null = null

    void fetchImageAssetBlob(graphId, assetUid, controller.signal)
      .then((blob) => {
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((error: unknown) => {
        if (!alive || (error instanceof Error && error.name === "AbortError")) return
        setFailed(true)
      })

    return () => {
      alive = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [assetUid, graphId])

  return { url, failed }
}
