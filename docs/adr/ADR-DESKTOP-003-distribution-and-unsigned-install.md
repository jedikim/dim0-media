# ADR-DESKTOP-003: Desktop distribution — tagged GitHub Release, prompt-free terminal install (unsigned)

**Status:** Accepted · 2026-08-02
**Applies to:** `.github/workflows/desktop-release.yml`, `install.sh`, `install.ps1`, `webui/src-tauri/tauri.conf.json` (`bundle.macOS`), `README.md`

## Decision
Desktop installers are published as a **GitHub Release** on a version tag; users
install via a **terminal one-liner** (`install.sh` / `install.ps1`), which launches
**without a Gatekeeper / SmartScreen prompt even though the app is unsigned/unnotarized.**

- The macOS app MUST be **ad-hoc signed** (`bundle.macOS.signingIdentity: "-"`) so it
  runs on Apple Silicon without a Developer certificate.
- `install.sh` MUST `curl` the **`.app` zip** (NOT the `.dmg`) and `xattr -dr
  com.apple.quarantine` it; `install.ps1` MUST `Invoke-WebRequest` the NSIS `.exe`.
  Terminal downloads carry no Gatekeeper quarantine / Windows mark-of-the-web — the
  exact triggers for the first-run prompt.
- `desktop-release.yml` MUST bake the server URL from the **`API_ORIGIN` repo
  variable** (→ `VITE_API_URL`, see [ADR-DESKTOP-002](./ADR-DESKTOP-002-byok-relay-and-remote-path.md));
  unset ⇒ a local-only build.

## Why
Real code-signing (Apple notarization + Windows Authenticode) needs paid certs and
CI secrets we don't have yet. But those prompts are triggered by the *download's*
quarantine attribute / mark-of-the-web, which **browsers add and `curl` /
`Invoke-WebRequest` do not** — so a terminal install is prompt-free without signing.
Ad-hoc signing is a *separate* requirement: an unsigned binary is killed on Apple
Silicon regardless of quarantine (quarantine controls the *prompt*; the signature
controls whether it can *run at all*). The `.app` zip exists because the `.dmg` is
the browser path (which does prompt) — `install.sh` needs a curl-friendly archive.

## Consequences
- A **browser** download from the Releases page still shows the first-run prompt
  (until notarized) — the scripts are the clean path; the README points at them.
- Notarization/signing + auto-update (Tauri updater) are follow-ups (need secrets).
- macOS is **arm64-only** for now; the Windows installer still shows a **UAC**
  elevation prompt (separate from SmartScreen).
- Two workflows: `desktop-build.yml` (`workflow_dispatch`, uploads artifacts) is the
  per-OS "does it compile" check; `desktop-release.yml` (tags) is the publish. The
  Rust storage tests run via `make test-tauri` in CI (see [ADR-DESKTOP-001](./ADR-DESKTOP-001-rusqlite-local-storage.md)).

## Rejected alternatives
- **Ship only the `.dmg` / a browser download** — every user hits the Gatekeeper
  prompt; the terminal path avoids it for free.
- **Block releases on notarization** — needs paid certs we don't have; the ad-hoc +
  terminal-install path ships now and can be signed later without changing the model.

## Verify
`grep -n "signingIdentity" webui/src-tauri/tauri.conf.json` — the macOS app is ad-hoc signed.
`grep -n "com.apple.quarantine" install.sh` — the macOS terminal install strips Gatekeeper quarantine.
`grep -n "Invoke-WebRequest" install.ps1` — the Windows install fetches via the terminal (no mark-of-the-web).
