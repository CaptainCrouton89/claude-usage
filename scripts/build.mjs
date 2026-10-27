// Bundles the Electron main and preload scripts and assembles build/app, the directory Electron
// runs (`pnpm dev`) and the packager wraps (`pnpm package`).
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "build/app");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const common = { bundle: true, platform: "node", target: "node22", format: "cjs", external: ["electron"], logLevel: "warning" };
await build({ ...common, entryPoints: [path.join(root, "app/main.ts")], outfile: path.join(out, "main.cjs") });
await build({ ...common, entryPoints: [path.join(root, "app/preload.ts")], outfile: path.join(out, "preload.cjs") });

fs.cpSync(path.join(root, "web/dist"), path.join(out, "web"), { recursive: true });
for (const file of fs.readdirSync(path.join(root, "assets"))) {
  if (file.startsWith("tray")) fs.copyFileSync(path.join(root, "assets", file), path.join(out, file));
}
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
fs.writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify({ name: "claude-usage", productName: "Claude Usage", version, main: "main.cjs" }, null, 2),
);
console.log(`built ${path.relative(root, out)}`);
