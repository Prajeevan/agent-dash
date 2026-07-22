-- Agent Dash schema. One human, many agents. An inbox, not an archive.

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,          -- ULID, time-sortable
  agent       TEXT NOT NULL,             -- free-form label: "claude-code", "research-bot"
  task_id     TEXT,                      -- groups an agent run's events into one thread
  kind        TEXT NOT NULL,             -- 'update' | 'question' | 'done' | 'error'
  title       TEXT NOT NULL,
  blocks      TEXT NOT NULL DEFAULT '[]',-- JSON array of validated UI blocks
  priority    INTEGER NOT NULL DEFAULT 0,-- 0 info, 1 notify, 2 urgent
  created_at  INTEGER NOT NULL,          -- epoch ms
  read_at     INTEGER,                   -- epoch ms, null = unread
  expires_at  INTEGER NOT NULL           -- epoch ms, cron deletes past this
);

CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_task    ON events (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_expires ON events (expires_at);

CREATE TABLE IF NOT EXISTS questions (
  event_id    TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'answered' | 'expired'
  answer      TEXT,                      -- JSON: form values or chosen button
  answered_at INTEGER,
  timeout_at  INTEGER NOT NULL           -- epoch ms; past this, cron marks 'expired'
);

CREATE INDEX IF NOT EXISTS idx_questions_status ON questions (status, timeout_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,          -- ULID
  endpoint    TEXT NOT NULL UNIQUE,
  keys        TEXT NOT NULL,             -- JSON { p256dh, auth }
  created_at  INTEGER NOT NULL
);

-- Single-row key/value bag for dashboard settings (quiet hours, epoch, etc).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
