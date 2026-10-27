// Wraps build/app into "Claude Usage.app" (menu bar only: LSUIElement).
//
//   node scripts/package.mjs            this Mac's architecture; installs into ~/Applications,
//                                       replacing an older copy (`pnpm package`)
//   node scripts/package.mjs --release  arm64 and x64 zips in build/release, for a GitHub
//                                       release (`pnpm release`)
//
// Signing: CODESIGN_IDENTITY from .env or the environment, else ad hoc. A stable identity lets a
// rebuilt app keep reading its Keychain key without a prompt. Release zips are always ad hoc:
// they are not notarized, so a downloader opens them once via System Settings either way.
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
if (fs.existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
const release = process.argv.includes("--release");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const dirs = await packager({
  dir: path.join(root, "build/app"),
  out: path.join(root, "build/package"),
  name: "Claude Usage",
  appBundleId: "ai.northlight.claude-usage",
  appVersion: version,
  platform: "darwin",
  arch: release ? ["arm64", "x64"] : process.arch,
  icon: path.join(root, "assets/icon.icns"),
  overwrite: true,
  asar: true,
  extendInfo: { LSUIElement: true },
});

const sign = (app, identity) => execFileSync("codesign", ["--force", "--deep", "--sign", identity || "-", app]);

if (release) {
  const out = path.join(root, "build/release");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const dir of dirs) {
    const app = path.join(dir, "Claude Usage.app");
    const arch = dir.endsWith("x64") ? "x64" : "arm64";
    sign(app, "-");
    const zip = path.join(out, `Claude-Usage-${version}-mac-${arch}.zip`);
    // ditto keeps the bundle's symlinks and signature intact, as Finder's Compress does.
    execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
    console.log(`wrote ${path.relative(root, zip)}`);
  }
} else {
  const built = path.join(dirs[0], "Claude Usage.app");
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
  sign(target, process.env.CODESIGN_IDENTITY);
  console.log(`installed ${target}`);
}
