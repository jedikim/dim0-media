//! System-browser Google OAuth for the desktop app (loopback + PKCE).
//!
//! Google blocks OAuth inside embedded webviews, so the desktop flow opens the OS
//! browser to Google's consent screen with a `127.0.0.1:<port>` redirect, runs a
//! one-shot loopback server to catch the auth `code`, and returns it to the webview.
//! The code + PKCE verifier are then exchanged for tokens **server-side** (the
//! client secret never ships in the app).

use std::time::{Duration, Instant};

use serde::Serialize;
use tiny_http::{Header, Response, Server};


#[derive(Serialize)]
pub struct OauthResult {
    pub code: String,
    pub redirect_uri: String,
}


/// Percent-encode a query-parameter value.
fn enc(s: &str) -> String {
    urlencoding::encode(s).into_owned()
}


/// Read one query parameter from a request path, URL-decoded.
fn query_param(path: &str, key: &str) -> Option<String> {
    let query = path.splitn(2, '?').nth(1).unwrap_or("");
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if it.next() == Some(key) {
            return it.next().and_then(|v| urlencoding::decode(v).ok()).map(|c| c.into_owned());
        }
    }
    None
}


/// Parse `code` and `state` from a redirect request path (`/?code=..&state=..`).
fn parse_code_state(path: &str) -> (Option<String>, Option<String>) {
    (query_param(path, "code"), query_param(path, "state"))
}


/// Serve the loopback until the redirect arrives (or a 5-minute timeout), matching
/// `state` (CSRF). Stray requests (favicon, etc.) are answered and ignored.
fn wait_for_code(server: Server, expected_state: &str) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        if Instant::now() >= deadline {
            return Err("timed out waiting for Google sign-in".into());
        }
        let request = match server.recv_timeout(Duration::from_secs(1)) {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(e) => return Err(e.to_string()),
        };
        let (code, state) = parse_code_state(request.url());
        let error = query_param(request.url(), "error");
        let matched = code.is_some() && state.as_deref() == Some(expected_state);
        // App-styled result pages (self-contained: inline CSS + embedded font),
        // shown in the user's system browser. See oauth-success/error.html.
        let body = if matched {
            include_str!("oauth-success.html")
        } else {
            include_str!("oauth-error.html")
        };
        let header =
            Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap();
        let _ = request.respond(Response::from_string(body).with_header(header));
        if let Some(c) = code {
            return if state.as_deref() == Some(expected_state) {
                Ok(c)
            } else {
                Err("OAuth state mismatch".into())
            };
        }
        // Google redirects with `?error=access_denied` when the user cancels/denies —
        // fail fast instead of looping until the timeout.
        if let Some(e) = error {
            return Err(format!("Google sign-in was cancelled or failed: {e}"));
        }
    }
}


/// Open the browser to Google's consent screen and return the auth code + the
/// loopback redirect URI it was issued for (needed by the server-side exchange).
/// PKCE `code_challenge` and CSRF `state` are generated in the webview.
#[tauri::command]
pub async fn google_oauth(
    client_id: String,
    scope: String,
    code_challenge: String,
    state: String,
) -> Result<OauthResult, String> {
    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .ok_or_else(|| "could not resolve loopback port".to_string())?;
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?response_type=code\
&client_id={}&redirect_uri={}&scope={}&code_challenge={}\
&code_challenge_method=S256&state={}&access_type=offline&prompt=select_account",
        enc(&client_id),
        enc(&redirect_uri),
        enc(&scope),
        enc(&code_challenge),
        enc(&state),
    );

    open::that(&auth_url).map_err(|e| format!("could not open browser: {e}"))?;

    let expected = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(server, &expected))
        .await
        .map_err(|e| e.to_string())??;

    Ok(OauthResult { code, redirect_uri })
}


#[cfg(test)]
mod tests {
    use super::{parse_code_state, query_param};

    #[test]
    fn parses_code_and_state() {
        let (code, state) = parse_code_state("/?code=abc123&state=xyz&scope=openid");
        assert_eq!(code.as_deref(), Some("abc123"));
        assert_eq!(state.as_deref(), Some("xyz"));
    }

    #[test]
    fn reads_error_param() {
        assert_eq!(
            query_param("/?error=access_denied&state=xyz", "error").as_deref(),
            Some("access_denied"),
        );
        assert!(query_param("/?code=abc&state=xyz", "error").is_none());
    }

    #[test]
    fn url_decodes_values() {
        let (code, _) = parse_code_state("/?code=a%2Fb%3Dc");
        assert_eq!(code.as_deref(), Some("a/b=c"));
    }

    #[test]
    fn none_when_absent() {
        let (code, state) = parse_code_state("/favicon.ico");
        assert!(code.is_none() && state.is_none());
    }
}
