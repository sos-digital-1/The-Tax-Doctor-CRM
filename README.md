# The Tax Doctor - internal CRM / ERP

Cloudflare-native (Worker + D1 + R2 + cron). Runs locally first; hosting on Cloudflare later is one command.

**Who uses what**
- **Staff / admin:** web app, installable phone app (PWA, Android/iOS/desktop) and the Windows desktop app (`desktop/`).
- **Customers:** only the secure portal *link* (mobile number as login). No app, no install.

## Run locally
```bash
npm install
npm run db:migrate
npm run db:seed:demo        # catalogue + admin + demo data (local only; prints/uses the admin password)
node scripts/vapid.mjs      # optional: keys for phone/desktop push alerts
npm start                   # builds the web app, serves http://localhost:8787
```

## Modules
Customers (CSV import/export, relationship manager, credentials vault) · Tickets (list + board, checklists, bulk assign) ·
Recurring (GSTR-1 11th, GSTR-3B 20th, TDS, PF, ESI, Advance Tax, P.Tax; assignments, pause/stop) · Annual & renewals (15-day alerts + email) ·
One-time · Review inbox (accept/reject customer uploads) · Compliance calendar · Billing (GST invoices, part payments) ·
Team chat · Reports · Service catalogue · Users with per-person permissions · Email & activity logs · Global search (Ctrl+K).

## Bulk assigning
Tick tickets (or recurring rows) -> "Assign": all to one person, split by exact numbers (3 to one, 2 to another), or share evenly.
Recurring > "Assignments & stop/pause" decides who gets next month's tickets; pausing stops new ones.

## Permissions
Roles (Admin / Manager / Staff) are starting points. Users > Permissions lets you switch any of 21 abilities on/off per person,
e.g. let one person run recurring services and stop another from touching them.

## Desktop app (Windows installer, staff only)
```bash
cd desktop && npm install
npm run dist         # builds dist/TaxDoctor-Team-Setup.exe  (installer wizard)
```
Install -> first start asks for the server address (e.g. https://portal.yourfirm.in) -> sign in.
Every module or customer opens in its own tab so several customers can be worked on at once; new tabs open a Chrome-style
start page with customer / ticket search. Tabs can sit on top or down the left side (button in the app, or right-click a tab),
drag to reorder, Ctrl+T / Ctrl+W / Ctrl+1-9. Auto-locks after 15 min idle, no dev tools, window protected from screen capture.

## Android app (APK, staff only)
```bash
cd mobile && npm install
# one-time: Android SDK (platform 36, build-tools 36) + JDK 21+; then
npx cap sync android && cd android && gradlew assembleDebug
```
The APK is `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (copy it to `mobile/TaxDoctor-Team.apk`).
On first launch it asks for the server address, then runs the full web app (camera / gallery uploads work, screenshots are blocked).

## Sharing the apps (QR codes)
`node scripts/publish-apps.mjs --local` (or `--remote` after deploy) uploads the installer and APK to storage.
Then **Users & apps -> Get the team apps** creates a 48-hour download link and QR code for each - scan or send to a new staff member.

## Deploy to Cloudflare
```bash
npx wrangler login
npx wrangler d1 create tax-doctor-db           # put the database_id in wrangler.jsonc
npx wrangler r2 bucket create tax-doctor-files
npx wrangler d1 migrations apply tax-doctor-db --remote
ADMIN_EMAIL=you@firm.in ADMIN_PASSWORD='choose-a-strong-one' npm run db:seed -- --remote
npx wrangler secret put SESSION_SECRET
npx wrangler secret put VAULT_KEY               # encrypts the credentials vault - back it up!
npx wrangler secret put VAPID_PUBLIC && npx wrangler secret put VAPID_PRIVATE   # from scripts/vapid.mjs
npx wrangler secret put MAIL_API_KEY            # optional: Resend key for real emails
npm run deploy
```
Set `APP_URL` and `MAIL_FROM` in `wrangler.jsonc` vars first.
