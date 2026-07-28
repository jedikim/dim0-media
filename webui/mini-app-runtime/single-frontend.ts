/**
 * Decide whether the mini-app runtime is in single-frontend mode (served
 * same-origin by the host and loaded into an opaque-origin sandbox) vs.
 * cross-origin mode.
 *
 * The host opens the single-frontend iframe WITHOUT `allow-same-origin`, so its
 * document origin is opaque — `window.origin` serializes to the string "null".
 * We detect that directly instead of trusting an injected `hostOrigin`:
 * `docker-entrypoint.sh` defaults `VITE_HOST_ORIGIN` to a non-empty value even in
 * single-frontend containers, which used to flip the runtime into strict-origin
 * mode and break the handshake (every mini-app timed out). Falling back to "no
 * host origin configured" preserves the dev/same-origin case and SSR/tests.
 */
export const isSingleFrontend = (
  hostOrigin: string | undefined,
  origin: string | undefined,
): boolean => origin === "null" || !hostOrigin
