-- Super Admin can set the default access for a whole role (Manager / Staff). Per-user overrides still apply on top.
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT PRIMARY KEY,
  perms TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
