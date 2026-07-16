import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST = [
  "AGENTS.md",
  "README.md",
  "package.json",
  "settings.json",
  "setup.json",
  "tsconfig.json",
  "keybindings.json",
  "agents",
  "docs",
  "extensions",
  "npm/package.json",
  "npm/package-lock.json",
  "schemas",
  "skills",
  "tests",
  "themes",
];
const NEVER_COPY = new Set([
  "auth.json",
  "sessions",
  "backups",
  ".git",
  "node_modules",
]);

function parseArgs(argv) {
  let apply = false;
  let target = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--target") {
      const value = argv[index + 1];
      if (!value) throw new Error("--target benötigt einen Pfad");
      target = value;
      index += 1;
    } else {
      throw new Error(`Unbekanntes Argument: ${arg}`);
    }
  }
  return { apply, target: path.resolve(target) };
}

function collect(source, relative = "") {
  const current = path.join(source, relative);
  const stat = lstatSync(current);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlink im Deployment-Manifest nicht erlaubt: ${relative}`);
  }
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) return [];
  const files = [];
  for (const entry of readdirSync(current)) {
    if (NEVER_COPY.has(entry)) continue;
    files.push(...collect(source, path.join(relative, entry)));
  }
  return files;
}

function assertNoSymlinkComponents(candidate) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symlink im Zielpfad nicht erlaubt: ${current}`);
    }
  }
}

const { apply, target } = parseArgs(process.argv.slice(2));
if (target === SOURCE) {
  console.log("Quelle und Ziel sind identisch; keine Dateien zu synchronisieren.");
  process.exit(0);
}

assertNoSymlinkComponents(target);

const files = ALLOWLIST.flatMap((entry) => {
  const absolute = path.join(SOURCE, entry);
  return existsSync(absolute) ? collect(SOURCE, entry) : [];
}).sort();

for (const relative of files) {
  const from = path.join(SOURCE, relative);
  const to = path.join(target, relative);
  console.log(`${apply ? "COPY" : "DRY "} ${relative}`);
  if (!apply) continue;
  assertNoSymlinkComponents(to);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
}

console.log(
  apply
    ? `${files.length} allowlist-basierte Setup-Dateien installiert.`
    : `${files.length} Dateien würden installiert; --apply führt die Synchronisation aus.`,
);
