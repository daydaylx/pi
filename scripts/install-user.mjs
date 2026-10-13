import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST = [
  "AGENTS.md",
  // Runtime communication rules and prompt templates must behave identically
  // in a checkout and a user installation.
  "APPEND_SYSTEM.md",
  "README.md",
  "package.json",
  "settings.json",
  "setup.json",
  "tsconfig.json",
  "keybindings.json",
  "subagent-tool-description.md",
  "bin/pi",
  "bin/pi-frontend",
  "bin/pi-system-host",
  "bin/pi-system-runtime",
  "frontend-server",
  "agents",
  "docs",
  "prompts",
  "extensions",
  "npm/package.json",
  "npm/package-lock.json",
  "npm/packages/frontend-protocol",
  "systemd/pi-system-host.service",
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
const NEVER_COPY_SUBTREE = new Set(["docs/archive/session-logs"]);

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
  "extensions/second-opinion",
  "extensions/diff-viewer",
  "extensions/diff-learning",
  "extensions/shared/diff-events.ts",
  // Aurora no longer installs an editor component; a copy left behind by an
  // older install would be an orphan the tree no longer imports.
  "extensions/aurora-ui/editor.ts",
];

function parseArgs(argv) {
  let apply = false;
  let linkCli = false;
  let target =
    process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--link-cli") linkCli = true;
    else if (arg === "--target") {
      const value = argv[index + 1];
      if (!value) throw new Error("--target benötigt einen Pfad");
      target = value;
      index += 1;
    } else {
      throw new Error(`Unbekanntes Argument: ${arg}`);
    }
  }
  return { apply, linkCli, target: path.resolve(target) };
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

function lstatOrUndefined(candidate) {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

/**
 * Plan the optional ~/.local/bin/pi switch without following or replacing an
 * unrelated user command. The only replaceable link is the current Pi runtime
 * installed under the selected agent directory.
 */
export function planUserCliLink(target, home = homedir()) {
  target = path.resolve(target);
  home = path.resolve(home);
  const commandPath = path.join(home, ".local", "bin", "pi");
  const launcherPath = path.join(target, "bin", "pi");
  const runtimeLinkPath = path.join(
    target,
    "npm",
    "node_modules",
    ".bin",
    "pi",
  );

  assertNoSymlinkComponents(path.dirname(commandPath));
  const current = lstatOrUndefined(commandPath);
  if (!current)
    return { status: "create", commandPath, launcherPath, target, home };
  if (!current.isSymbolicLink()) {
    throw new Error(
      `Pi-Befehl ist keine verwaltete Symlink-Datei: ${commandPath}`,
    );
  }

  const currentTarget = path.resolve(
    path.dirname(commandPath),
    readlinkSync(commandPath),
  );
  const launcherTargets = new Set([launcherPath]);
  const runtimeTargets = new Set([runtimeLinkPath]);
  for (const [candidate, allowed] of [
    [launcherPath, launcherTargets],
    [runtimeLinkPath, runtimeTargets],
  ]) {
    if (existsSync(candidate)) allowed.add(realpathSync(candidate));
  }

  if (launcherTargets.has(currentTarget))
    return { status: "keep", commandPath, launcherPath, target, home };
  if (runtimeTargets.has(currentTarget))
    return { status: "replace", commandPath, launcherPath, target, home };

  try {
    const currentRealPath = realpathSync(commandPath);
    if (launcherTargets.has(currentRealPath))
      return { status: "keep", commandPath, launcherPath, target, home };
    if (runtimeTargets.has(currentRealPath))
      return { status: "replace", commandPath, launcherPath, target, home };
  } catch {
    // A broken, user-selected symlink is not ours to repair.
  }

  throw new Error(
    `Pi-Befehl zeigt auf ein nicht verwaltetes Ziel und bleibt unangetastet: ${commandPath}`,
  );
}

/** Replace only the link approved by planUserCliLink; never unlink a file. */
export function applyUserCliLink(plan) {
  if (plan.status === "keep") return plan;
  assertNoSymlinkComponents(path.dirname(plan.commandPath));
  if (!existsSync(plan.launcherPath))
    throw new Error(
      `Pi-Launcher fehlt im Installationsziel: ${plan.launcherPath}`,
    );

  // Recheck immediately before the atomic rename in case another installer or
  // user changed ~/.local/bin/pi after the preview.
  const currentPlan = planUserCliLink(plan.target, plan.home);
  if (
    currentPlan.status !== plan.status ||
    currentPlan.commandPath !== plan.commandPath ||
    currentPlan.launcherPath !== plan.launcherPath
  ) {
    throw new Error(
      "Pi-Befehl wurde seit der Vorschau geändert; Link nicht ersetzt.",
    );
  }

  const temporaryLink = path.join(
    path.dirname(plan.commandPath),
    `.pi-launcher-${process.pid}`,
  );
  if (lstatOrUndefined(temporaryLink))
    throw new Error(`Temporärer Pi-Link existiert bereits: ${temporaryLink}`);

  let created = false;
  try {
    mkdirSync(path.dirname(plan.commandPath), { recursive: true, mode: 0o700 });
    assertNoSymlinkComponents(path.dirname(plan.commandPath));
    symlinkSync(plan.launcherPath, temporaryLink);
    created = true;
    renameSync(temporaryLink, plan.commandPath);
  } catch (error) {
    if (created) unlinkSync(temporaryLink);
    throw error;
  }
  return { ...plan, status: "linked" };
}

function runInstall(argv) {
  const { apply, linkCli, target } = parseArgs(argv);
  if (target === SOURCE) {
    console.log(
      "Quelle und Ziel sind identisch; keine Dateien zu synchronisieren.",
    );
    return;
  }

  assertNoSymlinkComponents(target);
  const cliLinkPlan = linkCli ? planUserCliLink(target) : undefined;

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
    if (
      relative === "bin/pi" ||
      relative === "bin/pi-frontend" ||
      relative === "bin/pi-system-host" ||
      relative === "bin/pi-system-runtime"
    ) {
      chmodSync(to, 0o755);
    }
  }

  // The user service is sandboxed to this pre-created profile subtree. Create
  // it during apply so systemd can establish ReadWritePaths before the host
  // starts; dry-run remains read-only.
  if (apply && files.includes("systemd/pi-system-host.service")) {
    for (const relative of [
      "profile-state",
      "profile-state/system",
      "profile-state/system/workspace",
      "profile-state/system/sessions",
      "profile-state/system/host-sessions",
    ]) {
      const directory = path.join(target, relative);
      assertNoSymlinkComponents(directory);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
    }
  }

  if (cliLinkPlan) {
    console.log(
      `${apply ? "LINK" : "DRY "} ${cliLinkPlan.commandPath} -> ${cliLinkPlan.launcherPath}`,
    );
    if (apply) applyUserCliLink(planUserCliLink(target));
  }

  // Remove known legacy paths that were previously managed by this installer.
  if (apply) {
    let removedCount = 0;
    for (const legacy of LEGACY_MANAGED) {
      const legacyPath = path.join(target, legacy);
      // The leaf may itself be a symlink (handled below), but no parent may
      // redirect cleanup outside the installation target.
      assertNoSymlinkComponents(path.dirname(legacyPath));
      if (existsSync(legacyPath)) {
        // Guard: only regular files and directories directly named, never follow
        // symlinks.
        const legacyStat = lstatSync(legacyPath);
        if (legacyStat.isSymbolicLink()) {
          console.log(
            `SKIP legacy ${legacy}: Symlink wird nicht automatisch entfernt.`,
          );
          continue;
        }
        rmSync(legacyPath, { recursive: true, force: true });
        removedCount += 1;
        console.log(`RM   ${legacy}`);
      }
    }
    if (removedCount > 0) {
      console.log(`${removedCount} bekannte Legacy-Pfade bereinigt.`);
    }
  }

  console.log(
    apply
      ? `${files.length} allowlist-basierte Setup-Dateien installiert.`
      : `${files.length} Dateien würden installiert; --apply führt die Synchronisation aus.`,
  );
}

export {
  ALLOWLIST,
  NEVER_COPY,
  NEVER_COPY_SUBTREE,
  LEGACY_MANAGED,
  SOURCE,
  collect,
};

// Only run as CLI, so tests can import the constants.
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runInstall(process.argv.slice(2));
}
