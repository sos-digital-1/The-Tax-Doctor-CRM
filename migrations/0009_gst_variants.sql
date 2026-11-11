-- GSTR-1 and GSTR-3B each come as Monthly or Quarterly (QRMP). Existing enrolments keep working: they become the Monthly ones.
UPDATE services SET name = 'GSTR-1 (Monthly)', description = 'Outward supplies return, filed every month - due 11th of the next month.' WHERE name = 'GSTR-1';
UPDATE services SET name = 'GSTR-3B (Monthly)', description = 'Summary return and tax payment, every month - due 20th of the next month.' WHERE name = 'GSTR-3B';
-- Quarterly: Jan-Mar is filed in April, Apr-Jun in July, Jul-Sep in October, Oct-Dec in January (GSTR-1 on the 11th, GSTR-3B on the 20th).
INSERT OR IGNORE INTO services (name, category, frequency, due_day, period_offset, months, description)
  VALUES ('GSTR-1 (Quarterly)', 'RECURRING', 'QUARTERLY', 11, 1, '4,7,10,1', 'Outward supplies return, filed every quarter - due 11th of April, July, October and January.');
INSERT OR IGNORE INTO services (name, category, frequency, due_day, period_offset, months, description)
  VALUES ('GSTR-3B (Quarterly)', 'RECURRING', 'QUARTERLY', 20, 1, '4,7,10,1', 'Summary return and tax payment, every quarter - due 20th of April, July, October and January.');
