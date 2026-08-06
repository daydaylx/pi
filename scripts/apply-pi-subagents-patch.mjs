/**
 * Re-applies a local security patch to the installed `pi-subagents` package.
 *
 * `pi-subagents` is a normal npm dependency (see npm/package.json), resolved
 * from the registry into npm/node_modules/pi-subagents. That directory is not
 * git-tracked and gets rebuilt from scratch on every `npm install`/`npm ci`,
 * which would silently drop a hand edit — the same failure mode
 * scripts/apply-runtime-patches.mjs already exists to guard against for the
 * @earendil-works/pi-coding-agent runtime. This script applies the identical
 * anchor/detect/replacement approach to the separate pi-subagents package
 * instead, deliberately kept as its own script: apply-runtime-patches.mjs's
 * own test pins a closed allowlist of files belonging to the other runtime.
 *
 * The patched function, runVerifyCommand() in
 * src/runs/shared/acceptance.ts, spawns `acceptance.verify[].command` with
 * `shell: true` and no screening. That string comes from the `subagent`
 * tool's own call input (schema: `{ type: "object", additionalProperties:
 * true }`), i.e. it is effectively LLM-controlled, the same trust level as a
 * `bash` command — but unlike `bash` it never passes through this project's
 * extensions/shared/permission-policy.ts checks. This patch screens the
 * command against the same catastrophic-pattern class that assessBash()
 * rejects there, and fails the verify step closed instead of spawning it.
 *
 * Three rules it will not bend (same as apply-runtime-patches.mjs):
 *   - idempotent: an already patched file is reported and left alone;
 *   - loud: an anchor that no longer matches aborts the whole run, because a
 *     changed dependency means the patch has to be reviewed, not force-fitted;
 *   - reversible: originals are copied to backups/ before the first write.
 *
 * Usage:
 *   node scripts/apply-pi-subagents-patch.mjs              # dry run
 *   node scripts/apply-pi-subagents-patch.mjs --apply
 *   node scripts/apply-pi-subagents-patch.mjs --apply --package <path>
 *   node scripts/apply-pi-subagents-patch.mjs --apply --allow-version-drift
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The pi-subagents version this patch was written and verified against. */
export const EXPECTED_PACKAGE_VERSION = "0.34.0";

export const DEFAULT_PACKAGE_ROOT = path.join(
  SOURCE,
  "npm",
  "node_modules",
  "pi-subagents",
);

/**
 * One edit. `detect` proves the patch is already in place, `anchor` is the
 * exact untouched text it replaces. Both must be unambiguous.
 */
export const PATCHES = [
  {
    id: "acceptance-verify-critical-pattern-guard-fn",
    file: "src/runs/shared/acceptance.ts",
    summary: "Muster-Filter für katastrophale Verify-Kommandos definieren",
    detect: "function matchesCriticalVerifyPattern(",
    anchor:
      "function runVerifyCommand(command: AcceptanceVerifyCommand, defaultCwd: string, options: { signal?: AbortSignal; abortMessage?: string } = {}): Promise<AcceptanceVerifyResult> {",
    replacement:
      "const CRITICAL_VERIFY_PATTERNS: Array<[RegExp, string]> = [\n" +
      "\t[\n" +
      "\t\t/\\brm\\b[^;&|]*(?:^|\\s)[\"']?\\/(?:[/.])*[\"']?(?=\\s|$)/i,\n" +
      '\t\t"deletes the root filesystem",\n' +
      "\t],\n" +
      "\t[\n" +
      "\t\t/\\brm\\b[^;&|]*(?:\\{[^}]*\\}|`|\\$(?:\\(|\\{[^}]*\\}|['\"]|[A-Za-z_][A-Za-z0-9_]*|[0-9?*#@!_-]))/,\n" +
      '\t\t"deletes via a dynamically expanded path",\n' +
      "\t],\n" +
      "\t[\n" +
      "\t\t/\\bsudo\\b[^;&|]*\\brm\\s+(?:-[^\\s]*r[^\\s]*f|-[^\\s]*f[^\\s]*r)\\b/i,\n" +
      '\t\t"sudo rm -rf",\n' +
      "\t],\n" +
      "\t[\n" +
      "\t\t/(?:\\b(?:rm|rmdir|unlink|trash)\\b|\\bgio\\s+trash\\b)[^;&|]*(?:[\\s/\\\\])\\.git(?:[/\\\\\\s]|$)/i,\n" +
      '\t\t"deletes .git",\n' +
      "\t],\n" +
      "\t[\n" +
      "\t\t/\\bchmod\\s+(?:-[^\\s]*R[^\\s]*\\s+)?(?:0?777|a\\+rwx)\\b/i,\n" +
      '\t\t"unsafe recursive file permissions",\n' +
      "\t],\n" +
      "\t[\n" +
      "\t\t/\\bchown\\s+(?:-[^\\s]*R[^\\s]*\\s+)?[^;&|]*(?:\\/etc|\\/usr|\\/bin|\\/sbin|\\/boot|\\/var)(?:\\/|\\s|$)/i,\n" +
      '\t\t"recursive ownership change on a system path",\n' +
      "\t],\n" +
      "\t[\n" +
      "\t\t/\\b(?:curl|wget)\\b[^|;&]*\\|\\s*(?:sudo\\s+)?(?:sh|bash|zsh|dash|ksh)\\b/i,\n" +
      '\t\t"download-to-shell pipeline",\n' +
      "\t],\n" +
      "];\n" +
      "\n" +
      "function matchesCriticalVerifyPattern(command: string): string | undefined {\n" +
      "\tfor (const [pattern, reason] of CRITICAL_VERIFY_PATTERNS) {\n" +
      "\t\tif (pattern.test(command)) return reason;\n" +
      "\t}\n" +
      "\treturn undefined;\n" +
      "}\n" +
      "\n" +
      "function runVerifyCommand(command: AcceptanceVerifyCommand, defaultCwd: string, options: { signal?: AbortSignal; abortMessage?: string } = {}): Promise<AcceptanceVerifyResult> {",
  },
  {
    id: "acceptance-verify-critical-pattern-guard-call",
    file: "src/runs/shared/acceptance.ts",
    summary:
      "Verify-Kommando vor spawn() gegen den Muster-Filter prüfen (fail-closed)",
    detect: "matchesCriticalVerifyPattern(command.command)",
    anchor:
      "\t\tconst cwd = command.cwd ? path.resolve(defaultCwd, command.cwd) : defaultCwd;\n" +
      '\t\tlet stdout = "";',
    replacement:
      "\t\tconst cwd = command.cwd ? path.resolve(defaultCwd, command.cwd) : defaultCwd;\n" +
      "\t\tconst criticalReason = matchesCriticalVerifyPattern(command.command);\n" +
      "\t\tif (criticalReason) {\n" +
      "\t\t\tresolve({\n" +
      "\t\t\t\tid: command.id,\n" +
      "\t\t\t\tcommand: command.command,\n" +
      "\t\t\t\tcwd,\n" +
      "\t\t\t\tdurationMs: 0,\n" +
      "\t\t\t\texitCode: null,\n" +
      '\t\t\t\tstatus: "failed",\n' +
      "\t\t\t\tstderr: `Verify command blocked by security filter: ${criticalReason}`,\n" +
      "\t\t\t});\n" +
      "\t\t\treturn;\n" +
      "\t\t}\n" +
      '\t\tlet stdout = "";',
  },
];

/**
 * Decide what a single patch would do to `content`, without writing.
 * Throws when the anchor is gone — a changed dependency needs a human, not a
 * best-effort guess.
 */
export function planPatch(patch, content) {
  if (content.includes(patch.detect)) return { state: "already", content };
  const occurrences = content.split(patch.anchor).length - 1;
  if (occurrences === 0) {
    throw new Error(
      `Patch '${patch.id}': Ankertext nicht gefunden in ${patch.file}. Das Paket hat sich geändert — Patch prüfen und portieren, nicht erzwingen.`,
    );
  }
  if (occurrences > 1) {
    throw new Error(
      `Patch '${patch.id}': Ankertext kommt ${occurrences}× in ${patch.file} vor und ist damit nicht eindeutig.`,
    );
  }
  return {
    state: "pending",
    content: content.replace(patch.anchor, patch.replacement),
  };
}

function parseArgs(argv) {
  let apply = false;
  let packageRoot = DEFAULT_PACKAGE_ROOT;
  let allowVersionDrift = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--allow-version-drift") allowVersionDrift = true;
    else if (arg === "--package") {
      const value = argv[index + 1];
      if (!value) throw new Error("--package benötigt einen Pfad");
      packageRoot = value;
      index += 1;
    } else {
      throw new Error(`Unbekanntes Argument: ${arg}`);
    }
  }
  return { apply, packageRoot: path.resolve(packageRoot), allowVersionDrift };
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
      throw new Error(`Symlink im Paketpfad nicht erlaubt: ${current}`);
    }
  }
}

function readPackageVersion(packageRoot) {
  const manifest = path.join(packageRoot, "package.json");
  if (!existsSync(manifest)) {
    throw new Error(
      `Kein pi-subagents-Paket unter ${packageRoot} (package.json fehlt).`,
    );
  }
  const version = JSON.parse(readFileSync(manifest, "utf8")).version;
  if (typeof version !== "string") {
    throw new Error(`Paket-Manifest ohne Version: ${manifest}`);
  }
  return version;
}

function main(argv) {
  const { apply, packageRoot, allowVersionDrift } = parseArgs(argv);
  assertNoSymlinkComponents(packageRoot);

  const version = readPackageVersion(packageRoot);
  if (version !== EXPECTED_PACKAGE_VERSION) {
    const message = `pi-subagents ist ${version}, die Patches sind gegen ${EXPECTED_PACKAGE_VERSION} geschrieben.`;
    if (!allowVersionDrift) {
      throw new Error(
        `${message} Patches gegen die neue Version prüfen und EXPECTED_PACKAGE_VERSION nachziehen, oder bewusst mit --allow-version-drift fortfahren.`,
      );
    }
    console.warn(`WARNUNG: ${message} Fortsetzung wurde ausdrücklich erlaubt.`);
  }

  // Plan every patch before touching anything: a single bad anchor must not
  // leave the package half patched.
  const byFile = new Map();
  const results = [];
  for (const patch of PATCHES) {
    const absolute = path.join(packageRoot, patch.file);
    if (!existsSync(absolute)) {
      throw new Error(`Paket-Datei fehlt: ${absolute}`);
    }
    if (!byFile.has(patch.file)) {
      byFile.set(patch.file, {
        original: readFileSync(absolute, "utf8"),
        content: readFileSync(absolute, "utf8"),
      });
    }
    const entry = byFile.get(patch.file);
    const planned = planPatch(patch, entry.content);
    entry.content = planned.content;
    results.push({ patch, state: planned.state });
  }

  const pending = results.filter((result) => result.state === "pending");
  for (const { patch, state } of results) {
    const tag = state === "already" ? "OK  " : apply ? "PATCH" : "DRY ";
    console.log(`${tag} ${patch.id} — ${patch.summary}`);
  }

  if (pending.length === 0) {
    console.log(
      `\nAlle ${PATCHES.length} Patches sind bereits angewendet (pi-subagents ${version}).`,
    );
    return;
  }
  if (!apply) {
    console.log(
      `\n${pending.length} von ${PATCHES.length} Patches fehlen; --apply schreibt sie.`,
    );
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(SOURCE, "backups", "pi-subagents-patches", stamp);
  const changedFiles = [...byFile.entries()].filter(
    ([, entry]) => entry.content !== entry.original,
  );
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  for (const [file, entry] of changedFiles) {
    const backupPath = path.join(backupDir, file);
    mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    copyFileSync(path.join(packageRoot, file), backupPath);
    writeFileSync(path.join(packageRoot, file), entry.content, "utf8");
  }
  console.log(
    `\n${pending.length} Patch(es) auf ${changedFiles.length} Datei(en) angewendet.`,
  );
  console.log(`Originale gesichert unter ${backupDir}`);
  console.log("Verifikation: node tests/pi-subagents-patch.mjs");
}

// Only run as a CLI, so the tests can import PATCHES and planPatch.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(
      `pi-subagents-Patch: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
