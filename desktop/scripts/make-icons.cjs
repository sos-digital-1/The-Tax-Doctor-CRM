// Builds the Windows icon (.ico, 7 sizes) and the taskbar "unread" overlay from the Tax Doctor mark.
const path = require("path");
const fs = require("fs");
const sharp = require("../../node_modules/sharp");
const pngToIco = require("png-to-ico").default || require("png-to-ico");

(async () => {
  const src = path.join(__dirname, "..", "build", "icon.png"); // 1024px: dark mark on a white rounded square
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const bufs = await Promise.all(sizes.map((n) => sharp(src).resize(n, n).png().toBuffer()));
  fs.writeFileSync(path.join(__dirname, "..", "build", "icon.ico"), await pngToIco(bufs));
  const dot = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="13" fill="#e11d2e" stroke="#fff" stroke-width="3"/></svg>');
  await sharp(dot).png().toFile(path.join(__dirname, "..", "build", "overlay.png"));
  console.log("icon.ico + overlay.png written");
})();
