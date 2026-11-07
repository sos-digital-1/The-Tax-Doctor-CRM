// Usage:
//   node scripts/seed.mjs --local            -> service catalogue + first admin (local D1)
//   node scripts/seed.mjs --local --demo     -> plus demo customers/staff (LOCAL PREVIEW ONLY)
//   node scripts/seed.mjs --remote           -> same as --local but against the deployed Cloudflare D1
// ADMIN_EMAIL / ADMIN_PASSWORD env vars override the defaults. If no password is given, a random one is generated and printed once.
import { webcrypto, randomBytes } from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const demo = args.includes("--demo");
if (remote && demo) {
  console.error("Refusing to load demo data into the remote (production) database.");
  process.exit(1);
}

const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const b64 = (u8) => Buffer.from(u8).toString("base64");

async function hash(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return `${b64(salt)}:${b64(new Uint8Array(bits))}`;
}
const isoDate = (offset) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

const adminEmail = (process.env.ADMIN_EMAIL || "admin@taxdoctor.local").toLowerCase();
const generated = !process.env.ADMIN_PASSWORD;
const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString("base64url");

const services = [
  // name, category, frequency, due_day, period_offset, renew_rule, renew_months, description
  ["Trade License - KMC", "ANNUAL", "YEARLY", null, 1, "MAR31", 12, "Kolkata Municipal Corporation trade licence. Renew by 31 March."],
  ["Trade License - Others", "ANNUAL", "YEARLY", null, 1, "ACTUAL", 12, "Other municipality / panchayat trade licence. Renew on actual expiry date."],
  ["Professional Tax Enrollment", "ANNUAL", "YEARLY", null, 1, "MAR31", 12, "Professional tax enrolment renewal. Renew by 31 March."],
  ["FSSAI", "ANNUAL", "YEARLY", null, 1, "ACTUAL", 12, "FSSAI licence / registration renewal on actual expiry date."],
  ["Income Tax Return", "ANNUAL", "YEARLY", null, 1, "ACTUAL", 12, "Annual income tax return filing."],
  ["ROC Annual Filing (Company / LLP)", "ANNUAL", "YEARLY", null, 1, "ACTUAL", 12, "AOC-4 / MGT-7 for companies, Form 8 / Form 11 for LLPs."],
  ["DSC (Digital Signature)", "ANNUAL", "BIENNIAL", null, 1, "ACTUAL", 24, "Digital signature certificate, valid 2 years."],
  ["P.Tax Registration Annual Return", "ANNUAL", "YEARLY", null, 1, "ACTUAL", 12, "Professional tax registration annual return."],
  ["GSTR-9 / 9C Annual Return", "ANNUAL", "YEARLY", null, 1, "ACTUAL", 12, "Annual GST return and reconciliation - 31 December."],
  ["Tax Audit (3CD)", "ANNUAL", "YEARLY", null, 1, "ACTUAL", 12, "Tax audit report - 30 September."],
  ["Statutory Audit", "ANNUAL", "YEARLY", null, 1, "ACTUAL", 12, "Company / LLP statutory audit."],
  ["Director KYC (DIR-3)", "ANNUAL", "YEARLY", null, 1, "ACTUAL", 12, "Director KYC - 30 September."],
  ["Shops & Establishment Renewal", "ANNUAL", "YEARLY", null, 1, "MAR31", 12, "Shops and establishment licence renewal."],
  ["GST LUT Renewal", "ANNUAL", "YEARLY", null, 1, "MAR31", 12, "Letter of undertaking for exporters - before 31 March."],

  ["GSTR-1", "RECURRING", "MONTHLY", 11, 1, null, null, "Outward supplies return - due 11th. QRMP customers: set due day 13 on their enrolment."],
  ["GSTR-3B", "RECURRING", "MONTHLY", 20, 1, null, null, "Summary return and tax payment - due 20th. QRMP customers: set due day 22 or 24."],
  ["TDS Return", "RECURRING", "QUARTERLY", 31, 1, null, null, "Quarterly TDS return (24Q/26Q) - Jul, Oct, Jan, May.", "5,7,10,1"],
  ["Advance Tax", "RECURRING", "QUARTERLY", 15, 0, null, null, "Advance tax instalments - 15 Jun, Sep, Dec, Mar.", "6,9,12,3"],
  ["TDS Challan", "RECURRING", "MONTHLY", 7, 1, null, null, "Monthly TDS deposit."],
  ["PF Return", "RECURRING", "MONTHLY", 15, 1, null, null, "Monthly PF ECR and payment."],
  ["ESI Return", "RECURRING", "MONTHLY", 15, 1, null, null, "Monthly ESI contribution and return."],
  ["P.Tax Registration Challan", "RECURRING", "MONTHLY", 0, 0, null, null, "Monthly professional tax payment (month end)."],

  ["GST Registration", "ONE_TIME", "ONCE"],
  ["PF Registration", "ONE_TIME", "ONCE"],
  ["ESI Registration", "ONE_TIME", "ONCE"],
  ["Partnership Deed", "ONE_TIME", "ONCE"],
  ["Rent Agreement", "ONE_TIME", "ONCE"],
  ["Other Agreement", "ONE_TIME", "ONCE"],
  ["PAN Card", "ONE_TIME", "ONCE"],
  ["Udyam (MSME) Registration", "ONE_TIME", "ONCE"],
  ["LLP Incorporation", "ONE_TIME", "ONCE"],
  ["Private Limited Company Incorporation", "ONE_TIME", "ONCE"],
  ["PF Withdrawal", "ONE_TIME", "ONCE"],
  ["CA Certification", "ONE_TIME", "ONCE"],
  ["GST Cancellation / Amendment", "ONE_TIME", "ONCE"],
  ["GST Notice Reply", "ONE_TIME", "ONCE"],
  ["Income Tax Notice Reply", "ONE_TIME", "ONCE"],
  ["TAN Registration", "ONE_TIME", "ONCE"],
  ["Import Export Code (IEC)", "ONE_TIME", "ONCE"],
  ["Trademark Registration", "ONE_TIME", "ONCE"],
  ["FSSAI New Licence", "ONE_TIME", "ONCE"],
  ["Trade Licence New", "ONE_TIME", "ONCE"],
  ["Professional Tax Registration", "ONE_TIME", "ONCE"],
  ["12A / 80G Registration", "ONE_TIME", "ONCE"],
  ["Company / LLP Closure", "ONE_TIME", "ONCE"],
  ["New DSC", "ONE_TIME", "ONCE"],
  ["Loan / Project Report", "ONE_TIME", "ONCE"],
  ["Other / Custom Work", "ONE_TIME", "ONCE", null, 1, null, null, "Anything not in the list - describe it in the ticket."],
];

let sql = "";
for (const s of services) {
  const [name, cat, freq, dd = null, off = 1, rule = null, renewMonths = null, desc = null, months = null] = s;
  sql += `INSERT OR IGNORE INTO services (name, category, frequency, due_day, period_offset, renew_rule, renew_months, description, months) VALUES (${[name, cat, freq, dd, off, rule, renewMonths, desc, months].map(q).join(",")});\n`;
}
sql += `INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES ('Administrator', ${q(adminEmail)}, ${q(await hash(password))}, 'ADMIN');\n`;
sql += `INSERT OR IGNORE INTO chat_members (channel_id, user_id) SELECT 1, id FROM users WHERE EXISTS (SELECT 1 FROM chat_channels WHERE id = 1);\n`;

if (demo) {
  sql += `INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES ('Riya Sen (Manager)', 'manager@taxdoctor.local', ${q(await hash(password))}, 'MANAGER');\n`;
  sql += `INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES ('Arjun Das (Staff)', 'staff@taxdoctor.local', ${q(await hash(password))}, 'STAFF');\n`;
  sql += `INSERT OR IGNORE INTO chat_members (channel_id, user_id) SELECT 1, id FROM users;
`;
  const customers = [
    ["Sharma Traders", "Proprietorship", "Vikram Sharma", "9830012345", "vikram@sharmatraders.example", "12/3 Burrabazar Street", "Kolkata", "700007", "ABCPS1234F", "19ABCPS1234F1Z5"],
    ["Bengal Spice Foods Pvt Ltd", "Private Limited", "Moumita Ghosh", "9831098765", "accounts@bengalspice.example", "45 Park Street", "Kolkata", "700016", "AAECB5678K", "19AAECB5678K1ZP"],
    ["Dutta & Associates LLP", "LLP", "Sourav Dutta", "9903011223", "sourav@dutta-llp.example", "8 Salt Lake Sector V", "Kolkata", "700091", "AAFFD9012L", "19AAFFD9012L1Z2"],
    ["Mitra Medical Store", "Proprietorship", "Anita Mitra", "9007788990", null, "Gariahat Road", "Kolkata", "700029", "BKLPM3456Q", null],
    ["Kolkata Cold Storage Co.", "Partnership", "Rajesh Agarwal", "9433144556", "rajesh@kcs.example", "Howrah Industrial Area", "Howrah", "711101", "AAAFK7788M", "19AAAFK7788M1ZV"],
    ["Priya Boutique", "Proprietorship", "Priya Banerjee", "9051234567", "priya.boutique@example.com", "Lake Market", "Kolkata", "700029", "CDRPB4321A", null],
  ];
  customers.forEach((c, i) => {
    sql += `INSERT INTO customers (name,type,contact_person,phone,email,address,city,pincode,pan,gstin) VALUES (${c.map(q).join(",")});\n`;
  });
  const svc = (n) => `(SELECT id FROM services WHERE name=${q(n)})`;
  const enrol = (cust, name, extra = {}) => {
    sql += `INSERT INTO customer_services (customer_id, service_id, next_due, reg_no, fee) VALUES (${cust}, ${svc(name)}, ${q(extra.due ?? null)}, ${q(extra.reg ?? null)}, ${extra.fee ?? "NULL"});\n`;
  };
  // recurring enrolments
  for (const [cust, names] of [[1, ["GSTR-1", "GSTR-3B", "TDS Challan"]], [2, ["GSTR-1", "GSTR-3B", "TDS Challan", "TDS Return", "PF Return", "ESI Return", "P.Tax Registration Challan"]], [3, ["GSTR-1", "GSTR-3B", "TDS Return"]], [4, ["GSTR-1", "GSTR-3B"]], [5, ["GSTR-1", "GSTR-3B", "PF Return", "ESI Return"]], [6, ["GSTR-1", "GSTR-3B"]]]) {
    for (const n of names) enrol(cust, n, { fee: 800 });
  }
  // annual enrolments, several inside the 15-day window
  enrol(1, "Trade License - KMC", { due: isoDate(6), reg: "KMC/TL/2024/00871", fee: 3500 });
  enrol(1, "Income Tax Return", { due: isoDate(52), fee: 2500 });
  enrol(2, "FSSAI", { due: isoDate(12), reg: "10012345678901", fee: 2000 });
  enrol(2, "ROC Annual Filing (Company / LLP)", { due: isoDate(78), fee: 12000 });
  enrol(2, "DSC (Digital Signature)", { due: isoDate(14), fee: 1500 });
  enrol(3, "ROC Annual Filing (Company / LLP)", { due: isoDate(-3), fee: 9000 });
  enrol(4, "Trade License - KMC", { due: isoDate(40), reg: "KMC/TL/2023/01422", fee: 3000 });
  enrol(5, "Professional Tax Enrollment", { due: isoDate(9), fee: 1200 });
  enrol(6, "FSSAI", { due: isoDate(120), reg: "10098765432101", fee: 1800 });
  // sample tickets
  const task = (title, cust, service, due, prio, status, assignee) => {
    sql += `INSERT INTO tasks (title, customer_id, service_id, category, due_date, priority, status, assigned_to, created_by) VALUES (${q(title)}, ${cust}, ${service ? svc(service) : "NULL"}, ${service ? `(SELECT category FROM services WHERE name=${q(service)})` : "'CUSTOM'"}, ${q(due)}, ${q(prio)}, ${q(status)}, ${assignee}, 1);\n`;
  };
  task("GST Registration - new branch at Salt Lake", 3, "GST Registration", isoDate(5), "HIGH", "IN_PROGRESS", 3);
  task("Udyam registration", 4, "Udyam (MSME) Registration", isoDate(10), "NORMAL", "OPEN", 3);
  task("Partnership deed - new partner admission", 5, "Partnership Deed", isoDate(-2), "URGENT", "WAITING_CLIENT", 2);
  task("Reply to GST notice (ASMT-10)", 2, null, isoDate(4), "URGENT", "OPEN", 2);
  task("Net-worth certificate for bank loan", 1, "CA Certification", isoDate(15), "NORMAL", "OPEN", "NULL");
  sql += `INSERT INTO doc_requests (customer_id, task_id, title, description, created_by) VALUES (5, 3, 'PAN card of incoming partner', 'Clear scan, both sides if applicable', 2);\n`;
  sql += `INSERT INTO doc_requests (customer_id, task_id, title, created_by) VALUES (5, 3, 'Address proof of incoming partner', 2);\n`;
  sql += `INSERT INTO doc_requests (customer_id, title, description, created_by) VALUES (1, 'Last 3 years ITR acknowledgement', 'For the net-worth certificate', 2);\n`;
  sql += `INSERT INTO portal_messages (customer_id, body) VALUES (4, 'Please call me - I received a notice from the department.');\n`;
  sql += `INSERT INTO chat_messages (channel_id, user_id, body) VALUES (1, 1, 'Welcome to the new Tax Doctor portal. Use this channel for firm-wide updates.'), (1, 2, 'GSTR-1 for October is due on the 11th - I will split the files between you both today.');\n`;
  sql += `INSERT INTO invoices (number, customer_id, issue_date, due_date, gst_rate, subtotal, gst_amount, total, paid, status, created_by) VALUES ('INV-DEMO-0001', 2, ${q(isoDate(-20))}, ${q(isoDate(-5))}, 18, 12000, 2160, 14160, 0, 'UNPAID', 1), ('INV-DEMO-0002', 1, ${q(isoDate(-8))}, ${q(isoDate(7))}, 18, 3500, 630, 4130, 2000, 'PARTIAL', 1);\n`;
  sql += `INSERT INTO invoice_items (invoice_id, description, amount) VALUES (1, 'ROC annual filing FY 2025-26', 12000), (2, 'Trade licence renewal - KMC', 3500);\n`;
  sql += `INSERT INTO payments (invoice_id, amount, paid_on, method, created_by) VALUES (2, 2000, ${q(isoDate(-3))}, 'UPI', 1);\n`;
}

const file = ".seed.sql";
writeFileSync(file, sql);
try {
  execSync(`npx wrangler d1 execute tax-doctor-db ${remote ? "--remote" : "--local"} --file=${file}`, { stdio: "inherit" });
} finally {
  rmSync(file, { force: true });
}
console.log("\nSeed complete.");
console.log(`Admin login : ${adminEmail}`);
if (generated) console.log(`Password    : ${password}   (generated - shown once, change it after login)`);
if (demo) console.log("Demo users  : manager@taxdoctor.local, staff@taxdoctor.local (same password)");
