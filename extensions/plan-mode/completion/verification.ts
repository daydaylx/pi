/**
 * Verification checks: the agent's own setup suite and the project profiles.
 *
 * Setup typecheck/test only become mandatory when the change actually targets
 * the Pi agent runtime; project profiles are evaluated separately and a
 * missing binary stays `not_run` rather than failing. Nothing here decides the
 * completion outcome — that is result-policy's job.
 */
import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { limitTextOutput } from "../../shared/output-limits.ts";
import {
  loadSetupConfig,
  type VerificationName,
} from "../../setup-core/config.ts";
import {
  loadVerifyProfiles,
  runProfile,
  type ExecFn,
} from "../../setup-core/verify-profiles.ts";
import type {
  CompletionCheck,
  CompletionVerificationContext,
  RawExecResult,
} from "./types.ts";

const SETUP_CHECKS: VerificationName[] = ["typecheck", "test"];

/** True when the change targets the Pi agent runtime itself. */
export function touchesAgentRuntime(projectRoot: string): boolean {
  return resolve(projectRoot) === resolve(getAgentDir());
}

export async function runSetupCheck(
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
      status: result.code === 0 && !result.killed ? "pass" : "fail",
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

/**
 * Run the agent setup suite (only for agent changes) plus every configured
 * project verify profile. Profile diagnostics surface as residual risks; an
 * invalid profile config is a required check that cannot be run.
 */
export async function runVerificationChecks(
  ctx: CompletionVerificationContext,
): Promise<{ checks: CompletionCheck[]; risks: string[] }> {
  const checks: CompletionCheck[] = [];
  const risks: string[] = [];
  if (touchesAgentRuntime(ctx.projectRoot)) {
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
        : (result.error?.message ?? `Exit-Code ${result.exitCode}`),
      durationMs: result.durationMs,
      ...(result.output ? { output: result.output } : {}),
    });
  }
  return { checks, risks };
}

function declaredVerification(
  ctx: CompletionVerificationContext,
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

/**
 * Prove that every verification the plan or direct task declared is actually
 * backed by an executed check. A declaration without a runnable profile is
 * `not_run`, never a silent pass.
 */
export function verificationCoverageCheck(
  ctx: CompletionVerificationContext,
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
    const tokens = new Set(normalized.split(/[^a-z0-9_-]+/).filter(Boolean));
    const matches = runnable.filter((check) =>
      checkAliases(check.name).some(
        (alias) => normalized === alias || tokens.has(alias),
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
        : "Plan oder Direktauftrag deklariert keine Verifikation.",
  };
}
