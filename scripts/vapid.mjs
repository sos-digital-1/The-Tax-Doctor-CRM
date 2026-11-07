// Generates VAPID keys for phone/desktop push alerts and appends them to .dev.vars (local).
// For production: copy the printed values into `wrangler secret put VAPID_PUBLIC` / `VAPID_PRIVATE`.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, appendFileSync } from "node:fs";

const b64u = (b) => Buffer.from(b).toString("base64url");
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const prv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);

const file = ".dev.vars";
if (existsSync(file) && readFileSync(file, "utf8").includes("VAPID_PUBLIC")) {
  console.log("VAPID keys already present in .dev.vars - leaving them alone.");
} else {
  appendFileSync(file, `\nVAPID_PUBLIC=${b64u(raw)}\nVAPID_PRIVATE=${prv.d}\nVAPID_SUBJECT=mailto:admin@taxdoctor.local\n`);
  console.log("VAPID keys written to .dev.vars");
}
console.log("VAPID_PUBLIC =", b64u(raw));
