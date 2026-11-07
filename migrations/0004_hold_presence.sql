-- tickets can be put ON_HOLD with a written reason
ALTER TABLE tasks ADD COLUMN hold_reason TEXT;
ALTER TABLE tasks ADD COLUMN held_at TEXT;
ALTER TABLE tasks ADD COLUMN held_by INTEGER REFERENCES users(id);

-- chat presence (heartbeat from the app while it is open)
ALTER TABLE users ADD COLUMN last_seen TEXT;
