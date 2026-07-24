/**
 * Universal verification gate (#102) — advisory MVP.
 *
 * A central, on-demand completion check that, before a task is declared done,
 * jointly evaluates the task, the working-tree diff, the changed files and the
 * relevant verification results. It is ADVISORY: invoked via `/verify-gate`,
 * it produces a structured report and a gate status. It does NOT modify the
 * existing completion path (`/done`, `/finish`) — hard enforcement and true
 * scope-drift detection (which needs the task contract #106) are follow-ups.
 *
 * Reuses instead of rebuilding:
 *   - setup verification (loadSetupConfig) runs at the agent dir, untouchable;
 *   - project verification profiles (#105, loadVerifyProfiles/runProfile) run
 *     at the project root, trust-gated;
 *   - git diff via the injected `exec` (same pattern as git-header.ts).
 *
 * `exec` is injected so tests stay deterministic without real processes.
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { limitTextOutput } from "../shared/output-limits.ts";
import { loadSetupConfig, type VerificationName } from "./config.ts";
import {
  loadVerifyProfiles,
  runProfile,
  type ExecFn,
} from "./verify-profiles.ts";
import { analyzeScopeDrift, loadTaskContract } from "./task-contract.ts";

export type GateStatus = "pass" | "fail" | "blocked";

export interface ChangedFile {
  path: string;
  status: string;
}

export interface GateCheck {
  name: string;
  source: "setup" | "project";
  status: "pass" | "fail" | "skipped" | "not_run";
  required: boolean;
  exitCode?: number | null;
  durationMs?: number;
  output?: string;
  error?: { kind: string; message: string };
}

export interface GateResult {
  status: GateStatus;
  summary: string;
  /** Task/contract goal, if a task contract was present. */
  taskDescription?: string;
  changedFiles: ChangedFile[];
  diffStat?: string;
  checks: GateCheck[];
  scopeHints: string[];
  residualRisks: string[];
  recommendation: string;
}

export interface GateContext {
  /** Project root the task was worked in. */
  projectRoot: string;
  /** Whether the project is trusted (gates project profile loading). */
  trusted: boolean;
  /** Spawn-like exec (no shell). Injected for tests; production wires pi.exec. */
  exec: ExecFn;
  /** Optional task description for the report header (from a plan or direct). */
  taskDescription?: string;
}

interface RawExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
}

const SETUP_CHECKS: VerificationName[] = ["typecheck", "test"];

/** Parse `git status --porcelain=v1` lines into changed-file entries. */
export function parseGitStatus(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 4) continue;
    // Format: "XY <path>". Strip surrounding quotes if git quoted the path.
    const status = line.slice(0, 2);
    let path = line.slice(3);
    if (path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1);
    }
    // For renames/copies porcelain emits "R  old -> new"; keep the new path.
    const arrow = path.indexOf(" -> ");
    if (arrow >= 0) path = path.slice(arrow + 4);
    if (path) files.push({ path, status });
  }
  return files;
}

function elapsed(from: number): number {
  return Date.now() - from;
}

/** Run a setup verification command at the agent directory. */
async function runSetupCheck(
  name: VerificationName,
  exec: ExecFn,
): Promise<GateCheck> {
  const loaded = loadSetupConfig(getAgentDir(), false);
  const spec = loaded.config.verification[name];
  const start = Date.now();
  try {
    const result = (await exec(spec.command, spec.args, {
      cwd: getAgentDir(),
      timeout: spec.timeoutMs,
      env: {},
    })) as RawExecResult;
    const limited = limitTextOutput(
      [result.stdout, result.stderr].filter(Boolean).join("\n") ||
        "(keine Ausgabe)",
    );
    const ok = result.code === 0 && !result.killed;
    return {
      name,
      source: "setup",
      status: ok ? "pass" : "fail",
      required: true,
      exitCode: result.code,
      durationMs: elapsed(start),
      output: limited.text,
      ...(result.killed
        ? { error: { kind: "timeout", message: `Zeitlimit ${spec.timeoutMs}ms` } }
        : !ok
          ? { error: { kind: "exit", message: `Exit-Code ${result.code}` } }
          : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = /enoent|spawn/i.test(message) ? "missing_binary" : "spawn_failed";
    return {
      name,
      source: "setup",
      status: "not_run",
      required: true,
      durationMs: elapsed(start),
      error: { kind, message },
    };
  }
}

/** Aggregate check results into an overall gate status. */
export function aggregateStatus(checks: GateCheck[]): GateStatus {
  const requiredFails = checks.filter(
    (c) => c.required && c.status === "fail",
  );
  const requiredNotRun = checks.filter(
    (c) => c.required && c.status === "not_run",
  );
  if (requiredFails.length > 0) return "fail";
  if (requiredNotRun.length > 0) return "blocked";
  return "pass";
}

/**
 * Run the verification gate. Returns a structured report; never throws —
 * errors become individual `not_run` checks or residual risks.
 */
export async function runVerificationGate(
  ctx: GateContext,
): Promise<GateResult> {
  // 1. Working-tree diff: changed files + diff stat.
  const changedFiles: ChangedFile[] = [];
  let diffStat: string | undefined;
  try {
    const statusResult = (await ctx.exec("git", ["status", "--porcelain=v1"], {
      cwd: ctx.projectRoot,
      timeout: 10_000,
      env: {},
    })) as RawExecResult;
    if (statusResult.code === 0) {
      changedFiles.push(...parseGitStatus(statusResult.stdout));
    }
    const diffResult = (await ctx.exec(
      "git",
      ["diff", "--stat"],
      { cwd: ctx.projectRoot, timeout: 10_000, env: {} },
    )) as RawExecResult;
    if (diffResult.code === 0 && diffResult.stdout.trim()) {
      diffStat = diffResult.stdout.trim();
    }
  } catch {
    /* git unavailable -> empty diff, reported as residual risk */
  }

  // 2. Setup verification (always at the agent dir; untouchable).
  const checks: GateCheck[] = [];
  for (const name of SETUP_CHECKS) {
    checks.push(await runSetupCheck(name, ctx.exec));
  }

  // 3. Project verification profiles (#105, trust-gated).
  const loadedProfiles = loadVerifyProfiles(ctx.projectRoot, ctx.trusted);
  const profileEntries = Object.entries(loadedProfiles.profiles);
  if (loadedProfiles.source && !ctx.trusted) {
    // Defensive: loader already refuses untrusted, but keep it explicit.
  }
  for (const [id, profile] of profileEntries) {
    const result = await runProfile(profile, {
      projectRoot: ctx.projectRoot,
      exec: ctx.exec,
    });
    checks.push({
      name: id,
      source: "project",
      status: result.ok
        ? "pass"
        : result.error?.kind === "missing_binary"
          ? "not_run"
          : "fail",
      required: profile.required,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      output: result.output,
      ...(result.error ? { error: result.error } : {}),
    });
  }

  // 4. Scope hints + residual risks. With a task contract (#106) we can detect
  //    REAL drift (out-of-scope files, undeclared scope, open criteria);
  //    without one we fall back to obvious-noise heuristics.
  const scopeHints: string[] = [];
  const residualRisks: string[] = [];
  let taskDescription: string | undefined = ctx.taskDescription;
  const loadedContract = loadTaskContract(ctx.projectRoot);
  for (const d of loadedContract.diagnostics) {
    residualRisks.push(`Task-Contract (${d.source}): ${d.message}`);
  }
  const contract = loadedContract.contract;
  if (contract) {
    if (!taskDescription) taskDescription = contract.goal;
    const drift = analyzeScopeDrift(
      contract,
      changedFiles.map((f) => f.path),
    );
    if (drift.match.outOfScope.length > 0) {
      scopeHints.push(
        `Scope-Drift — außerhalb des deklarierten Scopes: ${drift.match.outOfScope.join(", ")}`,
      );
    }
    if (drift.match.undeclared.length > 0) {
      scopeHints.push(
        `deklarierter Scope ohne Änderung (möglicherweise unvollständig): ${drift.match.undeclared.join(", ")}`,
      );
    }
    if (drift.noise.length > 0) {
      scopeHints.push(
        `potenzielles Rauschen im Diff: ${drift.noise.join(", ")}`,
      );
    }
    for (const c of drift.openCriteria) {
      residualRisks.push(
        `offene Anforderung [${c.status}]: ${c.criterion}`,
      );
    }
  } else {
    const noise = changedFiles.filter((f) =>
      /(node_modules|\.lock$|^package-lock\.json$|\/\.git\/)/.test(f.path),
    );
    if (noise.length > 0) {
      scopeHints.push(
        `potenzielles Rauschen im Diff: ${noise.map((f) => f.path).join(", ")}`,
      );
    }
  }
  if (changedFiles.length === 0) {
    scopeHints.push("keine Working-Tree-Änderungen erkannt (ggf. bereits committet).");
  }

  for (const d of loadedProfiles.diagnostics) {
    residualRisks.push(`Profil-Konfiguration (${d.source}): ${d.message}`);
  }
  if (!ctx.trusted && loadedProfiles.source === undefined) {
    // no source file; nothing to report
  }
  const notRun = checks.filter((c) => c.status === "not_run");
  for (const c of notRun) {
    residualRisks.push(
      `Prüfung '${c.name}' nicht ausführbar (${c.error?.kind ?? "unbekannt"}): ${c.error?.message ?? ""}`.trim(),
    );
  }

  // 5. Aggregate + recommendation.
  const status = aggregateStatus(checks);
  const required = checks.filter((c) => c.required);
  const passed = required.filter((c) => c.status === "pass").length;
  const summary = `${status.toUpperCase()} — ${passed}/${required.length} Pflichtprüfungen bestanden; ${changedFiles.length} Working-Tree-Datei(en) geändert.`;

  const recommendation =
    status === "pass"
      ? "Abschluss möglich: alle Pflichtprüfungen bestanden. Restrisiken beachten."
      : status === "blocked"
        ? "Abschluss blockiert: mindestens eine Pflichtprüfung ist nicht ausführbar. Binary/Konfiguration prüfen."
        : "Abschluss nicht empfohlen: mindestens eine Pflichtprüfung fehlgeschlagen. Fehler beheben und erneut prüfen.";

  return {
    status,
    summary,
    ...(taskDescription ? { taskDescription } : {}),
    changedFiles,
    ...(diffStat ? { diffStat } : {}),
    checks,
    scopeHints,
    residualRisks,
    recommendation,
  };
}

/** Render a GateResult as a human-readable report (for /verify-gate output). */
export function formatGateReport(result: GateResult, taskDescription?: string): string {
  const lines: string[] = ["Verifikations-Gate", "=================="];
  const goal = taskDescription ?? result.taskDescription;
  if (goal) lines.push(`Auftrag: ${goal}`);
  lines.push(`Status: ${result.summary}`);
  lines.push("", "Geänderte Dateien (Working Tree):");
  if (result.changedFiles.length === 0) {
    lines.push("  (keine)");
  } else {
    for (const f of result.changedFiles) {
      lines.push(`  ${f.status} ${f.path}`);
    }
  }
  if (result.diffStat) {
    lines.push("", "Diff-Stat:", result.diffStat);
  }
  lines.push("", "Prüfungen:");
  for (const c of result.checks) {
    const tag = c.status.toUpperCase();
    const req = c.required ? " [Pflicht]" : "";
    const dur = c.durationMs !== undefined ? ` (${c.durationMs}ms)` : "";
    lines.push(`  [${tag}] ${c.source}/${c.name}${req}${dur}`);
    if (c.error) lines.push(`        → ${c.error.kind}: ${c.error.message}`);
  }
  if (result.scopeHints.length > 0) {
    lines.push("", "Scope-Hinweise:");
    for (const h of result.scopeHints) lines.push(`  - ${h}`);
  }
  if (result.residualRisks.length > 0) {
    lines.push("", "Restrisiken / nicht ausführbare Prüfungen:");
    for (const r of result.residualRisks) lines.push(`  - ${r}`);
  }
  lines.push("", `Empfehlung: ${result.recommendation}`);
  return lines.join("\n");
}
