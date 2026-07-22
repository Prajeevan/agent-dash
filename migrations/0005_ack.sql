-- An agent-supplied acknowledgment shown the instant the human answers a
-- question, e.g. "Got it — proceeding with {answer}. Watch for updates." The
-- {answer} placeholder is filled in with the chosen value on the client.
ALTER TABLE events ADD COLUMN ack TEXT;
