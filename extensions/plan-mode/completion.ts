import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { limitTextOutput } from "../shared/output-limits.ts";
import { isSensitiveReference } from "../shared/permission-policy.ts";
import { matchScope } from "../setup-core/task-contract.ts";
import {
  loadSetupConfig,
  type VerificationName,
} from "../setup-core/config.ts";
import {
  loadVerifyProfiles,
  runProfile,
  type ExecFn,
} from "../setup-core/verify-profiles.ts";
import type { PlanSnapshot } from "./plan-snapshot.ts";
import type {
  CompletionReport,
  DirectTask,
  WorkflowStateV3,
} from "./store.ts";

export type CompletionClassification =
  | "required"
  | "recommended"
  | "advisory";
export type CompletionCheckStatus = "pass" | "fail" | "not_run";
export type CompletionReviewerVerdict =
  | "PASS"
  | "REWORK"
  | "UNVERIFIABLE";

export interface CompletionCheck {
  name: string;
  classification: CompletionClassification;
  status: CompletionCheckStatus;
  summary: string;
  durationMs?: number;
  output?: string;
}

export interface ChangedFile {
  path: string;
  status: string;
  untracked: boolean;
}

export interface DiffEvidence {
  changedFiles: ChangedFile[];
  diffStat: string;
  reviewDiff: string;
  diffHash: string;
  diffCheck: CompletionCheck;
  warnings: string[];
}

export interface CompletionReviewerInput {
  plan?: PlanSnapshot;
  directTask?: DirectTask;
  changedFiles: ChangedFile[];
  diff: string;
  diffHash: string;
  checks: CompletionCheck[];
  scopeFindings: string[];
}

export interface CompletionReviewerResult {
  verdict: CompletionReviewerVerdict;
  summary: string;
  raw?: string;
}

export interface CompletionLspResult {
  path: string;
  status: "pass" | "fail" | "unavailable";
  summary: string;
}

export interface CompletionPipelineContext {
  projectRoot: string;
  trusted: boolean;
  exec: ExecFn;
  plan?: PlanSnapshot;
  state?: WorkflowStateV3;
  directTask?: DirectTask;
  runReviewer(
    input: CompletionReviewerInput,
  ): Promise<CompletionReviewerResult>;
  runLsp(files: string[]): Promise<CompletionLspResult[]>;
}

export interface CompletionPipelineResult {
  status: "pass" | "fail" | "blocked";
  checks: CompletionCheck[];
  changedFiles: ChangedFile[];
  diffHash: string;
  scopeFindings: string[];
  residualRisks: string[];
  reviewer: CompletionReviewerResult;
  report?: CompletionReport;
}

interface RawExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
}

const SETUP_CHECKS: VerificationName[] = ["typecheck", "test"];

function isSecretPath(path: string): boolean {
  return isSensitiveReference(path.replace(/\\/g, "/"));
}

function isInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function parsePorcelain(output: string): ChangedFile[] {
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

function hashUntrackedFiles(
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
      warnings.push(`Unsicherer untracked Pfad wurde nicht gelesen: ${file.path}`);
      continue;
    }
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        warnings.push(`Untracked Artefakt ist keine reguläre Datei: ${file.path}`);
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
    checkSummary =
      error instanceof Error ? error.message : String(error);
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

function completionStatus(checks: readonly CompletionCheck[]): {
  status: CompletionPipelineResult["status"];
  residualRisks: string[];
} {
  const residualRisks: string[] = [];
  let failed = false;
  let blocked = false;
  for (const check of checks) {
    if (check.classification === "advisory") {
      if (check.status !== "pass")
        residualRisks.push(`${check.name}: ${check.summary}`);
      continue;
    }
    if (check.classification === "recommended") {
      if (check.status === "fail") failed = true;
      if (check.status === "not_run")
        residualRisks.push(`${check.name}: ${check.summary}`);
      continue;
    }
    if (check.status === "fail") failed = true;
    if (check.status === "not_run") blocked = true;
  }
  return {
    status: failed ? "fail" : blocked ? "blocked" : "pass",
    residualRisks,
  };
}

async function runSetupCheck(
  name: VerificationName,
  exec: ExecFn,
): Promise<CompletionCheck> {
  const loaded = loadSetupConfig(getAgentDir(), false);
  const spec = loaded.config.verification[name];
  const started = Date.now();
  try {
    const result = (await exec(spec.command, spec.args, {
      cwd: getAgentDir(),
      timeout: spec.timeoutMs,
      env: {},
    })) as RawExecResult;
    const output = limitTextOutput(
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    ).text;
    return {
      name: `setup/${name}`,
      classification: "required",
      status:
        result.code === 0 && !result.killed ? "pass" : "fail",
      summary:
        result.code === 0 && !result.killed
          ? "erfolgreich"
          : result.killed
            ? `Timeout nach ${spec.timeoutMs}ms`
            : `Exit-Code ${result.code}`,
      durationMs: Date.now() - started,
      ...(output ? { output } : {}),
    };
  } catch (error) {
    return {
      name: `setup/${name}`,
      classification: "required",
      status: "not_run",
      summary: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
}

function scopeFor(ctx: CompletionPipelineContext): string[] {
  return ctx.plan?.technicalScope ?? ctx.directTask?.technicalScope ?? [];
}

function isInternalWorkflowArtifact(path: string): boolean {
  return (
    path === ".agent/direct-task.json" ||
    path.startsWith(".agent/plans/")
  );
}

function scopeChecks(
  ctx: CompletionPipelineContext,
  changedFiles: ChangedFile[],
): { checks: CompletionCheck[]; findings: string[] } {
  const relevant = changedFiles
    .map((file) => file.path)
    .filter(
      (path) =>
        !isInternalWorkflowArtifact(path) &&
        !isSecretPath(path),
    );
  const scope = scopeFor(ctx);
  if (scope.length === 0) {
    return {
      checks: [
        {
          name: "technical-scope",
          classification: "required",
          status: "not_run",
          summary:
            "Kein maschinenlesbarer technischer Scope; vollständige Scope-Prüfung ist unmöglich.",
        },
      ],
      findings: [
        "Technischer Scope fehlt; der Abschluss darf nicht als vollständig scope-geprüft gelten.",
      ],
    };
  }
  const matched = matchScope(scope, relevant);
  const findings: string[] = [];
  if (matched.outOfScope.length > 0) {
    findings.push(
      `Außerhalb des technischen Scopes: ${matched.outOfScope.join(", ")}`,
    );
  }
  if (matched.undeclared.length > 0) {
    findings.push(
      `Deklarierter Scope ohne Änderung: ${matched.undeclared.join(", ")}`,
    );
  }
  return {
    checks: [
      {
        name: "technical-scope",
        classification: "required",
        status: matched.outOfScope.length > 0 ? "fail" : "pass",
        summary:
          matched.outOfScope.length > 0
            ? findings[0] as string
            : `${matched.inScope.length} geänderte Datei(en) im Scope.`,
      },
    ],
    findings,
  };
}

function hardBoundaryCheck(changedFiles: readonly ChangedFile[]): CompletionCheck {
  const secretPaths = changedFiles
    .map((file) => file.path.replace(/\\/g, "/"))
    .filter(isSecretPath);
  return {
    name: "hard-boundaries",
    classification: "required",
    status: secretPaths.length > 0 ? "fail" : "pass",
    summary:
      secretPaths.length > 0
        ? `${secretPaths.length} potenzielle Secret-/Auth-Datei(en) im Diff; Pfade werden nicht berichtet.`
        : "Keine Secret-/Auth-Pfade im Diff erkannt.",
  };
}

function stepsCheck(ctx: CompletionPipelineContext): CompletionCheck {
  if (!ctx.state) {
    return {
      name: "plan-steps",
      classification: ctx.directTask ? "advisory" : "required",
      status: ctx.directTask ? "pass" : "not_run",
      summary: ctx.directTask
        ? "Direct Task besitzt keinen Workflow-Step-State."
        : "Workflow-State fehlt.",
    };
  }
  const incomplete = ctx.state.steps.filter(
    (step) => step.status !== "completed",
  );
  return {
    name: "plan-steps",
    classification: "required",
    status: incomplete.length === 0 ? "pass" : "fail",
    summary:
      incomplete.length === 0
        ? "Alle stabilen Plan-Schritte sind abgeschlossen."
        : `${incomplete.length} Schritt(e) sind noch offen oder blockiert.`,
  };
}

async function projectChecks(
  ctx: CompletionPipelineContext,
): Promise<{ checks: CompletionCheck[]; risks: string[] }> {
  const checks: CompletionCheck[] = [];
  const risks: string[] = [];
  if (resolve(ctx.projectRoot) === resolve(getAgentDir())) {
    for (const name of SETUP_CHECKS) {
      checks.push(await runSetupCheck(name, ctx.exec));
    }
  }
  const loaded = loadVerifyProfiles(ctx.projectRoot, ctx.trusted);
  for (const diagnostic of loaded.diagnostics) {
    risks.push(`Verify-Profil ${diagnostic.source}: ${diagnostic.message}`);
  }
  if (
    loaded.source &&
    loaded.diagnostics.some((diagnostic) => diagnostic.level === "error")
  ) {
    checks.push({
      name: "project/profile-config",
      classification: "required",
      status: "not_run",
      summary: "Projekt-Verifikationsprofile sind ungültig.",
    });
  }
  for (const [name, profile] of Object.entries(loaded.profiles)) {
    const result = await runProfile(profile, {
      projectRoot: ctx.projectRoot,
      exec: ctx.exec,
    });
    checks.push({
      name: `project/${name}`,
      classification: profile.classification,
      status: result.ok
        ? "pass"
        : result.error?.kind === "missing_binary"
          ? "not_run"
          : "fail",
      summary: result.ok
        ? "erfolgreich"
        : result.error?.message ?? `Exit-Code ${result.exitCode}`,
      durationMs: result.durationMs,
      ...(result.output ? { output: result.output } : {}),
    });
  }
  return { checks, risks };
}

function lspCandidate(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?|py|rs|go|c|cc|cpp|h|hpp|java|zig)$/i.test(path);
}

function declaredVerification(
  ctx: CompletionPipelineContext,
): readonly string[] {
  return ctx.plan?.verification ?? ctx.directTask?.verification ?? [];
}

function checkAliases(name: string): string[] {
  const normalized = name.toLowerCase();
  const leaf = normalized.split("/").at(-1) ?? normalized;
  return [...new Set([normalized, leaf, leaf.replace(/s$/, "")])].filter(
    Boolean,
  );
}

function verificationCoverageCheck(
  ctx: CompletionPipelineContext,
  checks: readonly CompletionCheck[],
): CompletionCheck {
  const declarations = declaredVerification(ctx);
  const runnable = checks.filter(
    (check) =>
      check.name.startsWith("setup/") ||
      check.name.startsWith("project/") ||
      check.name.startsWith("lsp/"),
  );
  const missing: string[] = [];
  const failed: string[] = [];
  const unavailable: string[] = [];
  for (const declaration of declarations) {
    const normalized = declaration.toLowerCase();
    const tokens = new Set(
      normalized.split(/[^a-z0-9_-]+/).filter(Boolean),
    );
    const matches = runnable.filter((check) =>
      checkAliases(check.name).some(
        (alias) =>
          normalized === alias ||
          tokens.has(alias),
      ),
    );
    if (matches.length === 0) {
      missing.push(declaration);
    } else if (matches.some((check) => check.status === "pass")) {
      continue;
    } else if (matches.some((check) => check.status === "fail")) {
      failed.push(declaration);
    } else {
      unavailable.push(declaration);
    }
  }
  if (missing.length > 0 || unavailable.length > 0) {
    return {
      name: "declared-verification",
      classification: "required",
      status: "not_run",
      summary: [
        missing.length > 0
          ? `Ohne ausführbares Profil: ${missing.join(", ")}`
          : "",
        unavailable.length > 0
          ? `Nicht verfügbar: ${unavailable.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }
  if (failed.length > 0) {
    return {
      name: "declared-verification",
      classification: "required",
      status: "fail",
      summary: `Deklarierte Verifikation fehlgeschlagen: ${failed.join(", ")}`,
    };
  }
  return {
    name: "declared-verification",
    classification: "required",
    status: declarations.length > 0 ? "pass" : "not_run",
    summary:
      declarations.length > 0
        ? `${declarations.length} deklarierte Verifikation(en) sind durch erfolgreiche Checks belegt.`
        : "Plan oder Direct Task deklariert keine Verifikation.",
  };
}

function reviewerCheck(result: CompletionReviewerResult): CompletionCheck {
  return {
    name: "independent-reviewer",
    classification: "required",
    status:
      result.verdict === "PASS"
        ? "pass"
        : result.verdict === "REWORK"
          ? "fail"
          : "not_run",
    summary: result.summary,
  };
}

export function parseCompletionReviewerResult(
  text: string,
): CompletionReviewerResult {
  const markers = [
    ...text.matchAll(
      /\[COMPLETION-REVIEW:(PASS|REWORK|UNVERIFIABLE)\]/gi,
    ),
  ].map((match) => match[1]?.toUpperCase() as CompletionReviewerVerdict);
  const finalLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (
    markers.length !== 1 ||
    finalLine !== `[COMPLETION-REVIEW:${markers[0] ?? "UNVERIFIABLE"}]`
  ) {
    return {
      verdict: "UNVERIFIABLE",
      summary:
        markers.length === 0
          ? "Verbindlicher Reviewer-Marker fehlt."
          : markers.length > 1
            ? "Reviewer-Ausgabe enthält mehrere widersprüchliche Marker."
            : "Reviewer-Marker ist nicht die letzte nichtleere Zeile.",
      raw: text,
    };
  }
  const marker = markers[0] as CompletionReviewerVerdict;
  return {
    verdict: marker,
    summary: text
      .replace(/\[COMPLETION-REVIEW:[^\]]+\]/gi, "")
      .trim() || `Reviewer-Urteil: ${marker}`,
    raw: text,
  };
}

function buildReport(
  ctx: CompletionPipelineContext,
  evidence: DiffEvidence,
  checks: CompletionCheck[],
  scopeFindings: string[],
  residualRisks: string[],
  reviewer: CompletionReviewerResult,
  overrideReason?: string,
): CompletionReport {
  const now = new Date().toISOString();
  return {
    version: 1,
    completionId: randomUUID(),
    ...(ctx.plan
      ? {
          planId: ctx.plan.planId,
          planRevision: ctx.plan.planRevision,
          planHash: ctx.plan.planHash,
        }
      : {}),
    ...(ctx.directTask ? { directTaskId: ctx.directTask.taskId } : {}),
    diffHash: evidence.diffHash,
    outcome: overrideReason ? "override" : "passed",
    reviewerVerdict: reviewer.verdict,
    checks: checks.map((check) => ({
      name: check.name,
      classification: check.classification,
      status: check.status,
      summary: check.summary,
    })),
    scopeFindings,
    residualRisks,
    reviewerSummary: reviewer.summary,
    ...(overrideReason ? { overrideReason: overrideReason.trim() } : {}),
    completedAt: now,
  };
}

export async function runCompletionPipeline(
  ctx: CompletionPipelineContext,
  options: { overrideReason?: string } = {},
): Promise<CompletionPipelineResult> {
  if (!ctx.plan && !ctx.directTask) {
    throw new Error("Completion benötigt PlanSnapshot oder Direct Task.");
  }
  if (ctx.plan && ctx.state) {
    if (
      ctx.state.planId !== ctx.plan.planId ||
      ctx.state.planRevision !== ctx.plan.planRevision ||
      ctx.state.planHash !== ctx.plan.planHash
    ) {
      throw new Error("Workflow-State und PlanSnapshot gehören nicht zusammen.");
    }
  }
  const before = await captureDiffEvidence(ctx.projectRoot, ctx.exec);
  const hardBoundary = hardBoundaryCheck(before.changedFiles);
  const checks: CompletionCheck[] = [
    stepsCheck(ctx),
    before.diffCheck,
    hardBoundary,
  ];
  const scope = scopeChecks(ctx, before.changedFiles);
  checks.push(...scope.checks);
  const projects = await projectChecks(ctx);
  checks.push(...projects.checks);

  const lspFiles = before.changedFiles
    .map((file) => file.path)
    .filter(lspCandidate);
  try {
    const results = await ctx.runLsp(lspFiles);
    for (const result of results) {
      checks.push({
        name: `lsp/${result.path}`,
        classification: "recommended",
        status:
          result.status === "pass"
            ? "pass"
            : result.status === "fail"
              ? "fail"
              : "not_run",
        summary: result.summary,
      });
    }
  } catch (error) {
    if (lspFiles.length > 0) {
      checks.push({
        name: "lsp",
        classification: "recommended",
        status: "not_run",
        summary: error instanceof Error ? error.message : String(error),
      });
    }
  }
  checks.push(verificationCoverageCheck(ctx, checks));

  let reviewer: CompletionReviewerResult;
  try {
    reviewer = await ctx.runReviewer({
      plan: ctx.plan,
      directTask: ctx.directTask,
      changedFiles: before.changedFiles.filter(
        (file) =>
          !isSecretPath(file.path),
      ),
      diff:
        hardBoundary.status === "pass"
          ? before.reviewDiff
          : "(Diff wegen erkannter Secret-/Auth-Pfade nicht an den Reviewer übermittelt.)",
      diffHash: before.diffHash,
      checks,
      scopeFindings: scope.findings,
    });
  } catch (error) {
    reviewer = {
      verdict: "UNVERIFIABLE",
      summary: error instanceof Error ? error.message : String(error),
    };
  }
  checks.push(reviewerCheck(reviewer));

  const after = await captureDiffEvidence(ctx.projectRoot, ctx.exec);
  if (after.diffHash !== before.diffHash) {
    checks.push({
      name: "diff-stability",
      classification: "required",
      status: "fail",
      summary:
        "Der Working-Tree-Diff hat sich während der Completion-Prüfung geändert.",
    });
  } else {
    checks.push({
      name: "diff-stability",
      classification: "required",
      status: "pass",
      summary: "Der Diff blieb während Prüfung und Review unverändert.",
    });
  }

  const aggregate = completionStatus(checks);
  const residualRisks = [
    ...before.warnings,
    ...projects.risks,
    ...aggregate.residualRisks,
  ];
  const overrideReason = options.overrideReason?.trim();
  const overrideAllowed = hardBoundary.status === "pass";
  const mayReport =
    aggregate.status === "pass" ||
    (overrideAllowed && Boolean(overrideReason) && overrideReason !== "");
  return {
    status: aggregate.status,
    checks,
    changedFiles: before.changedFiles,
    diffHash: before.diffHash,
    scopeFindings: scope.findings,
    residualRisks,
    reviewer,
    ...(mayReport
      ? {
          report: buildReport(
            ctx,
            before,
            checks,
            scope.findings,
            residualRisks,
            reviewer,
            aggregate.status === "pass" ? undefined : overrideReason,
          ),
        }
      : {}),
  };
}

export function formatCompletionResult(
  result: CompletionPipelineResult,
): string {
  const lines = [
    `Completion: ${result.status.toUpperCase()}`,
    `Diff-Hash: ${result.diffHash}`,
    `Reviewer: ${result.reviewer.verdict}`,
    "",
    "Prüfungen:",
  ];
  for (const check of result.checks) {
    lines.push(
      `- ${check.status.toUpperCase()} [${check.classification}] ${check.name}: ${check.summary}`,
    );
  }
  if (result.scopeFindings.length > 0) {
    lines.push("", "Scope:");
    for (const finding of result.scopeFindings) lines.push(`- ${finding}`);
  }
  if (result.residualRisks.length > 0) {
    lines.push("", "Restrisiken:");
    for (const risk of result.residualRisks) lines.push(`- ${risk}`);
  }
  return lines.join("\n");
}
