import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
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
  "subagent-tool-description.md",
  "agents",
  "docs",
  "extensions",
  "npm/package.json",
  "npm/package-lock.json",
  "schemas",
  // The runtime-patch script has to travel with the setup: the patches live in
  // node_modules and every runtime update removes them, so an installed agent
  // dir needs to be able to restore them on its own.
  "scripts",
  // workspace-snapshot.mjs is imported by setup-core at runtime.
  "shared",
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

/**
 * Sub-paths inside otherwise allowed directories that must not be copied into
 * user installations. Checked during collection so these subtrees are pruned
 * early.
 */
const NEVER_COPY_SUBTREE = new Set([
  "docs/archive/session-logs",
]);

/**
 * Files and directories that were previously managed by this installer and
 * must be removed from the target during an upgrade. Only exact names; no
 * glob expansion or recursive deletion.
 */
const LEGACY_MANAGED = [
  // This file was shipped by an older installer below the agent directory.
  // It shadows the current root-level fallback when Pi runs with the agent
  // directory as cwd, so remove only this known installer-owned copy.
  ".pi/subagent-tool-description.md",
  "agents/planner.md",
  "agents/worker.md",
  "agents/reviewer.md",
];

function parseArgs(argv) {
  let apply = false;
  let target =
    process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
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
  // Prune subtrees excluded from installation early.
  if (NEVER_COPY_SUBTREE.has(relative)) return [];
  const current = path.join(source, relative);
  const stat = lstatSync(current);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Symlink im Deployment-Manifest nicht erlaubt: ${relative}`,
    );
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
  for (const segment of absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symlink im Zielpfad nicht erlaubt: ${current}`);
    }
  }
}

function runInstall(argv) {
  const { apply, target } = parseArgs(argv);
  if (target === SOURCE) {
    console.log(
      "Quelle und Ziel sind identisch; keine Dateien zu synchronisieren.",
    );
    return;
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

  // Remove known legacy files that were previously managed by this installer.
  if (apply) {
    let removedCount = 0;
    for (const legacy of LEGACY_MANAGED) {
      const legacyPath = path.join(target, legacy);
      if (existsSync(legacyPath)) {
        // Guard: only regular files and directories directly named, never follow
        // symlinks.
        const legacyStat = lstatSync(legacyPath);
        if (legacyStat.isSymbolicLink()) {
          console.log(`SKIP legacy ${legacy}: Symlink wird nicht automatisch entfernt.`);
          continue;
        }
        rmSync(legacyPath, { recursive: true, force: true });
        removedCount += 1;
        console.log(`RM   ${legacy}`);
      }
    }
    if (removedCount > 0) {
      console.log(`${removedCount} bekannte Legacy-Dateien bereinigt.`);
    }
  }

  console.log(
    apply
      ? `${files.length} allowlist-basierte Setup-Dateien installiert.`
      : `${files.length} Dateien würden installiert; --apply führt die Synchronisation aus.`,
  );
}

export { ALLOWLIST, NEVER_COPY, NEVER_COPY_SUBTREE, LEGACY_MANAGED, SOURCE, collect };

// Only run as CLI, so tests can import the constants.
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runInstall(process.argv.slice(2));
}
