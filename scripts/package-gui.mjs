#!/usr/bin/env node
/**
 * Baut das Linux-Paket der GUI ohne zusätzliche Abhängigkeiten:
 * ein selbsttragendes Verzeichnis (gui/ + Electron-Laufzeit + Launcher)
 * und daraus ein tar.gz. Zielplattform primär Linux; Windows/macOS sind
 * laut Arbeitsauftrag erst nach Freigabe dran.
 *
 *   node scripts/package-gui.mjs            -> dist/pi-gui-linux.tar.gz
 *   node scripts/package-gui.mjs --no-tar   -> nur dist/pi-gui-linux/
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PACKAGE_DIR = path.join(DIST, "pi-gui-linux");
const withTar = !process.argv.includes("--no-tar");

rmSync(PACKAGE_DIR, { recursive: true, force: true });
mkdirSync(path.join(PACKAGE_DIR, "gui"), { recursive: true });

// Runtime-Relevante Teile der GUI kopieren (Quellen + Electron-Laufzeit).
for (const entry of ["main", "renderer", "shared", "node_modules"]) {
  cpSync(path.join(ROOT, "gui", entry), path.join(PACKAGE_DIR, "gui", entry), {
    recursive: true,
  });
}
cpSync(
  path.join(ROOT, "gui", "package.json"),
  path.join(PACKAGE_DIR, "gui", "package.json"),
);

// Selbsttragender Launcher: funktioniert ohne Repository-Kontext.
const launcher = `#!/usr/bin/env bash
# Pi Desktop-GUI — selbsttragender Linux-Launcher (Phase 7).
set -euo pipefail
here="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec "$here/gui/node_modules/.bin/electron" "$here/gui" "$@"
`;
writeFileSync(path.join(PACKAGE_DIR, "pi-gui"), launcher);
chmodSync(path.join(PACKAGE_DIR, "pi-gui"), 0o755);

console.log(`Paketverzeichnis: ${path.relative(ROOT, PACKAGE_DIR)}`);

if (withTar) {
  const tarball = path.join(DIST, "pi-gui-linux.tar.gz");
  rmSync(tarball, { force: true });
  execFileSync("tar", ["-czf", tarball, "-C", DIST, "pi-gui-linux"], {
    stdio: "inherit",
  });
  console.log(`Linux-Paket: ${path.relative(ROOT, tarball)}`);
}
