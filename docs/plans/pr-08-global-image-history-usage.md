# PR-08: 전체 AI 이미지 기록·사용량

## 목적

로그인한 Dim0 사용자가 `/image-history`에서 모든 사용자의 서버 이미지 생성 기록, creator, prompt, 참조·결과 이미지, provider-reported 비용과 usage를 읽는 전역 read-only 화면을 제공한다. 이 기능은 관리자 화면이나 billing ledger가 아니다.

## 전체 로그인 사용자 공개 정책

- 인터넷 전체 공개가 아니라 인증된 Dim0 사용자 전체 공개다.
- private board에서 생성된 prompt와 private board 이름도 모든 로그인 사용자에게 보인다.
- 참조 이미지는 사용자가 직접 업로드한 사진일 수 있으며, 해당 원본 바이트도 모든 로그인 사용자에게 보인다.
- 생성 결과 원본과 안전하게 저장된 provider 오류도 모든 로그인 사용자에게 보인다.
- 현재 기록별 opt-out, 삭제 또는 비공개 전환 기능은 없다.
- 실수로 공개한 기록을 사용자가 직접 제거하는 기능은 이번 범위에 없다.
- synced Image Generator는 Generate 버튼 근처에 `이 보드에서 생성한 프롬프트, 결과 및 참조 이미지는 로그인한 모든 사용자에게 공개됩니다.`라는 고정 안내를 표시한다. 안내 표시 자체는 generation POST를 발생시키지 않는다.

이 정책은 명시적인 제품 결정이다. admin allowlist, 이메일 기반 운영자 판별, 조직·강의 역할, 현재 사용자 전용 필터 또는 board membership ACL로 축소하지 않는다.

## 기존 데이터와 creator

새 테이블은 만들지 않는다. 다음 PostgreSQL 테이블이 authoritative source다.

- `users`
- `graphs`
- `image_generation_run`
- `image_generation_attempt`
- `image_generation_reference`
- `image_asset`

Creator는 `image_generation_run.user_uid`와 `users.uid`의 join으로 결정한다. API는 `uid`, 고유 `username`, 선택적인 `name`만 반환한다. email, password hash, Google subject, auth provider 세부정보와 billing identifier는 반환하지 않는다. FK가 `ON DELETE RESTRICT`이므로 고아 creator fallback은 만들지 않는다.

## API

모든 endpoint는 인증을 요구하고 JSON 및 byte 응답에 `Cache-Control: private, no-store`를 사용한다.

### `GET /image-history/summary`

전체와 사용 이력이 있는 사용자별로 다음을 동일한 SQL status/cost/usage 정의로 집계한다.

- generation, succeeded, failed, active 수
- 전체 attempt, 비용 보고 attempt, 비용 미보고 attempt 수
- provider-reported known cost 합계
- provider-reported input/output/total units와 generated images

`active`는 `started` 또는 `retryable`이다. 비용은 사용자 청구액, credit 또는 invoice가 아니다.

### `GET /image-history`

- 기본 limit 25, 최대 50
- `user_uid`, `status` 선택 필터
- `ORDER BY started_at DESC, uid DESC`
- `limit + 1` keyset pagination과 opaque versioned base64url cursor
- cursor timestamp는 timezone-aware datetime, UID는 정확한 32자리 lowercase hex
- 현재 요청의 필터를 cursor와 독립적으로 parameter binding
- run page를 먼저 고른 뒤 attempt 집계와 ordered reference를 각각 batch 조회
- attempt와 reference를 raw join하지 않아 행 증식과 비용 중복을 방지

Run별 cost와 usage는 실패 후 성공한 재시도를 포함한 모든 attempt의 합계다. retryable 오류는 최신 completed failed attempt의 저장된 safe message를 사용하고, failed run은 run의 safe error를 사용한다.

### `GET /image-history/{generation_uid}/assets/{asset_uid}/content`

로그인 사용자는 generation의 `output_asset_uid` 또는 ordered reference asset만 읽을 수 있다. generation과 asset의 board 관계를 SQL에서 확인한 뒤 기존 confined storage byte/MIME/hash/size 검증을 재사용한다. 관계없는 asset과 다른 generation/asset 조합은 404다. storage key, arbitrary URL, filesystem path와 data URL은 입력이나 응답에 노출하지 않는다. 응답은 원본 MIME·bytes와 `X-Content-Type-Options: nosniff`를 사용한다.

## usage와 비용 계약

`ProviderUsage.model_dump(mode="json", exclude_none=True)`가 저장 계약이다.

- 실제 JSON key는 `input_units`, `output_units`, `total_units`, `generated_images`다.
- 미보고 필드는 key 자체가 없고 모든 필드가 미보고면 usage는 `'{}'::jsonb`다.
- usage 집계에 `COALESCE(..., 0)`을 사용하지 않는다. 모두 미보고면 API 값은 `null`이다.
- 실제로 보고된 `0`은 숫자 0이며 미보고와 다르다.
- `generated_images`는 asset 행 수가 아니라 provider가 보고한 값이다.
- `cost_usd IS NULL`은 `$0`이 아니다. 알려진 cost만 합산하고 미보고 attempt 수를 별도로 반환한다.
- 모든 cost가 미보고면 합계는 `null`, 실제 보고된 0은 문자열 Decimal `"0"` 계열 값이다.
- Decimal 합계는 서버가 수행하고 API는 문자열로 직렬화한다. frontend는 비용을 다시 합산하지 않는다.

## board 표시

`graphs`를 PostgreSQL에서 직접 join하며 Qdrant를 조회하지 않는다.

- soft-deleted board는 stale label을 반환하지 않고 `name=null`, `deleted=true`다. UI는 `삭제된 보드`로 표시한다.
- active board의 NULL·빈 label은 `name=null`, `deleted=false`다. UI는 `이름 없는 보드`로 표시한다.
- active private label은 공개 정책에 따라 모든 로그인 사용자에게 표시한다.

## frontend

- `requireVerifiedAuth`가 적용된 `/image-history` 경로
- 로그인 사용자 WORKSPACE 영역의 `AI 이미지 기록` 메뉴
- 전체 요약과 사용자별 표
- 모든 사용자/user/status 필터; 필터 변경 시 query key가 바뀌어 cursor page가 초기화
- 최신순 카드와 `더 보기` 버튼
- 전체 prompt를 확인할 수 있는 접힘 영역
- 결과와 ordinal reference thumbnail; duplicate asset ordinal을 deduplicate하지 않음
- 인증 갱신을 포함하는 Blob GET, AbortController, bounded deadline/retry, stale response 차단, object URL revoke
- viewport 근처에서만 thumbnail 요청하고 실패 시 안전한 placeholder
- generation/provider/canvas/delete/retry/quota/billing mutation이 없는 read-only 화면

## 인덱스와 규모 한계

새 schema 객체는 pagination index 두 개뿐이다.

```sql
CREATE INDEX IF NOT EXISTS idx_image_generation_run_history_started_uid
ON image_generation_run(started_at DESC, uid DESC);

CREATE INDEX IF NOT EXISTS idx_image_generation_run_history_user_started_uid
ON image_generation_run(user_uid, started_at DESC, uid DESC);
```

기존 attempt `UNIQUE (generation_uid, attempt_number)`와 reference `PRIMARY KEY (generation_uid, ordinal)`를 재사용하며 중복 인덱스를 만들지 않는다.

Summary는 classroom/homelab의 수천~수만 generation/attempt를 위한 on-demand 집계다. 수십만~수백만 행 규모를 위한 정밀 SLA를 약속하지 않는다. 실제 query latency가 문제가 될 때 materialized aggregate 또는 billing ledger를 후속 검토하며, 이번 PR은 cache, Redis, background worker를 추가하지 않는다.

## 제외 범위

- admin/teacher/organization/course 역할과 allowlist
- quota, billing ledger, credit, invoice
- chart, CSV, 검색, 날짜·모델 상세 필터
- generation 삭제·재생성·실시간 갱신
- background aggregation, Redis cache, 별도 analytics 서비스
- 공개 opt-out, 기록 삭제와 비공개 전환

## 검증

- 비인증 401과 private board 비회원의 전역 조회
- creator identity와 email·내부 필드 비노출
- 네 status, user/status 필터와 summary 정의 일치
- 동일 timestamp cursor pagination, invalid cursor, 최대 limit와 마지막 page
- 모든 retry attempt cost/usage 합산과 NULL/0 구분
- ordered duplicate references, output metadata, deleted/unnamed board
- generation-scoped output/reference bytes와 관계없는 asset 404
- JSON/byte no-store 및 byte nosniff
- authenticated lazy Blob 수명주기와 public notice의 POST 0회
- Node 20 frontend, 격리 PostgreSQL backend, Playwright/Tauri/전체 저장소 검증
- 외부 provider 호출 0회
