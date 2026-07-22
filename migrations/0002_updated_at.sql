-- Support live, in-place updates: an agent can PATCH an event's blocks (e.g. a
-- progress bar) and the dashboard reflects it without a new inbox row.
ALTER TABLE events ADD COLUMN updated_at INTEGER;

-- Backfill existing rows so the feed's timestamp cursor has a value to compare.
UPDATE events SET updated_at = created_at WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_updated ON events (updated_at DESC);
