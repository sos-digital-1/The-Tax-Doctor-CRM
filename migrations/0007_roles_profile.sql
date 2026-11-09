-- Profile details for staff, and a Manager on every customer (assigned_to stays the Relationship Manager).
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN designation TEXT;
ALTER TABLE customers ADD COLUMN manager_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_customers_manager ON customers(manager_id);
CREATE INDEX IF NOT EXISTS idx_customers_rm ON customers(assigned_to);
