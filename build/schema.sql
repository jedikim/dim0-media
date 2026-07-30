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
