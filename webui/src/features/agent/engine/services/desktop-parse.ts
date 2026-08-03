/**
 * Desktop-direct BYOK document parsing — OCR a PDF straight from the Tauri
 * webview (CORS-free via plugin-http) with the user's own Mistral key, returning
 * the same shape `/ai/parse` does, so the parse client is unchanged. This is what
 * lets document Q&A ingest work fully offline-of-our-servers on desktop.
 *
 * Mistral OCR takes the PDF as a base64 data-URI in one request (same call the
 * backend `MistralParser` makes) — no multi-step upload.
 */
import { providerPostJson, type FetchFn } from "./desktop-http"


type ParseResponse = { markdown: string; pages: number }
type ParsePost = (file: File) => Promise<ParseResponse>

type OcrPage = { index?: number; markdown?: string }
type OcrResponse = { pages?: OcrPage[] }


/** Base64-encode a File's bytes, chunked so the char-code spread stays in-bounds. */
const fileToBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunk = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}


/** Direct Mistral OCR (BYOK), mapped to the `/ai/parse` `{ markdown, pages }` shape. */
export const desktopMistralParse =
  (apiKey: string, fetchImpl?: FetchFn): ParsePost =>
  async (file) => {
    const b64 = await fileToBase64(file)
    const res = await providerPostJson<OcrResponse>(
      "https://api.mistral.ai/v1/ocr",
      {
        model: "mistral-ocr-latest",
        document: { type: "document_url", document_url: `data:application/pdf;base64,${b64}` },
        include_image_base64: false,
      },
      { Authorization: `Bearer ${apiKey}` },
      fetchImpl,
    )
    const pages = res.pages ?? []
    return {
      markdown: pages.map((p) => p.markdown ?? "").join("\n\n"),
      pages: pages.length,
    }
  }
