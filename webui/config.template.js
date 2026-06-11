window.__APP_CONFIG__ = {
  apiBase: "${API_ORIGIN}",
  billingEnabled: "${VITE_BILLING_ENABLED}",
  // The mini-app iframe runtime's public origin. Read by the host
  // bundle's MiniAppMount to set the iframe `src`. See
  // mini-app-archi.md §6.1.
  miniAppOrigin: "${VITE_MINI_APP_ORIGIN}",
  // The host app's public origin. Read by the iframe runtime to
  // validate `event.origin` on incoming postMessage events.
  hostOrigin: "${VITE_HOST_ORIGIN}",
}
