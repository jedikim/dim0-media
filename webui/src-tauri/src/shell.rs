//! Open a URL in the user's default browser (external to the webview).

/// Open `url` in the OS default browser. Used to push Stripe checkout/portal out
/// of the WKWebView so payment flows run in a real browser, not the embedded one.
#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    // Only ever hand off http(s) — never file://, tauri://, or shell targets — so
    // this command can't be repurposed as a general "launch anything" primitive.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("refusing to open non-http(s) url".into());
    }
    open::that(url).map_err(|e| e.to_string())
}
