// Uploads the built Windows installer and Android APK to storage so the QR / download links under Users > "Get the team apps" work.
//   node scripts/publish-apps.mjs --local     (local preview)
//   node scripts/publish-apps.mjs --remote    (Cloudflare R2, after you have deployed)
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const files = [
  ["desktop/dist/TaxDoctor-Team-Setup.exe", "downloads/TaxDoctor-Team-Setup.exe"],
  ["mobile/TaxDoctor-Team.apk", "downloads/TaxDoctor-Team.apk"],
];
for (const [src, key] of files) {
  if (!existsSync(src)) { console.log(`skip  ${src} (not built yet)`); continue; }
  console.log(`upload ${src} -> ${key} (${target})`);
  execSync(`npx wrangler r2 object put tax-doctor-files/${key} --file ${src} ${target}`, { stdio: "inherit" });
}
