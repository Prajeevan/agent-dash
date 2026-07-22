-- Delivery receipt: when the agent next polls and receives the answer, we stamp
-- picked_up_at. The phone shows "waiting for the agent…" until then, then
-- flips to "agent received it".
ALTER TABLE questions ADD COLUMN picked_up_at INTEGER;
