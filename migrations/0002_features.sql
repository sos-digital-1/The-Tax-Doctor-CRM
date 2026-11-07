-- per-user permission overrides, relationship manager, service months
ALTER TABLE users ADD COLUMN permissions TEXT;                -- JSON {"grant":[...],"deny":[...]}
ALTER TABLE customers ADD COLUMN assigned_to INTEGER REFERENCES users(id);
ALTER TABLE services ADD COLUMN months TEXT;                  -- quarterly/half-yearly: months the work falls due e.g. "6,9,12,3"
ALTER TABLE tasks ADD COLUMN batch TEXT;                      -- free label for grouping e.g. a filing batch

CREATE TABLE task_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_checklist_task ON task_checklist(task_id);

-- internal chat
CREATE TABLE chat_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  kind TEXT NOT NULL DEFAULT 'CHANNEL',     -- CHANNEL | DM
  dm_key TEXT UNIQUE,                       -- "3-7" for direct messages
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE chat_members (
  channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_messages ON chat_messages(channel_id, id);

-- notifications (in-app + web push)
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  pushed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notif_user ON notifications(user_id, read, id);
CREATE INDEX idx_notif_customer ON notifications(customer_id, read, id);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- billing
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  gst_rate REAL NOT NULL DEFAULT 18,
  subtotal REAL NOT NULL DEFAULT 0,
  gst_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID',     -- UNPAID | PARTIAL | PAID | CANCELLED
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_invoices_customer ON invoices(customer_id, status);
CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount REAL NOT NULL
);
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  paid_on TEXT NOT NULL,
  method TEXT,
  reference TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- credentials vault (secrets are AES-GCM encrypted by the Worker)
CREATE TABLE vault (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT,
  username TEXT,
  secret_enc TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- default company-wide channel
INSERT INTO chat_channels (name, kind) VALUES ('general', 'CHANNEL');
INSERT INTO chat_members (channel_id, user_id) SELECT 1, id FROM users;

-- GST is now two services (GSTR-1 on the 11th, GSTR-3B on the 20th); the seed script adds them.
UPDATE services SET active = 0, description = 'Replaced by GSTR-1 and GSTR-3B' WHERE name = 'GST Return';
