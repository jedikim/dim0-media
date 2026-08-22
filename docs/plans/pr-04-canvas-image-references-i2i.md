# PR-04: Canvas image references and image-to-image generation

## Status and scope

This is roadmap **PR-04**. Its eventual GitHub pull request number is independent of
that roadmap label. The work stays on `feat/pr-04-canvas-image-references` and uses
the title `feat(image-gen): add canvas image references and i2i`.

PR-04 connects existing image or successful Image Generator nodes to another Image
Generator as ordered references. It materializes immutable board assets, snapshots
their UIDs before generation, and sends those UIDs through the existing audited
server path. Automatic result nodes and generation history remain PR-05 work.

The implementation has two logical checkpoints in one Draft PR:

1. immutable asset bridge and typed reference errors;
2. reference edges, ordered resolution, and the I2I canvas workflow.

No schema migration, global asset library, queue, retry orchestrator, node-to-asset
association table, or new collaboration architecture is added.

## Trust boundaries

- Browser input may contain only a multipart image body or an internal asset UID.
  Generation endpoints never accept URLs, `file://` paths, data URLs, storage keys,
  credentials, or provider headers.
- `POST /boards/{graph_id}/image-assets` uses the exact `graph_id` path name so the
  existing `verify_board_member_can_edit` dependency authorizes the upload.
- The server sniffs bounded PNG, JPEG, or WebP bytes and derives MIME, dimensions,
  byte size, and SHA-256. Claimed MIME and filenames are not trusted.
- A server-controlled content-addressed storage key is written atomically before an
  immutable `image_asset` row is registered. The response exposes metadata and the
  asset UID, never the storage key.
- The generation service resolves every asset on the requested board before the
  provider call. Missing, inaccessible, and cross-board assets share the same 404
  response so existence is not disclosed.
- Canvas source node UIDs are UI and recovery metadata only. This PR does not send
  them to the generation API or assert them as provenance. Consequently
  `image_generation_reference.reference_node_uid` remains `NULL`.
- The server preserves the received asset UID order. It does not deduplicate, sort,
  or truncate references. Different source nodes may intentionally resolve to the
  same asset UID.

## Checkpoint A: immutable asset bridge

### Asset endpoint and storage

The collection route is exactly:

```text
POST /boards/{graph_id}/image-assets
```

It requires authentication, board edit access, and multipart binary upload. The
body is read with a sentinel byte and rejected before unbounded allocation. Existing
provider byte and pixel ceilings are reused. Only PNG, JPEG, and WebP are accepted;
GIF, AVIF, SVG, spoofed MIME, invalid raster data, URLs, and paths are rejected.

Storage uses the existing `ImageStorage` confinement and atomic writer with an
uploaded content-addressed key. Database registration uses `ImageGenerationStore`
and the existing `image_asset` table with `source_kind=uploaded`. A failed database
insert compensates only a file newly created by that request and only after an
authoritative board/asset lookup confirms that no row exists. A matching row after
a lost INSERT response is success; unknown database state preserves the file.

The response contains `asset_uid`, `mime_type`, `width`, `height`, `byte_size`, and
`content_sha256`. It does not contain a storage path or provider data. This endpoint
does not call an image provider.

### Canvas property and lazy materialization

Image Notes gain optional `imageAssetUid: KeywordProperty`. Code reads the UID from
`.value`; a keyword with an empty value is the explicit cleared sentinel. Missing,
empty, malformed, or non-string values mean “not registered.” The property remains
inside existing `NoteProperties`, so normal note↔node conversion, deep-merge,
serialization, collaboration, and same-board cloning preserve it.

Synced-board uploads normally register the downscaled raster through the new asset
endpoint, store the returned UID immediately, and keep the existing data URL for
rendering. Network, 429, and 5xx failures may create the ordinary data-URL node
without a UID for later lazy materialization; 401/403 and 413/422 fail closed.
Viewer image import/search is blocked both in chrome and at the common add-image hook.
Legacy image nodes are not migrated on mount. Only explicit reference resolution
turns a data URL into a Blob, uploads it, and patches the source node immediately.
Successful partial materializations are durable and reused on retry. Mount, viewer
display, clone, paste, and local-board display never trigger an upload.

### Typed error contract

The image-generation router retains FastAPI's existing envelope:

```json
{"detail":{"code":"reference_too_large","message":"One or more reference images exceed the size limit."}}
```

It maps safe domain errors as follows:

| HTTP | code | meaning |
|---:|---|---|
| 404 | `image_reference_unavailable` | missing, inaccessible, or cross-board asset |
| 422 | `unsupported_reference_format` | unsupported or spoofed raster |
| 413 | `reference_too_large` | one reference exceeds the byte ceiling |
| 413 | `reference_pixel_limit_exceeded` | one reference exceeds the pixel ceiling |
| 413 | `reference_request_too_large` | aggregate raw reference bytes exceed the ceiling |
| 413 | `reference_encoded_size_exceeded` | estimated encoded request exceeds the memory ceiling |
| 422 | capability-specific code | I2I unsupported or reference count exceeded |

Provider bodies, inaccessible asset details, and storage paths are never included.
The frontend does not change `apiFetch`: its image-generation module extracts the
body after the first `" - "`, safely parses JSON, validates object `detail`, `code`,
and `message`, and otherwise returns `null` to the existing generic fallback.

## Checkpoint B: reference edges and I2I

### Edge and ordering source of truth

A reference edge attaches an image or Image Generator source to an Image Generator
target. Synced edge metadata marks it and records a non-negative creation ordinal.
Those reference edges are the only source of truth; no separate ordered node list is
stored on the target.

Fresh valid connections and valid reconnects receive the next ordinal for that
target. `edge.update` reclassifies changed endpoints and `edge.remove` updates the
live ordered list; local add/reconnect/delete is compensated while the target is
locked. Rendering sorts
by ordinal with the stable edge creation identity as a tie-breaker. Removing and
reconnecting therefore moves a source to the end; drag reorder is out of scope.
The UI shows numbered thumbnails and supports removal. Exact source→target duplicate
reference edges are rejected client-side, while two sources resolving to the same
asset are allowed. The server cannot enforce source-node uniqueness because node IDs
are intentionally absent from the audited reference rows.

Reference edge metadata round-trips in the existing Link properties/data and follows
the existing collaboration path. Editors may create or remove references. Viewers
may only render them. Local boards do not materialize assets or generate images.

### Ordered source resolution

For each ordered edge at explicit Generate time:

- an image source reuses a valid `imageAssetUid.value`; otherwise a legacy data URL
  is decoded and uploaded, then the UID is immediately patched onto that source;
- an Image Generator source reads its `activeGenerationUid`, performs only the
  existing board-scoped generation status GET, and uses a successful
  `output_asset_uid`; no shared `outputAssetUid` cache is added.

Resolution never trusts arbitrary URLs or paths. A source without a reusable asset
or successful output blocks generation with sanitized UI copy.

### Local `resolving` lifecycle

`resolving` is a local-only phase entered synchronously before the first await. It
locks prompt, model, options, Generate, and reference add/remove controls. A ref-based
single-flight guard is set before React state can render, preventing rapid duplicate
clicks and duplicate materialization. The guard is released on every success,
failure, abort, or unmount path.

No shared pending snapshot exists during `resolving`. Only after all sources resolve
does the hook create a pending snapshot and transition to `starting`. A resolution
failure performs zero generation POSTs, preserves the previous preview, clears the
local busy phase, and leaves already-created immutable assets in place. Retrying
reuses those assets and resolves only remaining sources.

After asset resolution the hook rereads the current ordered canvas source IDs. Any
collaboration reorder/add/remove aborts before pending creation and provider work.
Source deletion reuses canvas-harness 0.1.27's existing edge-first
`edge.remove → node.remove` cascade; PR-04 adds regression coverage rather than a
second cleanup subscriber.

### Pending snapshot and idempotency

The canonical pending snapshot contains ordered source node UIDs and ordered asset
UIDs in addition to board, generator, initiator, client request UID, model, prompt,
and parameters. Existing version-1 T2I snapshots parse as empty reference arrays;
new snapshots serialize the new version. The snapshot is created after resolution
and remains immutable across polling, transport ambiguity, explicit recovery,
StrictMode replay, and remote source changes.

The generation POST sends exactly the stored asset UID array. Pending state locks all
inputs and references. A changed reference set starts with a new client request UID;
ambiguous recovery reuses the original UID and payload. Clone and paste strip pending
state. Mount, reload, viewer, and local-board paths perform zero generation POSTs.
The four typed reference-size 413 responses are determinate pre-run rejections: they
clear pending, preserve the previous active preview, and require an explicit new
Generate/new UUID. Transport and 5xx ambiguity still retain the exact snapshot.

Model support and maximum reference count come from `/image-models`; no UI-only
maximum is introduced. T2I requires `supports_text_to_image`; a non-empty reference
set requires `supports_image_to_image`. Over-limit references are rejected without
truncation.

The live provider response exposed no body `id` but did expose `x-generation-id`.
The adapter keeps bounded body-ID compatibility and uses a bounded, case-insensitive
header fallback only when the body ID is absent. Invalid or missing values remain
`NULL`, and no header value is logged or returned to the client.

## Verification

Checkpoint A tests cover the exact route, `graph_id` ACL, unauthenticated/viewer and
wrong-board rejection, PNG/JPEG/WebP uploads, spoofing and unsupported formats,
byte/pixel limits, metadata/storage integrity, property round-trip and sentinel,
explicit legacy materialization, error parsing, and provider-call count zero.

Checkpoint B tests cover image/generator edges, stable order, numbered display,
removal, exact duplicate rejection, same-asset sources, three-reference order and
model boundary, resolving locks and synchronous single-flight, partial success,
generation-POST-zero failures, immutable pending recovery, StrictMode, T2I
regression, viewer/local/mount/clone/paste POST-zero behavior, and PostgreSQL audit
rows with ordered asset snapshots and `reference_node_uid IS NULL`.

Final verification runs targeted frontend/backend tests, isolated PostgreSQL
integration tests, the full backend suite, Node 20 UI suite, lint and changed-file
format checks, `make check`, `git diff --check`, mocked E2E, and GitHub CI. CI never
uses a provider credential or external image provider.

After all local and CI gates pass, one approved I2I smoke may use
`x-ai/grok-imagine-image-2.0`, one non-personal reference, 1K/low/1:1, and one output.
Immediately beforehand the official registry and price are rechecked; no call is
made if expected total cost exceeds or cannot be proven at `$0.06`. Timeout recovery
polls the same client request only and never issues a second paid call.

## Rollback and follow-up

The feature is additive and has no schema migration. Rolling back the frontend hides
reference authoring while leaving immutable assets and audit history valid. Rolling
back the upload route prevents new materialization without deleting existing files
or rows. Existing T2I, legacy `/files`, and asset content reads remain compatible.

PR-05 will create result image nodes, connect them to generators, and add version or
history UX using the already-reserved nullable `output_node_uid`. It will also own
cross-store result-node reconciliation. PR-04 does not manufacture or persist a
claimed node↔asset provenance relation.
