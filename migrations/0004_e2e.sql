-- Opt-in end-to-end encryption. When enc=1, `blocks` (and a question's stored
-- `answer`) hold ciphertext the server cannot read — encrypted by the agent /
-- the human's device with a key the server never sees. Title/project/task stay
-- plaintext metadata so grouping, routing and notifications keep working.
ALTER TABLE events ADD COLUMN enc INTEGER NOT NULL DEFAULT 0;
