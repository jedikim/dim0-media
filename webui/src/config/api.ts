declare global {
  interface Window {
    __APP_CONFIG__?: {
      apiBase?: string
      billingEnabled?: string
      /** Mini-app iframe runtime origin (set per-env by docker-entrypoint.sh). */
      miniAppOrigin?: string
      /** Host app origin — read by the iframe runtime, never the host. */
      hostOrigin?: string
    }
  }
}

const runtime =
  typeof window !== "undefined" ? window.__APP_CONFIG__?.apiBase : undefined

export const API_URL =
  runtime || import.meta.env.VITE_API_URL || "http://localhost:8888"
