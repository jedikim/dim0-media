import { apiFetch } from "@/api"


type UploadFileResponse = {
  data: {
    file: { url: string }
  }
}


type GetFileResponse = {
  data: {
    base64_url: string
  }
}


/**
 * Upload an image blob to the backend and return a renderable data URL plus the
 * server-side file reference. Uses POST /files to persist then GET /files to
 * resolve the file:// path back to a data URL that <img> can render directly.
 */
export async function uploadImage(
  blob: Blob,
  filename: string,
): Promise<{ dataUrl: string; filePath: string }> {
  const form = new FormData()
  form.append("file", blob, filename)

  const upload = await apiFetch<UploadFileResponse>({
    path: "/files",
    method: "POST",
    body: form,
    headers: { Accept: "application/json" },
  })

  const filePath = upload.data?.file?.url
  if (!filePath) {
    throw new Error("Upload response missing file URL")
  }

  const resolved = await apiFetch<GetFileResponse>({
    path: "/files",
    method: "GET",
    params: { filename: filePath },
  })

  const dataUrl = resolved.data?.base64_url
  if (!dataUrl) {
    throw new Error("File lookup response missing base64_url")
  }

  return { dataUrl, filePath }
}
