-- Richer attribution so a card reads like:
--   Project: Weather app · claude-opus-4.8
--   Current task: Adding children mode
--   "Please choose which color scheme…"   [tags]
--
-- project/task/model/tags are display + filter fields. task_id stays the
-- grouping/thread key used for in-place updates.
ALTER TABLE events ADD COLUMN project TEXT;
ALTER TABLE events ADD COLUMN task TEXT;
ALTER TABLE events ADD COLUMN model TEXT;
ALTER TABLE events ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_events_project ON events (project, created_at DESC);
