// Wraps build/app into "Claude Usage.app" (menu bar only: LSUIElement) and installs it into
// ~/Applications, replacing an older copy. Signed with Silas's Apple Development identity: a
// stable signature lets the rebuilt app keep reading its Keychain key without a prompt.
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const [dir] = await packager({
  dir: path.join(root, "build/app"),
  out: path.join(root, "build/package"),
  name: "Claude Usage",
  appBundleId: "ai.northlight.claude-usage",
  platform: "darwin",
  arch: "arm64",
  icon: path.join(root, "assets/icon.icns"),
  overwrite: true,
  asar: true,
  extendInfo: { LSUIElement: true },
});
const built = path.join(dir, "Claude Usage.app");
const target = path.join(os.homedir(), "Applications/Claude Usage.app");

// Quit a running copy so the new one replaces it.
try {
  execFileSync("pkill", ["-x", "Claude Usage"]);
} catch {
  // not running
}
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
execFileSync("ditto", [built, target]);
execFileSync("codesign", ["--force", "--deep", "--sign", "Apple Development: Silas Rhyneer (8W9CF7WS32)", target]);
console.log(`installed ${target}`);
