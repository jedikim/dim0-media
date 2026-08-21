-- Schema is idempotent: applied on first postgres init AND re-applied on every
-- backend startup. Keep all changes additive: CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
-- Non-additive changes (renames, type changes) need a separate one-off step.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    uid TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    auth_provider TEXT NOT NULL DEFAULT 'local' CHECK (auth_provider IN ('local', 'google', 'local_google')),
    google_sub TEXT UNIQUE,
    google_email TEXT,
    google_picture_url TEXT,
    google_linked_at TIMESTAMP,
    email_verified_at TIMESTAMP,
    password_changed_at TIMESTAMP,
    name TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid);


INSERT INTO users (uid, email, username, name, password_hash)
VALUES ('root', 'root@root.ai', 'root', 'Root User', 'RandomHash')
ON CONFLICT (uid) DO NOTHING;


CREATE TABLE IF NOT EXISTS graphs (
    id SERIAL PRIMARY KEY,
    uid TEXT NOT NULL UNIQUE,
    label TEXT,
    format_version INT NOT NULL DEFAULT 1,
    readonly BOOLEAN NOT NULL DEFAULT FALSE,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
    thumbnail TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_graphs_uid ON graphs(uid);


CREATE TABLE IF NOT EXISTS graph_user (
    id SERIAL PRIMARY KEY,
    graph_id INT NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'viewer' added 2026-05-28 for board sharing. Older self-hosted
    -- DBs pick this up via the ALTER block further down.
    role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (graph_id, user_id)
);


-- Owner-minted invitations that grant role on consume. Two-table split
-- between graph_share_link (invitations) and graph_user (memberships)
-- — see sharing-archi.md §4.2.
CREATE TABLE IF NOT EXISTS graph_share_link (
    token       TEXT PRIMARY KEY,
    graph_id    INT NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('member', 'viewer')),
    created_by  INT NOT NULL REFERENCES users(id),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    revoked_at  TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_graph_share_link_graph_active
    ON graph_share_link(graph_id) WHERE revoked_at IS NULL;


CREATE TABLE IF NOT EXISTS chats (
    id SERIAL PRIMARY KEY,
    uid TEXT NOT NULL UNIQUE,
    label TEXT,
    user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    graph_uid TEXT REFERENCES graphs(uid) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chats_uid ON chats(uid);
CREATE INDEX IF NOT EXISTS idx_chats_user_uid ON chats(user_uid);
CREATE INDEX IF NOT EXISTS idx_chats_graph_uid ON chats(graph_uid);


CREATE TABLE IF NOT EXISTS user_billing (
    user_uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'plus')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_billing_plan ON user_billing(plan);
CREATE INDEX IF NOT EXISTS idx_user_billing_status ON user_billing(status);


CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id SERIAL PRIMARY KEY,
    uid TEXT NOT NULL UNIQUE,
    user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_uid ON email_verification_tokens(user_uid);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires_at ON email_verification_tokens(expires_at);


CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    uid TEXT NOT NULL UNIQUE,
    user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_uid ON password_reset_tokens(user_uid);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);


-- Per-user, per-note state for mini-app widgets (see mini-app-archi.md §12).
-- Stores whatever JSON the agent's widget passes to host.saveState().
-- Per-user on purpose: two viewers of the same note may have independent
-- counter values, todo selections, etc.
--
-- note_uid is NOT a foreign key because notes live in the qdrant content
-- store, not in postgres — so on note delete the cleanup happens at the
-- app layer (or rows become harmless orphans).
CREATE TABLE IF NOT EXISTS mini_app_state (
    note_uid TEXT NOT NULL,
    user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    state JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (note_uid, user_uid)
);
CREATE INDEX IF NOT EXISTS idx_mini_app_state_user_uid ON mini_app_state(user_uid);


-- Browser-agent chat transcripts for synced boards: the client is the source of
-- truth and the server stores/returns the transcript verbatim (opaque JSON, no
-- server-side chat model). Backup + cross-device seed only.
CREATE TABLE IF NOT EXISTS chat_transcript (
    chat_uid TEXT NOT NULL,
    user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    -- FK + cascade so transcripts don't outlive their board (matches
    -- chats.graph_uid). Nullable: a null board_id simply skips the constraint.
    board_id TEXT REFERENCES graphs(uid) ON DELETE CASCADE,
    label TEXT,
    transcript JSONB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_uid, user_uid)
);
CREATE INDEX IF NOT EXISTS idx_chat_transcript_board ON chat_transcript (user_uid, board_id);


-- ============================================================================
-- Additive deltas for older self-hosted DBs.
-- For each column added to an existing table after its CREATE TABLE was first
-- shipped, append `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` here so DBs
-- that already have the table get the new column on next backend startup.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;

-- Expand graph_user.role to allow 'viewer' on already-deployed DBs.
-- DROP + ADD because CHECK constraints aren't natively idempotent.
-- The conventional auto-generated name for an inline column CHECK is
-- '<table>_<column>_check'.
ALTER TABLE graph_user DROP CONSTRAINT IF EXISTS graph_user_role_check;
ALTER TABLE graph_user ADD CONSTRAINT graph_user_role_check
    CHECK (role IN ('owner', 'member', 'viewer'));

-- Expand user_billing.plan to allow the 'basic' tier on already-deployed DBs.
ALTER TABLE user_billing DROP CONSTRAINT IF EXISTS user_billing_plan_check;
ALTER TABLE user_billing ADD CONSTRAINT user_billing_plan_check
    CHECK (plan IN ('free', 'basic', 'plus'));


-- BEGIN AI IMAGE GENERATION FOUNDATION
-- Immutable metadata for uploaded, normalized legacy, and generated images.
CREATE TABLE IF NOT EXISTS image_asset (
    id BIGSERIAL PRIMARY KEY,
    uid TEXT NOT NULL UNIQUE,
    board_uid TEXT NOT NULL REFERENCES graphs(uid) ON DELETE RESTRICT,
    created_by_user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE RESTRICT,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('uploaded', 'generated', 'legacy_normalized')),
    storage_key TEXT NOT NULL UNIQUE CONSTRAINT image_asset_storage_key_check CHECK (
        storage_key <> ''
        AND storage_key NOT LIKE '/%'
        AND storage_key NOT LIKE '%://%'
        AND storage_key NOT LIKE '%//%'
        AND storage_key NOT LIKE '%/'
        AND strpos(storage_key, chr(92)) = 0
        AND storage_key !~ '(^|/)\.{1,2}(/|$)'
    ),
    mime_type TEXT NOT NULL CONSTRAINT image_asset_mime_type_check CHECK (
        mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif')
    ),
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (uid, board_uid)
);
CREATE INDEX IF NOT EXISTS idx_image_asset_board_created_at
    ON image_asset(board_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_asset_board_sha256
    ON image_asset(board_uid, content_sha256);


-- One logical generation. Provider attempts are stored separately for retries.
CREATE TABLE IF NOT EXISTS image_generation_run (
    id BIGSERIAL PRIMARY KEY,
    uid TEXT NOT NULL UNIQUE,
    user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE RESTRICT,
    board_uid TEXT NOT NULL REFERENCES graphs(uid) ON DELETE RESTRICT,
    client_request_uid TEXT NOT NULL CHECK (length(btrim(client_request_uid)) > 0),
    request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    worker_uid TEXT NOT NULL DEFAULT ('legacy:' || gen_random_uuid()::text),
    lease_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 hour'),
    generator_node_uid TEXT,
    -- Reserved for the PR-05 canvas result node; intentionally nullable in PR-01.
    output_node_uid TEXT,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prompt TEXT NOT NULL CHECK (length(btrim(prompt)) > 0),
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object'),
    status TEXT NOT NULL CONSTRAINT image_generation_run_status_check
        CHECK (status IN ('started', 'retryable', 'succeeded', 'failed')),
    output_asset_uid TEXT UNIQUE,
    pending_output_storage_key TEXT CONSTRAINT image_generation_run_pending_storage_key_check CHECK (
        pending_output_storage_key IS NULL
        OR (
            pending_output_storage_key LIKE 'images/generated/%'
            AND pending_output_storage_key NOT LIKE '%//%'
            AND strpos(pending_output_storage_key, chr(92)) = 0
            AND pending_output_storage_key !~ '(^|/)\.{1,2}(/|$)'
        )
    ),
    error_code TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (uid, board_uid),
    CONSTRAINT image_generation_run_idempotency_unique
        UNIQUE (user_uid, board_uid, client_request_uid),
    FOREIGN KEY (output_asset_uid, board_uid)
        REFERENCES image_asset(uid, board_uid) ON DELETE RESTRICT,
    CONSTRAINT image_generation_run_lifecycle_check CHECK (
        (status IN ('started', 'retryable')
            AND output_asset_uid IS NULL
            AND error_code IS NULL
            AND error_message IS NULL
            AND completed_at IS NULL)
        OR (status = 'succeeded'
            AND output_asset_uid IS NOT NULL
            AND pending_output_storage_key IS NULL
            AND error_code IS NULL
            AND error_message IS NULL
            AND completed_at IS NOT NULL)
        OR (status = 'failed'
            AND output_asset_uid IS NULL
            AND error_code IS NOT NULL
            AND error_message IS NOT NULL
            AND completed_at IS NOT NULL)
    ),
    CONSTRAINT image_generation_run_ownership_check CHECK (
        status NOT IN ('started', 'retryable')
        OR lease_expires_at IS NOT NULL
    )
);
CREATE INDEX IF NOT EXISTS idx_image_generation_run_board_started_at
    ON image_generation_run(board_uid, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_generation_run_user_started_at
    ON image_generation_run(user_uid, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_generation_run_started_pending
    ON image_generation_run(started_at) WHERE status = 'started';
CREATE INDEX IF NOT EXISTS idx_image_generation_run_retryable
    ON image_generation_run(started_at) WHERE status = 'retryable';
-- Attempt-level provider audit. The initial attempt is inserted with the run.
CREATE TABLE IF NOT EXISTS image_generation_attempt (
    id BIGSERIAL PRIMARY KEY,
    uid TEXT NOT NULL UNIQUE,
    generation_uid TEXT NOT NULL REFERENCES image_generation_run(uid) ON DELETE RESTRICT,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
    provider_request_id TEXT,
    usage JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(usage) = 'object'),
    cost_usd NUMERIC(20, 10) CHECK (cost_usd IS NULL OR cost_usd >= 0),
    latency_ms BIGINT CHECK (latency_ms IS NULL OR latency_ms >= 0),
    error_code TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (generation_uid, attempt_number),
    CHECK (
        (status = 'started'
            AND provider_request_id IS NULL
            AND usage = '{}'::jsonb
            AND cost_usd IS NULL
            AND error_code IS NULL
            AND error_message IS NULL
            AND latency_ms IS NULL
            AND completed_at IS NULL)
        OR (status = 'succeeded'
            AND error_code IS NULL
            AND error_message IS NULL
            AND latency_ms IS NOT NULL
            AND completed_at IS NOT NULL)
        OR (status = 'failed'
            AND error_code IS NOT NULL
            AND error_message IS NOT NULL
            AND latency_ms IS NOT NULL
            AND completed_at IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_image_generation_attempt_provider_request_id
    ON image_generation_attempt(provider_request_id)
    WHERE provider_request_id IS NOT NULL;


-- Ordered, request-time snapshots survive later node edits or deletion. Node
-- association is optional until the canvas integration lands in PR-04.
CREATE TABLE IF NOT EXISTS image_generation_reference (
    generation_uid TEXT NOT NULL,
    board_uid TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    reference_node_uid TEXT,
    asset_uid TEXT NOT NULL,
    asset_snapshot JSONB NOT NULL CHECK (jsonb_typeof(asset_snapshot) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (generation_uid, ordinal),
    UNIQUE (generation_uid, reference_node_uid),
    FOREIGN KEY (generation_uid, board_uid)
        REFERENCES image_generation_run(uid, board_uid) ON DELETE RESTRICT,
    FOREIGN KEY (asset_uid, board_uid)
        REFERENCES image_asset(uid, board_uid) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_image_generation_reference_asset_uid
    ON image_generation_reference(asset_uid);

-- Original PR-01 databases required a canvas node even for asset-only API
-- requests. Dropping NOT NULL is additive, safe, and idempotent.
ALTER TABLE image_generation_reference
    ALTER COLUMN reference_node_uid DROP NOT NULL;


-- PR-02 durable idempotency. Existing foundation rows receive a collision-free
-- legacy request UID; their placeholder fingerprint is never used for a new API
-- request because the UID is derived from the already-created generation.
ALTER TABLE image_generation_run
    ADD COLUMN IF NOT EXISTS client_request_uid TEXT;
ALTER TABLE image_generation_run
    ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
ALTER TABLE image_generation_run
    ADD COLUMN IF NOT EXISTS worker_uid TEXT;
ALTER TABLE image_generation_run
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE image_generation_run
    ADD COLUMN IF NOT EXISTS pending_output_storage_key TEXT;
UPDATE image_generation_run
SET client_request_uid = 'legacy:' || uid
WHERE client_request_uid IS NULL;
UPDATE image_generation_run
SET request_fingerprint = repeat('0', 64)
WHERE request_fingerprint IS NULL;
UPDATE image_generation_run
SET worker_uid = 'legacy:' || uid
WHERE worker_uid IS NULL;
UPDATE image_generation_run
SET lease_expires_at = NOW() + INTERVAL '1 hour'
WHERE status IN ('started', 'retryable')
  AND lease_expires_at IS NULL;
ALTER TABLE image_generation_run
    ALTER COLUMN client_request_uid SET NOT NULL;
ALTER TABLE image_generation_run
    ALTER COLUMN request_fingerprint SET NOT NULL;
ALTER TABLE image_generation_run
    ALTER COLUMN worker_uid SET NOT NULL;
ALTER TABLE image_generation_run
    ALTER COLUMN worker_uid SET DEFAULT ('legacy:' || gen_random_uuid()::text);
ALTER TABLE image_generation_run
    ALTER COLUMN lease_expires_at SET DEFAULT (NOW() + INTERVAL '1 hour');

ALTER TABLE image_generation_run
    DROP CONSTRAINT IF EXISTS image_generation_run_client_request_uid_check;
ALTER TABLE image_generation_run
    ADD CONSTRAINT image_generation_run_client_request_uid_check
    CHECK (length(btrim(client_request_uid)) > 0);
ALTER TABLE image_generation_run
    DROP CONSTRAINT IF EXISTS image_generation_run_request_fingerprint_check;
ALTER TABLE image_generation_run
    ADD CONSTRAINT image_generation_run_request_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'image_generation_run_idempotency_unique'
          AND conrelid = 'image_generation_run'::regclass
    ) THEN
        ALTER TABLE image_generation_run
            ADD CONSTRAINT image_generation_run_idempotency_unique
            UNIQUE (user_uid, board_uid, client_request_uid);
    END IF;
END
$$;


-- Upgrade databases initialized from the original PR-01 schema. DROP + ADD is
-- intentional and idempotent: CREATE TABLE IF NOT EXISTS cannot tighten checks.
ALTER TABLE image_asset DROP CONSTRAINT IF EXISTS image_asset_storage_key_check;
ALTER TABLE image_asset ADD CONSTRAINT image_asset_storage_key_check CHECK (
    storage_key <> ''
    AND storage_key NOT LIKE '/%'
    AND storage_key NOT LIKE '%://%'
    AND storage_key NOT LIKE '%//%'
    AND storage_key NOT LIKE '%/'
    AND strpos(storage_key, chr(92)) = 0
    AND storage_key !~ '(^|/)\.{1,2}(/|$)'
);

ALTER TABLE image_asset DROP CONSTRAINT IF EXISTS image_asset_mime_type_check;
ALTER TABLE image_asset ADD CONSTRAINT image_asset_mime_type_check CHECK (
    mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif')
);

ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_status_check;
ALTER TABLE image_generation_run ADD CONSTRAINT image_generation_run_status_check
    CHECK (status IN ('started', 'retryable', 'succeeded', 'failed'));

-- The original unnamed table-level lifecycle check uses this generated name.
ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_check;
ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_lifecycle_check;
ALTER TABLE image_generation_run ADD CONSTRAINT image_generation_run_lifecycle_check CHECK (
    (status IN ('started', 'retryable')
        AND output_asset_uid IS NULL
        AND error_code IS NULL
        AND error_message IS NULL
        AND completed_at IS NULL)
    OR (status = 'succeeded'
        AND output_asset_uid IS NOT NULL
        AND pending_output_storage_key IS NULL
        AND error_code IS NULL
        AND error_message IS NULL
        AND completed_at IS NOT NULL)
    OR (status = 'failed'
        AND output_asset_uid IS NULL
        AND error_code IS NOT NULL
        AND error_message IS NOT NULL
        AND completed_at IS NOT NULL)
);

ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_pending_storage_key_check;
ALTER TABLE image_generation_run ADD CONSTRAINT image_generation_run_pending_storage_key_check CHECK (
    pending_output_storage_key IS NULL
    OR (
        pending_output_storage_key LIKE 'images/generated/%'
        AND pending_output_storage_key NOT LIKE '%//%'
        AND strpos(pending_output_storage_key, chr(92)) = 0
        AND pending_output_storage_key !~ '(^|/)\.{1,2}(/|$)'
    )
);

ALTER TABLE image_generation_run DROP CONSTRAINT IF EXISTS image_generation_run_ownership_check;
ALTER TABLE image_generation_run ADD CONSTRAINT image_generation_run_ownership_check CHECK (
    status NOT IN ('started', 'retryable')
    OR lease_expires_at IS NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_image_generation_run_expired_lease
    ON image_generation_run(lease_expires_at)
    WHERE status IN ('started', 'retryable');
-- END AI IMAGE GENERATION FOUNDATION
