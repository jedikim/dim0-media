// Public surface of the mini-app feature.
//
// MiniAppMount is the React component the canvas node-type wraps in
// sub-commit 3.2. state-client's fetch/save helpers are exposed for
// any host code that needs to read/write widget state directly (e.g.
// future "duplicate widget" operations).

export { MiniAppMount } from "./mount"
export type { MiniAppMountProps } from "./mount"
export { prefetchMiniAppRuntime } from "./runtime-target"
export { fetchMiniAppState, saveMiniAppState } from "./state-client"
