const DEFAULT_LONG_EDGE = 1920
const DEFAULT_SHORT_EDGE = 1080
const JPEG_QUALITY = 0.85


export type DownscaleResult = {
  blob: Blob
  width: number
  height: number
  mimeType: string
}


/**
 * Downscale an image file so that it fits inside a 1920x1080 box while preserving
 * aspect ratio. Preserves PNG/WebP transparency and re-encodes other inputs as JPEG.
 * Reports the browser's actual encoded MIME when canvas falls back from WebP.
 */
export async function downscaleImage(
  file: File,
  longEdge: number = DEFAULT_LONG_EDGE,
  shortEdge: number = DEFAULT_SHORT_EDGE,
): Promise<DownscaleResult> {
  const bitmap = await loadBitmap(file)
  const { width: srcW, height: srcH } = bitmap

  const longest = Math.max(srcW, srcH)
  const shortest = Math.min(srcW, srcH)
  const scale = Math.min(1, longEdge / longest, shortEdge / shortest)

  const targetW = Math.max(1, Math.round(srcW * scale))
  const targetH = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement("canvas")
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    closeBitmap(bitmap)
    throw new Error("Canvas 2D context unavailable")
  }

  const preservesAlpha = file.type === "image/png" || file.type === "image/webp"
  if (!preservesAlpha) {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, targetW, targetH)
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  closeBitmap(bitmap)

  const outputType = preservesAlpha ? file.type : "image/jpeg"
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      outputType,
      preservesAlpha ? undefined : JPEG_QUALITY,
    )
  })

  return { blob, width: targetW, height: targetH, mimeType: blob.type }
}


function closeBitmap(source: ImageBitmap | HTMLImageElement) {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close()
  }
}


/**
 * Decode a file into a drawable source, preferring createImageBitmap when available.
 */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file)
    } catch {
      // fall through to HTMLImageElement path
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = "async"
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}
