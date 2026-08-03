import { invoke } from "@tauri-apps/api/core"
import { googleSigninDesktop, type TokenPayload } from "@/api"


const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")


/** A PKCE verifier + its S256 challenge (RFC 7636). */
async function makePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: b64url(new Uint8Array(digest)) }
}


/**
 * Desktop Google sign-in via the system browser (loopback + PKCE). The Rust
 * `google_oauth` command opens the default browser to Google's consent screen and
 * returns the auth `code` from the loopback redirect; the backend then exchanges
 * the code (its client secret) for tokens. Google can't run OAuth inside the
 * webview, which is why this goes through the OS browser instead of GIS.
 */
export async function desktopGoogleSignin(clientId: string): Promise<TokenPayload> {
  const { verifier, challenge } = await makePkce()
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)))
  const { code, redirect_uri } = await invoke<{ code: string; redirect_uri: string }>(
    "google_oauth",
    { clientId, scope: "openid email profile", codeChallenge: challenge, state },
  )
  return googleSigninDesktop(code, verifier, redirect_uri)
}
