/**
 * Git-derived evidence for the completion pipeline.
 *
 * Captures what actually changed, hashes it reproducibly and re-captures it
 * after verification and review to prove the working tree stayed still. It
 * makes no judgement: no scope evaluation, no reviewer call, no completion
 * decision and no workflow state mutation happen here.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { limitTextOutput } from "../../shared/output-limits.ts";
import type { ExecFn } from "../../setup-core/verify-profiles.ts";
import { isSecretPath } from "./secret-boundary.ts";
import type {
  ChangedFile,
  CompletionCheck,
  CompletionCheckStatus,
  DiffEvidence,
  RawExecResult,
} from "./types.ts";

function isInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

export function parsePorcelain(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    let path = line.slice(3);
    if (path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1);
    }
    const arrow = path.indexOf(" -> ");
    if (arrow >= 0) {
      const source = path.slice(0, arrow).replace(/^"|"$/g, "");
      const destination = path.slice(arrow + 4).replace(/^"|"$/g, "");
      if (source) {
        files.push({
          path: source,
          status: `${status}:source`,
          untracked: false,
        });
      }
      path = destination;
    }
    if (!path) continue;
    files.push({ path, status, untracked: status === "??" });
  }
  return files;
}

export function hashUntrackedFiles(
  projectRoot: string,
  files: readonly ChangedFile[],
): { fingerprints: string[]; warnings: string[] } {
  const fingerprints: string[] = [];
  const warnings: string[] = [];
  const root = resolve(projectRoot);
  for (const file of files.filter((entry) => entry.untracked)) {
    if (isSecretPath(file.path)) {
      warnings.push(
        "Eine potenzielle Secret-/Auth-Datei wurde bewusst nicht gelesen oder gehasht.",
      );
      continue;
    }
    const path = resolve(root, file.path);
    if (!isInside(root, path) || isAbsolute(file.path)) {
      warnings.push(
        `Unsicherer untracked Pfad wurde nicht gelesen: ${file.path}`,
      );
      continue;
    }
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        warnings.push(
          `Untracked Artefakt ist keine reguläre Datei: ${file.path}`,
        );
        continue;
      }
      const hash = createHash("sha256")
        .update(readFileSync(path))
        .digest("hex");
      fingerprints.push(`${file.path}\0${hash}`);
    } catch (error) {
      warnings.push(
        `Untracked Datei konnte nicht gehasht werden: ${file.path} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  return { fingerprints, warnings };
}

async function runGit(
  exec: ExecFn,
  root: string,
  args: string[],
): Promise<RawExecResult> {
  return (await exec("git", args, {
    cwd: root,
    timeout: 15_000,
    env: {},
  })) as RawExecResult;
}

export async function captureDiffEvidence(
  projectRoot: string,
  exec: ExecFn,
): Promise<DiffEvidence> {
  const warnings: string[] = [];
  let changedFiles: ChangedFile[] = [];
  let diffStat = "";
  let reviewDiff = "";
  let checkStatus: CompletionCheckStatus = "pass";
  let checkSummary = "git diff --check (unstaged und staged) erfolgreich.";
  try {
    const status = await runGit(exec, projectRoot, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (status.code !== 0) {
      throw new Error(`git status Exit-Code ${status.code}`);
    }
    changedFiles = parsePorcelain(status.stdout);
    const containsSecretPath = changedFiles.some((file) =>
      isSecretPath(file.path),
    );

    const [unstagedCheck, stagedCheck, stat, patch] = await Promise.all([
      runGit(exec, projectRoot, ["diff", "--check"]),
      runGit(exec, projectRoot, ["diff", "--cached", "--check"]),
      runGit(exec, projectRoot, ["diff", "--stat", "HEAD"]),
      containsSecretPath
        ? Promise.resolve({
            code: 0,
            stdout: "",
            stderr: "",
            killed: false,
          })
        : runGit(exec, projectRoot, ["diff", "--binary", "HEAD"]),
    ]);
    if (
      unstagedCheck.code !== 0 ||
      stagedCheck.code !== 0 ||
      unstagedCheck.killed ||
      stagedCheck.killed
    ) {
      checkStatus = "fail";
      checkSummary = containsSecretPath
        ? "git diff --check fehlgeschlagen; Details bleiben wegen eines Secret-/Auth-Pfads verborgen."
        : [
            unstagedCheck.stdout,
            unstagedCheck.stderr,
            stagedCheck.stdout,
            stagedCheck.stderr,
          ]
            .filter(Boolean)
            .join("\n")
            .trim() || "git diff --check fehlgeschlagen.";
    }
    if (stat.code === 0) diffStat = stat.stdout.trim();
    if (patch.code === 0) reviewDiff = patch.stdout;
    if (containsSecretPath) {
      warnings.push(
        "Der Review-Diff wurde wegen eines potenziellen Secret-/Auth-Pfads nicht gelesen.",
      );
    }
  } catch (error) {
    checkStatus = "not_run";
    checkSummary = error instanceof Error ? error.message : String(error);
  }
  const untracked = hashUntrackedFiles(projectRoot, changedFiles);
  warnings.push(...untracked.warnings);
  const diffHash = createHash("sha256")
    .update(reviewDiff, "utf8")
    .update("\0")
    .update(
      changedFiles
        .map((file) => `${file.status}\0${file.path}`)
        .sort()
        .join("\n"),
      "utf8",
    )
    .update("\0")
    .update(untracked.fingerprints.sort().join("\n"), "utf8")
    .digest("hex");
  return {
    changedFiles,
    diffStat,
    reviewDiff: limitTextOutput(reviewDiff).text,
    diffHash,
    diffCheck: {
      name: "git-diff-check",
      classification: "required",
      status: checkStatus,
      summary: checkSummary,
    },
    warnings,
  };
}

/**
 * Prove that verification and review did not themselves change the repository.
 *
 * Re-captures the evidence and compares the hash against the one taken before
 * the checks ran; a mismatch means the reviewed diff is no longer the diff on
 * disk, which is a hard required failure.
 */
export async function verifyDiffStability(
  projectRoot: string,
  exec: ExecFn,
  expectedDiffHash: string,
): Promise<CompletionCheck> {
  const after = await captureDiffEvidence(projectRoot, exec);
  return after.diffHash === expectedDiffHash
    ? {
        name: "diff-stability",
        classification: "required",
        status: "pass",
        summary: "Der Diff blieb während Prüfung und Review unverändert.",
      }
    : {
        name: "diff-stability",
        classification: "required",
        status: "fail",
        summary:
          "Der Working-Tree-Diff hat sich während der Completion-Prüfung geändert.",
      };
}
