# PR-02 서버 전용 OpenRouter AI 이미지 생성 API

검증 기준일: 2026-08-22
기준 commit: `2242098bebceb7a182c3344d2d29e91e2af4fd1a`

## 1. 목적과 범위

PR-02는 PR-01의 이미지 자산 및 generation audit foundation 위에 서버 전용 이미지 생성 계층을 추가한다. 프롬프트만 사용하는 T2I와 순서가 보존된 내부 자산 기반 I2I를 동일 API에서 처리하고, 요청 전에 PostgreSQL audit을 만든 뒤 bounded in-process task가 OpenRouter 호출, 결과 검증, 원자적 파일 저장과 terminal 상태 기록을 수행한다.

포함 범위:

- 정적 모델 capability API
- board ACL이 적용된 202 generation API와 polling 상태 API
- ordered `reference_asset_uids` 기반 I2I
- `/api/v1/images` 전용 OpenRouter adapter
- 내부 asset content 조회
- PostgreSQL durable idempotency
- bounded background task, shutdown drain/cancel, restart reconciliation
- 결과 raster 검증과 content-addressed 저장
- provider request ID, usage, cost, latency 및 sanitized failure audit

제외 범위:

- 캔버스 generator node UI와 edge 해석
- legacy data URL 및 기존 upload의 `image_asset` 자동 등록
- 결과 canvas node 생성과 실시간 collab 이벤트
- 관리자 설정과 DB credential 저장
- 자동 provider retry, durable queue, 복잡한 quota 정책
- 시나리오 분석, shot 분해, storyboard 생성

## 2. 조사 및 선행조건

PR-01은 `main`에 squash merge되어 있으며 다음 계약을 실제 코드와 PostgreSQL 테스트에서 확인했다.

- `build/schema.sql`: `image_asset`, `image_generation_run`, `image_generation_attempt`, `image_generation_reference`
- `backend/topix/image_generation/models.py`: raster MIME allowlist, raw storage-key 검증, `retryable`, credential-free provider 계약
- `backend/topix/image_generation/capabilities.py`: T2I/I2I mode와 3/1/14 reference 제한의 fail-closed 검증
- `backend/topix/store/postgres/image_generation.py`: run/attempt 분리, batch reference snapshot, terminal transition guard
- `backend/topix/image_generation/config.py`: 기존 `OpenRouterConfig`를 사용하는 `require_openrouter_api_key()`
- `backend/test/integration/image_generation/`: clean schema, idempotent apply, PR-01 upgrade, 상태 전이와 cross-board FK 검증
- `reference_node_uid`는 nullable이며 asset ID만으로 ordered snapshot을 기록할 수 있다.

재사용 지점:

- `OPENROUTER_BASE_URL`, `OpenRouterConfig`, `require_openrouter_api_key`
- app lifespan의 shared PostgreSQL pool과 store open/close 관례
- `ImageGenerationStore`, capability registry, provider domain 계약
- `get_current_user_uid`, `verify_board_member_can_edit`, `verify_board_read_access`, 기존 `rate_limiter`
- `GraphStore._snapshot_tasks`의 semaphore/strong task set/done callback/shutdown drain 패턴
- `DATADIR`은 storage root로만 재사용한다. `get_file_path()`는 `file:///data/...` representation도 받으므로 opaque relative `storage_key` resolver로 직접 재사용하지 않는다.

기존 `backend/topix/agents/image/gen.py`는 `/chat/completions`와 `image_config`를 사용하고 요청마다 client를 생성한다. 새 경로에서는 재사용하거나 연결하지 않는다.

## 3. 공식 provider 계약 검증

확인한 공식 자료:

- OpenRouter Image Generation: <https://openrouter.ai/docs/guides/overview/multimodal/image-generation>
- Image models API: <https://openrouter.ai/api/v1/images/models>
- Per-endpoint API: <https://openrouter.ai/docs/api/api-reference/images/list-image-model-endpoints>
- xAI Imagine: <https://docs.x.ai/developers/model-capabilities/imagine>
- Microsoft MAI Image: <https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-image>
- Google Gemini image generation: <https://ai.google.dev/gemini-api/docs/image-generation>

2026-08-22의 public OpenRouter metadata 결과:

| 모델 | 입력 | references | resolution | aspect ratio/quality | n |
|---|---|---:|---|---|---:|
| `x-ai/grok-imagine-image-2.0` | text,image | 0–3 | 1K,2K | PR-01 registry와 일치 / low,medium | 1 |
| `microsoft/mai-image-2.5-pro` | text,image | 0–1 | descriptor 없음 | PR-01 aspect ratio와 일치 / quality 없음 | 1 |
| `google/gemini-3-pro-image` | text,image | 0–14 | union 1K,2K,4K | PR-01 registry와 일치 / quality 없음 | 1 |

Gemini endpoint 차이:

- `google-vertex/global`: 1K, 2K
- `google-ai-studio/global`: 1K, 2K, 4K

OpenRouter 문서는 `provider.only`와 `provider.allow_fallbacks`를 `/api/v1/images`에서 지원하고 endpoint의 `provider_tag`를 pinning 값으로 사용하도록 설명한다. 그러므로 4K 요청은 adapter가 내부적으로 `provider.only=["google-ai-studio/global"]`, `allow_fallbacks=false`를 추가한다. 이 pinning을 제거하거나 metadata가 달라지면 4K는 fail-closed해야 한다. client가 provider routing 옵션을 직접 전달할 수는 없다.

공통 요청/응답 계약:

- `POST https://openrouter.ai/api/v1/images`
- `resolution`, `aspect_ratio`, `quality`, `n`은 top-level field
- references는 `input_references[].image_url.url`의 서버 생성 base64 data URL
- `output_format`은 세 endpoint metadata에 없으므로 전송하지 않음
- buffered response는 `data[].b64_json`, 선택적 `media_type`, `usage.cost`를 포함
- `X-Generation-Id`가 있으면 provider request ID로 저장
- timeout은 upstream 처리 여부를 확정할 수 없으므로 자동 재호출하지 않음
- raw error body는 DB, 로그, API에 전달하지 않음

live metadata 조회는 CI나 startup dependency로 만들지 않는다. registry는 서버 allowlist이고 수동 검증 결과와 날짜만 문서에 남긴다.

## 4. API 계약

경로:

- `GET /image-models`
- `POST /boards/{graph_id}/image-generations`
- `GET /boards/{graph_id}/image-generations/{generation_uid}`
- `GET /boards/{graph_id}/image-assets/{asset_uid}/content`

POST body는 `extra="forbid"`이며 다음만 받는다.

```json
{
  "client_request_uid": "b55bd77b-3c73-4be9-b698-b773842c7428",
  "model_id": "x-ai/grok-imagine-image-2.0",
  "prompt": "Create a cinematic classroom scene",
  "parameters": {
    "aspect_ratio": "16:9",
    "resolution": "1K",
    "quality": "low"
  },
  "reference_asset_uids": ["asset-a", "asset-b"],
  "generator_node_uid": null
}
```

user/board UID, key/header, URL/data URL/path/storage key, output asset, usage/cost 및 임의 provider option은 받지 않는다. `reference_asset_uids`는 list 순서를 그대로 fingerprint, snapshot, provider request에 사용한다.

POST는 최초 생성과 동일 idempotent 재요청 모두 202를 반환한다. 응답은 `generation_uid`와 현재 `status`만 포함한다. 같은 idempotency key의 다른 fingerprint는 409다.

상태 응답은 generation UID, status, model ID, 시작/완료 시각, output asset UID, 안전한 content URL, sanitized error code/message만 노출한다. storage key, 경로, provider body, base64, request headers와 stack trace는 노출하지 않는다.

권한:

- POST: 인증 + `verify_board_member_can_edit` + 기존 rate limiter
- generation/asset GET: 인증 + `verify_board_read_access`
- reference asset은 `(asset_uid, board_uid)`로만 조회하고 missing/cross-board를 동일한 404 계열로 처리
- optional `generator_node_uid`가 있으면 Qdrant node 존재와 `graph_uid` 일치를 검사
- PR-02 API는 reference node UID를 받거나 생성하지 않음

## 5. DB와 idempotency

`image_generation_run`에 다음을 forward-only로 추가한다.

- `client_request_uid TEXT`
- `request_fingerprint TEXT`
- `(user_uid, board_uid, client_request_uid)` unique index
- fingerprint는 lowercase SHA-256 check

기존 PR-01 row에는 `legacy:<generation_uid>`와 고정된 legacy fingerprint를 backfill한 뒤 NOT NULL을 적용한다. 새 run은 store를 통해서만 두 값을 기록한다.

fingerprint canonical JSON에는 exact prompt, model ID, 모든 normalized parameter field, ordered reference asset IDs, nullable generator node UID가 포함된다. key 순서와 JSON whitespace는 고정한다.

동시 start transaction:

1. run을 unique key로 `ON CONFLICT DO NOTHING` 삽입
2. winner만 attempt 1과 ordered snapshots를 삽입하고 `created=true` 반환
3. loser는 committed row를 읽음
4. fingerprint가 같으면 기존 generation/status 반환
5. 다르면 `GenerationIdempotencyConflict`로 409

background task는 `created=true`인 winner만 예약한다. PostgreSQL이 source of truth이고 Redis는 idempotency에 사용하지 않는다.

추가 store query:

- board-scoped ordered asset metadata 조회
- generation status 조회
- asset metadata 조회
- startup 이전의 `started`/`retryable` run reconciliation

## 6. 생성 상태 흐름

```text
POST winner
  -> run started + attempt 1 started + snapshots (transaction)
  -> 202
  -> bounded task
     -> success: file atomic write
        -> output asset + attempt succeeded + run succeeded (transaction)
     -> failure: attempt failed (preserved)
        -> run retryable
        -> automatic retry 없이 즉시 run failed
```

provider 호출 중 PostgreSQL transaction을 열지 않는다. timeout도 동일 attempt를 자동 재호출하지 않는다. 명시적 사용자 retry는 후속 PR이다.

startup에서 15분 grace보다 오래된 `started`는 started attempt를 `worker_lost`로 실패시키고 run을 terminal failed로 만든다. `retryable`은 기존 failed attempt를 보존하면서 run을 terminal failed로 만든다. grace는 동시에 시작 중인 다른 backend process의 정상 task를 즉시 실패시키지 않기 위한 최소 방어이며 durable lease가 아니다.

## 7. Storage와 이미지 검증

`backend/topix/image_generation/storage.py`는 opaque relative storage key만 해석한다.

- root: 기존 `DATADIR`
- raw absolute path, URL, 빈/`.`/`..` segment, 반복 slash, backslash 거부
- resolved path가 root 밖이거나 symlink escape이면 거부
- existing regular file만 읽음
- 외부 응답과 오류에 storage key/absolute path를 넣지 않음

Reference 사전 검증:

- capability reference count
- 각 DB byte size 20 MiB 이하
- 총 raw bytes 100 MiB 이하
- PNG/JPEG/WebP만 허용
- 같은 board

읽은 뒤 실제 bytes 길이, SHA-256, raster signature/MIME, width/height를 immutable snapshot과 대조한다. order를 정렬하거나 set으로 바꾸지 않는다.

Provider response 검증:

- JSON response 30 MiB 상한
- `data`와 정확한 output count
- encoded/decoded byte 상한과 strict base64
- PNG/JPEG/WebP signature 및 Pillow 구조 검증
- media_type과 실제 bytes 일치
- width/height 양수, pixel 수 40M 이하
- SVG, GIF, AVIF, HTML/XML 및 decompression-bomb성 입력 거부
- SHA-256 계산

결과 key는 `images/generated/{generation_uid}/{sha256}.{ext}`다. 같은 filesystem의 temporary file에 write/flush/fsync 후 atomic replace한다. 파일 저장 후 DB success transaction이 실패하면 best-effort 삭제하고 run을 안전하게 실패시킨다.

## 8. OpenRouter adapter와 HTTP client

app lifespan에서 하나의 `httpx.AsyncClient`를 만든다.

- base URL은 기존 `OPENROUTER_BASE_URL`
- redirect 비허용
- connect/read/write/pool timeout 명시
- client close는 image task manager 종료 후 수행

adapter는 `SecretStr` 또는 기존 fail-closed helper로 server key를 얻는다. provider domain request에는 credential/header/path/URL field가 없다. adapter는 prompt, base64, header, raw body를 로그하지 않는다.

adapter가 만드는 safe 오류:

- `provider_timeout`
- `provider_rate_limited`
- `provider_unavailable`
- `provider_rejected`
- `invalid_provider_response`

storage/service가 만드는 safe 오류:

- `reference_asset_unavailable`
- `reference_content_mismatch`
- `result_persist_failed`
- `worker_lost`

## 9. Background task 안전장치

`ImageGenerationTaskManager`는 process-local semaphore, generation UID set과 강한 task reference set을 가진다. `schedule()`은 같은 process에서 같은 generation을 두 번 예약하지 않는다. done callback은 task를 제거하고 예외를 회수하되 exception 문자열이나 request data를 로그하지 않는다.

shutdown은 새 예약을 막고 task를 제한 시간 drain한 뒤 남은 task를 cancel/await한다. cancel path는 가능한 경우 `worker_lost` audit을 기록한다. 여러 backend worker에서는 semaphore가 process별이라는 한계를 문서화한다. DB idempotency는 worker 수와 무관하게 generation/task winner를 하나로 제한하지만 전체 동시 provider 호출 수의 cluster-wide 제한은 durable queue 전까지 제공하지 않는다.

## 10. 변경 예상 파일

신규:

- `backend/topix/image_generation/providers/openrouter.py`
- `backend/topix/image_generation/storage.py`
- `backend/topix/image_generation/service.py`
- `backend/topix/image_generation/tasks.py`
- `backend/topix/api/router/image_generation.py`
- `backend/topix/api/datatypes/image_generation.py`
- adapter/storage/service/task unit tests
- API/PostgreSQL integration tests

수정:

- `backend/topix/api/app.py`: store/client/service/task/router composition과 shutdown
- `backend/topix/image_generation/models.py`: idempotency/result/query contracts와 output validator constants
- `backend/topix/image_generation/capabilities.py`: 공식 검증 날짜 및 Gemini endpoint pin metadata
- `backend/topix/store/image_generation.py`
- `backend/topix/store/postgres/image_generation.py`
- `build/schema.sql`
- `backend/pyproject.toml`, `backend/uv.lock`: direct Pillow dependency
- `Makefile`, 필요 시 CI image integration target 범위
- `docs/architecture.md`

`webui/**`, legacy `gen.py`, `models.yml`, 기존 upload/file route는 수정하지 않는다.

## 11. 테스트 계획

Unit:

- T2I/I2I capability와 3/1/14 limit, no truncation
- OpenRouter payload shape, reference order/data URL, top-level options, no `output_format`
- Gemini 4K endpoint pinning
- strict response/base64/MIME/pixel/size 검증
- timeout/network/429/4xx/5xx/malformed response의 sanitized error
- secret/header/prompt/base64/raw body 비로깅
- storage traversal/symlink escape, content mismatch, atomic write/cleanup
- task dedup, semaphore, callback, shutdown
- fingerprint order/normalization

PostgreSQL/API integration:

- clean schema, double apply, PR-01 upgrade/backfill/data preservation
- auth, owner/member/viewer/read ACL
- missing/cross-board asset와 ordered snapshots
- 202/status/content
- started→succeeded, started→attempt failed→run failed
- output asset 및 usage/cost/request ID/latency
- 동일 idempotency reuse, fingerprint mismatch 409, 실제 concurrent winner 1개
- file save 및 DB finalize failure cleanup
- stale started/retryable reconciliation
- DB/API/log/fixture secret 비노출

Regression:

- backend Ruff와 전체 unit suite
- image PostgreSQL integration
- Node 20 `make lint-ui`, `make test-ui`, 가능한 `make check`
- `git diff --check`

OpenRouter generation은 unit/integration/CI에서 호출하지 않는다. public metadata GET은 조사 시점 수동 검증일 뿐 runtime/CI dependency가 아니다. Playwright/Tauri가 로컬 `make check`에 포함되지 않으면 GitHub CI로 확인하고 PR에 기록한다.

## 12. Rollback과 후속 작업

Rollback은 PR revert로 router/lifespan/provider 실행 경로를 제거한다. 이미 적용된 schema columns, audit rows와 generated assets는 파괴적으로 삭제하지 않는다. 생성된 파일은 DB asset row와 함께 보존하며 별도 검토 없이 volume cleanup을 수행하지 않는다.

PR-03/PR-04/PR-05 후속:

- PR-03: generator node UI가 optional `generator_node_uid`를 제공
- PR-04: canvas edge에서 node→asset authorization 및 legacy upload normalization
- PR-05: output asset으로 canvas node/edge를 생성하고 `output_node_uid` 기록
- 후속 운영 PR: explicit user retry, cluster-wide concurrency, durable queue, orphan reconciliation/cleanup, 관리자 usage UI

Upstream 충돌 위험은 `app.py`, `build/schema.sql`, `Makefile`, workflow에 집중된다. 새 기능은 `topix/image_generation`과 전용 router에 격리하고 공용 파일 변경은 composition 및 additive DDL로 제한한다.
