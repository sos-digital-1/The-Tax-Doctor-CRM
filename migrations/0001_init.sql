CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STAFF',           -- ADMIN | MANAGER | STAFF
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Proprietorship',
  contact_person TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'West Bengal',
  pincode TEXT,
  pan TEXT,
  gstin TEXT,
  tan TEXT,
  cin TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_customers_phone ON customers(phone);

CREATE TABLE services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,                 -- ANNUAL | RECURRING | ONE_TIME
  frequency TEXT NOT NULL DEFAULT 'ONCE', -- MONTHLY | QUARTERLY | YEARLY | BIENNIAL | ONCE
  due_day INTEGER,                        -- recurring: day of month (0 = month end)
  period_offset INTEGER NOT NULL DEFAULT 1, -- recurring: 1 = work is for previous month
  renew_rule TEXT,                        -- annual: MAR31 | ACTUAL
  renew_months INTEGER,                   -- annual: 12 or 24
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- a customer's enrolment in an annual or recurring service
CREATE TABLE customer_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | PAUSED | ENDED
  next_due TEXT,                          -- annual: next renewal / due date
  due_day INTEGER,                        -- recurring override
  assigned_to INTEGER REFERENCES users(id),
  fee REAL,
  reg_no TEXT,                            -- licence / registration number
  notes TEXT,
  reminded_for TEXT,                      -- next_due value we already reminded for
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (customer_id, service_id)
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id),
  customer_service_id INTEGER REFERENCES customer_services(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'CUSTOM', -- ANNUAL | RECURRING | ONE_TIME | CUSTOM
  period_key TEXT,                         -- recurring de-dupe key e.g. 2026-11
  period_label TEXT,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'NORMAL', -- LOW | NORMAL | HIGH | URGENT
  status TEXT NOT NULL DEFAULT 'OPEN',     -- OPEN | IN_PROGRESS | WAITING_CLIENT | REVIEW | DONE
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE UNIQUE INDEX idx_tasks_period ON tasks(customer_service_id, period_key) WHERE period_key IS NOT NULL;
CREATE INDEX idx_tasks_status ON tasks(status, due_date);
CREATE INDEX idx_tasks_customer ON tasks(customer_id);

CREATE TABLE task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE doc_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'REQUESTED', -- REQUESTED | SUBMITTED | ACCEPTED | CANCELLED
  last_reject_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  request_id INTEGER REFERENCES doc_requests(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  r2_key TEXT,
  size INTEGER,
  mime TEXT,
  sha256 TEXT,
  source TEXT NOT NULL,                    -- STAFF | CUSTOMER
  status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | ACCEPTED | REJECTED
  note TEXT,
  reject_reason TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_documents_customer ON documents(customer_id, status);

CREATE TABLE portal_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_used_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE portal_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW',      -- NEW | DONE
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'GENERAL',
  status TEXT NOT NULL,                    -- SENT | FAILED | LOGGED (no mail provider configured)
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  actor TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
