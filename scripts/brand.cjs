// Brand assets. The two logo files supplied by the business are copied UNCHANGED (byte for byte) and are the only
// logos used anywhere. App icons are made by cropping the symbol straight out of the supplied Tax Doctor artwork -
// nothing is redrawn, recoloured or re-typeset.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const SRC = process.argv[2];
const TD = path.join(SRC, "13.jpg");   // The Tax Doctor (2000x1250 canvas, artwork in the middle)
const SMACK = path.join(SRC, "12.webp"); // Smack Online Services OPC Pvt Ltd
const put = (rel, buf) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); };

(async () => {
  // 1) originals, untouched
  for (const dir of ["public/brand", "desktop/assets/brand", "mobile/www/brand"]) {
    put(`${dir}/the-tax-doctor.jpg`, fs.readFileSync(TD));
    put(`${dir}/smack-online-services.webp`, fs.readFileSync(SMACK));
  }

  // 2) icons: the symbol (left block of the artwork), pixel-exact crop, centred on white
  const mark = { left: 362, top: 293, width: 410, height: 401 }; // symbol only, a few px of margin
  const markBuf = await sharp(TD).extract(mark).toBuffer();
  const square = async (size, { pad = 0.18, round = 0 } = {}) => {
    const inner = Math.round(size * (1 - pad * 2));
    const m = await sharp(markBuf).resize({ width: inner, height: inner, fit: "contain", background: "#ffffff" }).toBuffer();
    let img = sharp({ create: { width: size, height: size, channels: 3, background: "#ffffff" } }).composite([{ input: m, gravity: "center" }]);
    if (round) {
      const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * round}" fill="#fff"/></svg>`);
      img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: "dest-in" }]);
    }
    return img.png().toBuffer();
  };
  const P = "public";
  put(`${P}/favicon-32.png`, await sharp(await square(256, { pad: 0.1, round: 0.18 })).resize(32).png().toBuffer());
  put(`${P}/favicon-48.png`, await sharp(await square(256, { pad: 0.1, round: 0.18 })).resize(48).png().toBuffer());
  put(`${P}/apple-touch-icon.png`, await sharp(await square(512, { pad: 0.16 })).resize(180).png().toBuffer());
  put(`${P}/icon-192.png`, await sharp(await square(512, { pad: 0.16, round: 0.2 })).resize(192).png().toBuffer());
  put(`${P}/icon-512.png`, await square(512, { pad: 0.16, round: 0.2 }));
  put(`${P}/icon-maskable-512.png`, await square(512, { pad: 0.3 }));
  // notification status-bar glyph: Android needs a single-colour mask, so the symbol's dark pixels become white
  const g = await sharp(markBuf).resize(96, 96, { fit: "contain", background: "#ffffff" }).greyscale().raw().toBuffer();
  const rgba = Buffer.alloc(96 * 96 * 4);
  for (let i = 0; i < g.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255 - g[i]; }
  put(`${P}/badge-96.png`, await sharp(rgba, { raw: { width: 96, height: 96, channels: 4 } }).png().toBuffer());

  // desktop + mobile
  put("desktop/build/icon.png", await square(1024, { pad: 0.14 }));
  put("mobile/www/icon.png", await square(512, { pad: 0.16, round: 0.2 }));
  const res = path.join(ROOT, "mobile/twa/app/src/main/res");
  const dens = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
  for (const [d, [icon, fg]] of Object.entries(dens)) {
    put(`mobile/twa/app/src/main/res/mipmap-${d}/ic_launcher.png`, await sharp(await square(512, { pad: 0.16, round: 0.2 })).resize(icon).png().toBuffer());
    put(`mobile/twa/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, await sharp(await square(512, { pad: 0.16, round: 0.5 })).resize(icon).png().toBuffer());
    put(`mobile/twa/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, await sharp(await square(512, { pad: 0.3 })).resize(fg).png().toBuffer());
  }
  put("mobile/twa/app/src/main/res/drawable/splash.png", await square(512, { pad: 0.2 }));
  fs.writeFileSync(path.join(res, "values/ic_launcher_background.xml"), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n');

  // 3) remove the earlier redrawn artwork
  for (const f of ["public/logo-taxdoctor.svg", "public/logo-taxdoctor.png", "public/logo-mark.svg", "public/logo-mark.png", "public/favicon.svg", "public/logo-smack.png", "public/logo-gexart.webp", "desktop/assets/taxdoctor.png", "desktop/assets/smack.png", "desktop/assets/gexart.webp", "mobile/www/taxdoctor.png", "mobile/www/smack.png", "mobile/www/gexart.webp"]) {
    try { fs.unlinkSync(path.join(ROOT, f)); } catch {}
  }
  console.log("brand assets written (originals copied unchanged)");
})();
