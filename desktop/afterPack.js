// electron-builder skips icon embedding when code signing is off, so the exe showed the default Electron atom in the
// taskbar and Explorer. This stamps our icon + product info into the exe after it is packed.
const path = require("path");
const m = require("rcedit");
const rcedit = typeof m === "function" ? m : m.rcedit || m.default;

exports.default = async function afterPack(context) {
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + ".exe");
  await rcedit(exe, {
    icon: path.join(context.packager.projectDir, "build", "icon.ico"),
    "version-string": {
      ProductName: "Tax Doctor Team",
      FileDescription: "Tax Doctor Team",
      CompanyName: "Smack Online Services OPC Pvt Ltd",
      LegalCopyright: "Built by Smack Online Services OPC Pvt Ltd",
      OriginalFilename: "Tax Doctor Team.exe",
    },
    "file-version": "1.1.0",
    "product-version": "1.1.0",
  });
  console.log("  • icon + version info stamped into", path.basename(exe));
};
