import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { limitTextOutput } from "../shared/output-limits.ts";
import type { ExecFn } from "./verify-profiles.ts";

const MAX_PACKAGE_DIRS = 32;
const MAX_VISITED_DIRECTORIES = 512;
const MAX_SCAN_DEPTH = 4;
const INSTALL_TIMEOUT_MS = 900_000;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".pi",
  "dist",
  "git",
  "node_modules",
]);

export type DependencyState =
  "ready" | "missing" | "missing_lockfile" | "install_failed";

export interface DependencyTarget {
  directory: string;
  relativeDirectory: string;
  lockfile: string;
}

export interface DependencyPreparation {
  target: DependencyTarget;
  state: DependencyState;
  cached?: boolean;
  output?: string;
  error?: string;
}

export interface DependencyPrepareOptions {
  projectRoot: string;
  exec: ExecFn;
  signal?: AbortSignal;
  preparedLocks: Map<string, string>;
}

function hasDependencies(manifest: Record<string, unknown>): boolean {
  return [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ].some((field) => {
    const value = manifest[field];
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0
    );
  });
}

function readManifest(directory: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(
      readFileSync(join(directory, "package.json"), "utf8"),
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find npm package roots that declare dependencies. The traversal is deliberately
 * bounded and ignores generated/source-control directories, so a trusted project
 * cannot turn a verification request into an unbounded filesystem walk.
 */
export function discoverDependencyTargets(
  projectRoot: string,
): DependencyTarget[] {
  const targets: DependencyTarget[] = [];
  let visitedDirectories = 0;
  const visit = (directory: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return;
    if (visitedDirectories >= MAX_VISITED_DIRECTORIES) {
      throw new Error(
        `Dependency-Suche überschreitet das Limit von ${MAX_VISITED_DIRECTORIES} Verzeichnissen.`,
      );
    }
    visitedDirectories += 1;
    if (existsSync(join(directory, "package.json"))) {
      const manifest = readManifest(directory);
      if (manifest && hasDependencies(manifest)) {
        if (targets.length >= MAX_PACKAGE_DIRS) {
          throw new Error(
            `Dependency-Suche überschreitet das Limit von ${MAX_PACKAGE_DIRS} Package-Roots.`,
          );
        }
        const lockfile = join(directory, "package-lock.json");
        targets.push({
          directory,
          relativeDirectory: relative(projectRoot, directory) || ".",
          lockfile,
        });
      }
    }
    if (depth === MAX_SCAN_DEPTH) return;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      visit(join(directory, entry.name), depth + 1);
    }
  };
  visit(projectRoot, 0);
  return targets;
}

function lockFingerprint(lockfile: string): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(lockfile)).digest("hex");
  } catch {
    return undefined;
  }
}

function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/**
 * Prepare every dependency-bearing npm package in a trusted project. A package
 * is installed only if node_modules is absent; successful preparation is also
 * cached against the exact lockfile hash for the current session.
 */
export async function prepareProjectDependencies(
  options: DependencyPrepareOptions,
): Promise<DependencyPreparation[]> {
  const preparations: DependencyPreparation[] = [];
  let targets: DependencyTarget[];
  try {
    targets = discoverDependencyTargets(options.projectRoot);
  } catch (error) {
    return [
      {
        target: {
          directory: options.projectRoot,
          relativeDirectory: ".",
          lockfile: "",
        },
        state: "install_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    ];
  }
  for (const target of targets) {
    const fingerprint = lockFingerprint(target.lockfile);
    if (!fingerprint) {
      preparations.push({ target, state: "missing_lockfile" });
      continue;
    }
    const hasNodeModules = existsSync(join(target.directory, "node_modules"));
    if (
      hasNodeModules &&
      options.preparedLocks.get(target.directory) === fingerprint
    ) {
      preparations.push({ target, state: "ready", cached: true });
      continue;
    }
    if (hasNodeModules) {
      options.preparedLocks.set(target.directory, fingerprint);
      preparations.push({ target, state: "ready" });
      continue;
    }
    try {
      const result = await options.exec("npm", ["ci"], {
        cwd: target.directory,
        timeout: INSTALL_TIMEOUT_MS,
        env: inheritedEnv(),
        signal: options.signal,
      });
      const output = limitTextOutput(
        [result.stdout, result.stderr].filter(Boolean).join("\n") ||
          "(keine Ausgabe)",
      ).text;
      if (result.code === 0 && !result.killed) {
        options.preparedLocks.set(target.directory, fingerprint);
        preparations.push({ target, state: "ready", output });
      } else {
        preparations.push({
          target,
          state: "install_failed",
          output,
          error: result.killed
            ? "npm ci wurde abgebrochen oder überschritt sein Zeitlimit"
            : `npm ci endete mit Exit-Code ${result.code ?? "unbekannt"}`,
        });
      }
    } catch (error) {
      preparations.push({
        target,
        state: "install_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return preparations;
}

export function formatDependencyPreparationFailure(
  preparations: readonly DependencyPreparation[],
): string | undefined {
  const failed = preparations.filter(
    (preparation) => preparation.state !== "ready",
  );
  if (failed.length === 0) return undefined;
  return [
    "Abhängigkeitsvorbereitung fehlgeschlagen; das Prüfprofil wurde nicht gestartet.",
    ...failed.map((preparation) => {
      const location = preparation.target.relativeDirectory;
      if (preparation.state === "missing_lockfile") {
        return `- ${location}: package.json deklariert Dependencies, aber package-lock.json fehlt.`;
      }
      return `- ${location}: ${preparation.error ?? "npm ci konnte nicht erfolgreich beendet werden."}${preparation.output ? `\n  Ausgabe: ${preparation.output}` : ""}`;
    }),
  ].join("\n");
}
