/** Read-only release inventory. On-disk JS is never claimed to be loaded JS. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILES = [
  "bin/pi",
  "bin/pis",
  "bin/pi-system-runtime",
  "bin/pi-system-host",
  "frontend-server/host.mjs",
  "frontend-server/index.mjs",
  "frontend-server/runs.mjs",
  "scripts/apply-runtime-patches.mjs",
];
const RUNTIME = "npm/node_modules/@earendil-works/pi-coding-agent/package.json";
function json(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function hash(file) {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}
function real(file) {
  try {
    return realpathSync(file);
  } catch {
    return null;
  }
}
function inventory(root) {
  const files = Object.fromEntries(
    FILES.map((file) => [file, hash(path.join(root, file))]),
  );
  let commit = null;
  let dirty = null;
  // Do not inherit a containing repository's identity for an installed copy.
  if (existsSync(path.join(root, ".git"))) {
    try {
      const git = (args) =>
        execFileSync("git", ["-C", root, ...args], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        }).trim();
      commit = git(["rev-parse", "HEAD"]);
      dirty = git(["status", "--porcelain"]).length > 0;
    } catch {
      /* No git identity is better than an invented one. */
    }
  }
  return {
    root,
    commit,
    dirty,
    declaredRuntime:
      json(path.join(root, "npm/package.json"))?.devDependencies?.[
        "@earendil-works/pi-coding-agent"
      ] ?? null,
    runtimeOnDisk: json(path.join(root, RUNTIME))?.version ?? null,
    runtimePackageSha256: hash(path.join(root, RUNTIME)),
    patchExecutionStatus: "unknown",
    files,
  };
}

export function releaseState({
  checkoutRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ),
  installedRoot = path.join(os.homedir(), ".pi/agent"),
  procRoot = "/proc",
  guiPath = "/run/current-system/sw/bin/pisystem",
} = {}) {
  const checkout = inventory(path.resolve(checkoutRoot));
  const installed = inventory(path.resolve(installedRoot));
  const gui = real(guiPath);
  const wrappedGui = gui
    ? real(path.join(path.dirname(gui), ".pisystem-wrapped"))
    : null;
  const processes = [];
  let pids = [];
  try {
    pids = readdirSync(procRoot).filter((pid) => /^\d+$/.test(pid));
  } catch {
    /* Unavailable procfs. */
  }
  const entries = new Map([
    [path.join(installed.root, "frontend-server/host.mjs"), "host"],
    [path.join(installed.root, "frontend-server/index.mjs"), "adapter"],
  ]);
  const runtimeEntry = real(
    path.join(installed.root, "npm/node_modules/.bin/pi"),
  );
  if (runtimeEntry) entries.set(runtimeEntry, "runtime");
  for (const pid of pids) {
    try {
      const proc = path.join(procRoot, pid);
      const exe = readlinkSync(path.join(proc, "exe"));
      // Inspect arguments only to match exact known entrypoints. Never emit
      // command lines, prompts, environment, settings, session data or secrets.
      const args = readFileSync(path.join(proc, "cmdline"))
        .toString()
        .split("\0");
      const entry = args.find((arg) => entries.has(arg));
      const kind = entry
        ? entries.get(entry)
        : exe === gui ||
            exe === wrappedGui ||
            path.basename(exe.replace(/ \(deleted\)$/, "")) ===
              ".pisystem-wrapped"
          ? "gui"
          : null;
      if (!kind) continue;
      const executableSha256 = hash(path.join(proc, "exe"));
      const installedGuiSha256 =
        kind === "gui" ? hash(wrappedGui ?? gui) : null;
      processes.push({
        pid: Number(pid),
        kind,
        executable: exe,
        entrypoint: entry ?? exe,
        executableSha256,
        loadedSourceIdentity: kind === "gui" ? "executable-inode" : "unknown",
        ...(kind === "gui"
          ? {
              matchesInstalledExecutable:
                executableSha256 && installedGuiSha256
                  ? executableSha256 === installedGuiSha256
                  : null,
            }
          : {}),
      });
    } catch {
      /* A process can exit or deny procfs access during collection. */
    }
  }
  return {
    observedAt: new Date().toISOString(),
    checkout,
    installed,
    checkoutMatchesInstalledFiles: Object.fromEntries(
      FILES.map((file) => [
        file,
        checkout.files[file] && installed.files[file]
          ? checkout.files[file] === installed.files[file]
          : null,
      ]),
    ),
    gui: {
      installedPath: gui,
      installedSha256: gui ? hash(gui) : null,
      wrappedPath: wrappedGui,
    },
    processes,
    limitations: [
      "On-disk hashes do not identify already-loaded Node modules.",
      "No build provenance or successful patch execution is inferred.",
      "No installation, service operation or activation is performed.",
    ],
  };
}

if (
  process.argv[1] &&
  real(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length > 2) {
    console.error("Usage: node scripts/release-state.mjs");
    process.exitCode = 64;
  } else console.log(JSON.stringify(releaseState(), null, 2));
}
