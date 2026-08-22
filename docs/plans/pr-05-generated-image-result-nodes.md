# PR-05: Immutable Generated Image Result Nodes

## Goal

Use the canvas itself as image-generation history. Every successful generation can
materialize one immutable `generated-image` node and one ordinary visual edge from
its generator. Regeneration creates another result; it never mutates or deletes
older results.

This PR does not add a gallery, history API, provider call, queue, worker, database
table, or background reconciler. It reuses `image_generation_run.output_node_uid`,
`GraphStore`, `AgentBoardBridge`, the existing collaboration oplog/broadcast path,
and the authenticated image-asset content endpoint.

## Durable association

A result Note remains a production `rectangle` in backend style data and projects
to the first-party canvas type `generated-image` through four DataProperties:

- `generatedImageMarker = "immutable-result"`
- `imageAssetUid`
- `generatedImageGenerationUid`
- `generatedImageGeneratorNodeUid`

Only internal UIDs are persisted. Blob URLs live in browser memory; data URLs,
provider payloads, and storage paths never enter Note, Qdrant, collaboration data,
logs, or API responses.

The result node supports selection, movement, resizing, deletion, same-board clone,
and reference edges. It has no toolbar/create-tool entry and cannot replace its
asset, edit generation inputs, or call a provider.

## Canonical materialization

`PUT /boards/{graph_id}/image-generations/{generation_uid}/output-node` accepts only
`{"recreate": false}` or an explicit `true`. The server reads the generation,
output asset, and generator from authoritative stores and verifies:

- editor permission;
- same-board succeeded generation and output asset;
- same-board/same-folder generator with the Image Generator marker;
- canonical node/edge identity and immutable association.

Node and edge IDs are stable UUID5 `.hex` values in a fixed namespace with separate
names:

- `dim0:image-result-node:{generation_uid}`
- `dim0:image-result-edge:{generation_uid}`

Qdrant reconciliation happens before the PostgreSQL writer critical section.
Existing live canonical objects are validated and reused. An unbound tombstone is
partial state and is prepared by an ordinary `recreate: false` retry; only an
already-bound deletion requires explicit recreation. Conflicting live objects
fail closed. After both pieces are durable, a short advisory-locked PostgreSQL
transaction appends one deterministic combined `node.add` + `edge.add` batch and
binds `output_node_uid` using the same shared-pool connection. The batch identity
includes both Qdrant objects' stable ISO-string `created_at` values, so node-only,
edge-only, and pair recreation each create one new collaboration materialization,
while response-loss retries reuse the same ID. Re-sending the authoritative pair
also repairs incident-edge state without resetting a user's persisted node
position or size. The batch commit is recoverable and never recursively acquires
the pool.

Recovery is intentionally idempotent across the non-transactional stores:

- node-only state: create/validate the missing edge;
- node+edge with missing PostgreSQL binding: validate and bind;
- response loss: return the same canonical IDs on retry;
- repeated/concurrent calls: advisory lock serializes the final batch/bind writer;
- Qdrant success with oplog failure: retry validates the same objects and appends
  the missing deterministic batch without duplicating audits;
- canonical collision: do not overwrite;
- `recreate: false` with an already-bound but deleted canvas object: do not revive;
- explicit `recreate: true`: restore missing canonical objects with the same IDs;
- generator folder move during unbound preparation: fail the raced final check,
  then reparent only the partial canonical pair on retry while preserving its
  other persisted fields.

Deleting a result node/edge never deletes the generation, attempt, reference
snapshot, asset row, usage/cost audit, or image file.

## Frontend lifecycle

An editor observing `succeeded` with `output_node_uid = null` calls the idempotent
PUT with `recreate: false`. Viewers and local boards issue zero mutation calls.
StrictMode/remount concurrency is harmless because the server is authoritative.

Before materialization, the Generator keeps its inline preview. Once
`output_node_uid` is confirmed, it passes `null` to `useAuthedImage`, stops the
duplicate blob GET, and offers selection/centering of the result. If the node was
deleted, it stays deleted until an editor explicitly chooses “결과 노드 다시 추가,”
which sends `recreate: true` without creating a generation, attempt, or asset.
The explicit PUT owns a thirty-second hard deadline; timeout aborts the request,
releases the generator input lock, shows only fixed safe error copy, and permits a
new same-generation restoration attempt.

## Authenticated image loading

`useAuthedImage` retries only timeouts, `TypeError`, HTTP 408/429, and 5xx
responses. It uses at most three attempts, a ten-second per-attempt deadline, and
a hard thirty-second total deadline.
Determinate 4xx responses stop immediately. ID changes/unmount abort the current
request and timer, stale responses cannot replace the current image, and every
replaced/unmounted object URL is revoked.

Generator reference status polling enforces the existing five-minute ceiling as a
hard deadline: it checks at poll entry, schedules no delay past the remaining time,
and aborts an in-flight GET at the deadline. Only the same transient classes retry.

## Collaboration and projection

The custom definition, view registry, inline-editor and style-memory exclusions,
frontend Note conversion, backend Note-to-wire projection, inbound apply path,
snapshot/catch-up, clone/paste stamping, and parity tests all recognize
`generated-image`. Server-created Notes flow through `AgentBoardBridge`, so live
peers receive one ordinary combined `node.add` + `edge.add` batch and reconnecting
peers recover it from the PostgreSQL oplog. Result batches are durable even when no
room is open; live delivery happens only after the batch/bind transaction commits.

Same-board clone and same-board cross-folder paste keep the immutable
asset/generation/generator association under a new canvas node ID and perform no
upload or generation. Cross-board paste keeps the marker only for a safe unavailable
placeholder and clears every board-scoped UID.

The `automaticEnsures` single-flight cache and image-reference target-lock map are
still module-global. Their operations are now bounded and cleaned up, while moving
both into an explicit board-scoped lifecycle owner remains a follow-up rather than a
late redesign of this PR.

## Generated results as references

Reference edges accept `image`, `image-generator`, and `generated-image` sources.
A result captures source node UID, generation UID, and asset UID synchronously at
click time, resolves the asset directly without upload/GET/provider work, and
revalidates type, graph, association, and edge order before generation POST. The
request still sends only ordered asset UIDs; `reference_node_uid` remains `NULL`.

The PR-04 board-unavailable materialization messages are consolidated into shared
constants while this reference boundary is extended. Bounded reference-resolution
concurrency and the module-global lock redesign remain outside this PR.

## Verification

- Backend/API: authorization, canonical IDs, collisions, lifecycle rejection,
  automatic/explicit semantics, concurrent/advisory locking, partial-write and
  response-loss recovery, immutable audits, and bridge oplog/broadcast.
- Frontend/collaboration: registration/projection parity, authenticated retry and
  cleanup, hard polling deadline, automatic ensure, explicit recreate, viewer/local
  zero-mutation, preview de-duplication, clone/paste, immutable references, and
  snapshot/live hydration.
- Integration: disposable PostgreSQL, Qdrant, and Redis with a one-connection
  PostgreSQL pool; clean/reapplied schema;
  existing local/dev volumes and retained smoke data are untouched.
- Full Node 20 UI/backend checks, local-only mocked Playwright E2E, Rust/Tauri CI,
  `git diff --check`, Ruff, and GitHub CI. External provider calls remain zero.

## Rollback

Revert the feature commit. Existing generation/asset/audit rows remain valid;
`output_node_uid` may remain populated as the durable association to a canonical
result that an older server simply ignores. Canonical result Notes/Links can be
deleted from the canvas without touching image files or audit history.
