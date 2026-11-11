import { Env, all, run, one, clampDate, MONTHS, todayIST, addDays, addMonths, sendMail, logActivity, notifyCustomer, notifyUsers } from "./lib";

const QUARTER_MONTHS: Record<number, string> = { 7: "Q1 (Apr-Jun)", 10: "Q2 (Jul-Sep)", 1: "Q3 (Oct-Dec)", 5: "Q4 (Jan-Mar)" };

/** Create this month's recurring tasks (GST, TDS, PF, ESI ...) for every active enrolment. Safe to run repeatedly. */
export async function generateRecurring(env: Env, period: string, userId: number | null) {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error("Invalid period");

  const subs = await all(
    env.DB,
    `SELECT cs.*, s.name AS service_name, s.frequency, s.due_day AS s_due_day, s.period_offset, s.months AS s_months, c.name AS customer_name
       FROM customer_services cs
       JOIN services s ON s.id = cs.service_id AND s.category = 'RECURRING' AND s.active = 1
       JOIN customers c ON c.id = cs.customer_id AND c.active = 1
      WHERE cs.status = 'ACTIVE'`
  );

  let created = 0;
  const byUser = new Map<number, number>();
  for (const cs of subs) {
    const allowed: number[] | null = cs.s_months ? String(cs.s_months).split(",").map(Number) : cs.frequency === "QUARTERLY" ? Object.keys(QUARTER_MONTHS).map(Number) : null;
    if (allowed && !allowed.includes(m)) continue;
    const dueDay = cs.due_day ?? cs.s_due_day ?? 0;
    const due = clampDate(y, m, dueDay);

    let label: string;
    if (cs.frequency === "QUARTERLY" && /TDS Return/i.test(cs.service_name)) {
      label = `${QUARTER_MONTHS[m]} FY ${m >= 4 ? y : y - 1}`;
    } else if (cs.frequency === "QUARTERLY" && /GSTR/i.test(cs.service_name)) {
      // filed in Apr / Jul / Oct / Jan for the quarter that just ended
      const q = m === 1 ? [10, 12, y - 1] : m === 4 ? [1, 3, y] : m === 7 ? [4, 6, y] : [7, 9, y];
      label = `${MONTHS[q[0] - 1].slice(0, 3)}-${MONTHS[q[1] - 1].slice(0, 3)} ${q[2]} quarter`;
    } else if (cs.frequency === "QUARTERLY") {
      label = `${MONTHS[m - 1]} ${y} instalment`;
    } else {
      const wm = m - (cs.period_offset ?? 1);
      const wy = wm < 1 ? y - 1 : y;
      label = `${MONTHS[(wm + 11) % 12]} ${wy}`;
    }

    const res = await run(
      env.DB,
      `INSERT OR IGNORE INTO tasks (title, customer_id, service_id, customer_service_id, category, period_key, period_label, due_date, priority, status, assigned_to, created_by)
       VALUES (?,?,?,?, 'RECURRING', ?,?,?, 'NORMAL','OPEN',?,?)`,
      `${cs.service_name} - ${label}`,
      cs.customer_id,
      cs.service_id,
      cs.id,
      period,
      label,
      due,
      cs.assigned_to ?? null,
      userId
    );
    if (res.meta.changes) {
      created++;
      const tid = res.meta.last_row_id as number;
      let pos = 0;
      for (const item of checklistFor(cs.service_name)) await run(env.DB, "INSERT INTO task_checklist (task_id, text, position) VALUES (?,?,?)", tid, item, pos++);
      if (cs.assigned_to) byUser.set(cs.assigned_to, (byUser.get(cs.assigned_to) ?? 0) + 1);
    }
  }
  for (const [uid, n] of byUser) await notifyUsers(env, [uid], { title: `${n} new ${period} ticket${n > 1 ? "s" : ""} assigned to you`, link: "/tasks?assigned=me&open=1" });
  await logActivity(env.DB, userId ? { id: userId, name: "user" } : null, "recurring.generate", "tasks", undefined, `${period}: ${created} new of ${subs.length} enrolments`);
  return { created, enrolments: subs.length };
}

export function checklistFor(name: string): string[] {
  if (/GSTR-?1/i.test(name)) return ["Collect sales / invoice data", "Prepare and reconcile", "File GSTR-1", "Share acknowledgement with customer"];
  if (/GSTR-?3B/i.test(name)) return ["Reconcile purchases with GSTR-2B", "Compute tax liability", "Get customer approval / tax payment", "File GSTR-3B", "Share acknowledgement with customer"];
  if (/TDS Return/i.test(name)) return ["Collect deductee data", "Prepare return and validate", "File return", "Issue Form 16A / acknowledgement"];
  if (/Challan|Advance Tax/i.test(name)) return ["Confirm amount with customer", "Generate challan", "Payment done", "Share challan copy"];
  if (/PF|ESI/i.test(name)) return ["Collect attendance / wages", "Prepare ECR / return", "Payment done", "Share receipt"];
  return ["Collect data", "Prepare", "File / pay", "Share acknowledgement"];
}

/** Annual renewals due within `days` that we have not reminded the customer about yet. */
export async function sendRenewalReminders(env: Env, days = 15) {
  const today = todayIST();
  const rows = await all(
    env.DB,
    `SELECT cs.id, cs.next_due, cs.reg_no, s.name AS service_name, c.id AS customer_id, c.name AS customer_name, c.email
       FROM customer_services cs
       JOIN services s ON s.id = cs.service_id AND s.category = 'ANNUAL'
       JOIN customers c ON c.id = cs.customer_id AND c.active = 1
      WHERE cs.status = 'ACTIVE' AND cs.next_due IS NOT NULL AND cs.next_due <= ?
        AND cs.next_due >= ? AND (cs.reminded_for IS NULL OR cs.reminded_for != cs.next_due)`,
    addDays(today, days),
    today
  );
  let sent = 0;
  for (const r of rows) {
    if (!r.email) continue;
    await sendRenewalEmail(env, r);
    sent++;
  }
  return { due: rows.length, emailed: sent };
}

export async function sendRenewalEmail(env: Env, r: { id: number; next_due: string; service_name: string; customer_id: number; customer_name: string; email: string; reg_no?: string }) {
  const subject = `Reminder: ${r.service_name} due on ${r.next_due}`;
  const text =
    `Dear ${r.customer_name},\n\n` +
    `This is a friendly reminder that your ${r.service_name}${r.reg_no ? ` (${r.reg_no})` : ""} is due for renewal on ${r.next_due}.\n` +
    `Please get in touch with us so we can arrange the required documents and complete the work on time.\n\n` +
    `Regards,\nTax Doctor`;
  const status = await sendMail(env, { to: r.email, subject, text, customerId: r.customer_id, kind: "RENEWAL" });
  await notifyCustomer(env, r.customer_id, { title: subject, body: "Please contact us to renew on time." });
  await run(env.DB, "UPDATE customer_services SET reminded_for = ? WHERE id = ?", r.next_due, r.id);
  return status;
}

/** Roll an annual service forward after it has been renewed. */
export function nextRenewalDate(current: string, rule: string | null, months: number | null) {
  if (rule === "MAR31") {
    // licences that expire on 31 March roll to the next 31 March
    return `${Number(current.slice(0, 4)) + 1}-03-31`;
  }
  return addMonths(current, months ?? 12);
}

export async function dailyJob(env: Env) {
  const today = todayIST();
  if (today.endsWith("-01") || today.endsWith("-02")) {
    await generateRecurring(env, today.slice(0, 7), null);
  }
  const r = await sendRenewalReminders(env, 15);
  await logActivity(env.DB, null, "cron.daily", "renewals", undefined, JSON.stringify(r));
}

export { one };
