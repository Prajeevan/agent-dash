-- Multi-tenant hosting. Until now the app was single-user: one shared AGENT_KEY
-- and no owner column on any row. Introduce accounts (one per email) and scope
-- all data to an account so a hosted deployment can serve many people, each with
-- their own private inbox and their own agent key.
--
-- Key storage: we NEVER store the raw agent key — only its SHA-256 hash (unique,
-- indexed for bearer lookup) plus a short prefix for display in settings.

CREATE TABLE IF NOT EXISTS accounts (
  id               TEXT PRIMARY KEY,          -- ULID
  email            TEXT NOT NULL UNIQUE,      -- lowercased
  agent_key_hash   TEXT NOT NULL UNIQUE,      -- sha256 hex of the bearer token
  agent_key_prefix TEXT NOT NULL,             -- e.g. "ad_live_a1b2c3" for display
  created_at       INTEGER NOT NULL,          -- epoch ms
  last_login_at    INTEGER                    -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_accounts_key ON accounts (agent_key_hash);

-- Owner column on every tenant-scoped table. Nullable so the ALTER succeeds on
-- an existing single-user DB; all new writes set it, and hosted deployments
-- start empty (fresh DB), so there are no orphan rows to backfill.
ALTER TABLE events ADD COLUMN account_id TEXT;
ALTER TABLE push_subscriptions ADD COLUMN account_id TEXT;

-- Per-account settings bag (quiet hours, etc). Replaces the global `settings`
-- table, which is now unused.
CREATE TABLE IF NOT EXISTS account_settings (
  account_id TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (account_id, key)
);

-- Account-scoped indexes: every hot query filters by account_id first.
CREATE INDEX IF NOT EXISTS idx_events_acct_created ON events (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_acct_project ON events (account_id, project, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_acct_updated ON events (account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_acct           ON push_subscriptions (account_id);
