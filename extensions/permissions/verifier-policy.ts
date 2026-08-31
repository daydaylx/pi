/**
 * Technical enforcement for verifier delegations.
 *
 * Fresh-Context-Verifier sehen nur das `task`-Feld. Damit ein Verifier-Lauf
 * überhaupt ein unabhängiges Urteil bilden kann, verlangt diese Policy die
 * vollständige Übergabe vor dem Start — statt auf Appelle in Prompt oder
 * Doku zu vertrauen. Sie hängt bewusst nicht am Subagenten-Paket, dessen
 * akzeptierte Parameter sich mit der installierten Version ändern können;
 * die Guard-Schicht fängt jeden `subagent`-Aufruf unabhängig davon ab.
 */
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import {
  collectWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "../../shared/workspace-snapshot.mjs";
import type { VerificationCapabilitySnapshot } from "../shared/verification-capabilities.ts";
import { matchingVerifierRequiredPaths } from "./verifier-required-paths.ts";
import type { WorkflowAssessment } from "./workflow-policy.ts";

const PERMITTED: WorkflowAssessment = { blocked: false, reason: "" };

const VERIFIER_AGENT = "verifier";
const DEBUGGER_AGENT = "debugger";

/**
 * Both `verifier` and `debugger` ship a generous `timeoutMs` in their own
 * agent frontmatter (agents/verifier.md, agents/debugger.md) specifically so
 * an independent check or a hypothesis-testing run is never cut off mid-way.
 * A caller-supplied `turnBudget` or `timeoutMs` would silently shrink that
 * back down — observed in practice for `debugger` (a 120000ms override timed
 * out with only partial output) — so both keys are rejected outright for
 * these two roles rather than merely discouraged in prose.
 */
function budgetOverrideErrors(
  input: Record<string, unknown>,
  agentLabel: string,
  docSource: string,
): string[] {
  const errors: string[] = [];
  if (input.turnBudget !== undefined) {
    errors.push(
      `turnBudget ist für ${agentLabel}-Delegationen verboten; maßgeblich ist ausschließlich das Profil-Timeout aus ${docSource}.`,
    );
  }
  if (input.timeoutMs !== undefined) {
    errors.push(
      `timeoutMs ist für ${agentLabel}-Delegationen verboten; maßgeblich ist ausschließlich das Profil-Timeout aus ${docSource}.`,
    );
  }
  return errors;
}

/** Pflichtabschnitte der Delegationsvorlage aus docs/subagents.md. */
export const VERIFIER_REQUIRED_SECTIONS = [
  { marker: "Original User Request:", label: "Ziel (Original User Request)" },
  {
    marker: "Delegated Question:",
    label: "konkrete Teilfrage/Scope (Delegated Question)",
  },
  {
    marker: "Implementation / Diff to verify:",
    label: "Diff (Implementation / Diff to verify)",
  },
  {
    marker: "Pre-existing workspace state",
    label: "Baseline (Pre-existing workspace state)",
  },
] as const;

const ACCEPTANCE_PATTERN = /acceptance|akzeptanz/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Prüft einen einzelnen `subagent`-Tool-Call. Management-Aktionen und alle
 * anderen Rollen laufen unverändert durch.
 */
export function assessVerifierDelegation(
  event: ToolCallEvent,
): WorkflowAssessment {
  if (event.toolName !== "subagent") return PERMITTED;
  const input = isRecord(event.input) ? event.input : {};
  if (typeof input.action === "string") return PERMITTED;
  if (input.agent !== VERIFIER_AGENT) return PERMITTED;

  const errors: string[] = budgetOverrideErrors(
    input,
    "Verifier",
    "agents/verifier.md",
  );
  const task = typeof input.task === "string" ? input.task : "";
  if (!task.trim()) {
    return {
      blocked: true,
      reason:
        "Verifier-Delegation abgelehnt: kein Prüfauftrag (task) übergeben. Vorlage: docs/subagents.md.",
    };
  }
  const missing: string[] = VERIFIER_REQUIRED_SECTIONS.filter(
    (section) => !task.includes(section.marker),
  ).map((section) => section.label);
  if (!ACCEPTANCE_PATTERN.test(task)) {
    missing.push("Akzeptanzkriterien (Acceptance)");
  }
  if (missing.length > 0) {
    return {
      blocked: true,
      reason: `Verifier-Delegation abgelehnt: unvollständiger Prüfauftrag. Es fehlt: ${missing.join(
        "; ",
      )}. Pflicht ist die vollständige Vorlage aus docs/subagents.md (Ziel, Scope, Diff, Baseline, Akzeptanzkriterien).`,
    };
  }
  if (errors.length > 0) {
    return { blocked: true, reason: errors.join(" ") };
  }
  // Das installierte pi-subagents-Paket eskaliert je nach Task-Wortlaut
  // (explizit oder implizit über inferLevel()) auf Acceptance-Level wie
  // "reviewed" (verlangt einen "reviewer"-Agenten, den Aurora bewusst nicht
  // hat) oder "checked" (verlangt Evidenz wie "tests-added", die ein
  // read-only Verifier nie liefern kann). Beides führt zu einem
  // garantierten exit:1 nach dem vollen Timeout, ohne dass der Verifier
  // selbst je ein Urteil bilden konnte. Aurora erzwingt Vollständigkeit und
  // Urteil bereits über diese Policy und subagent-output-guard.ts — das
  // Paket-Acceptance-System ist für den Verifier redundant und wird daher
  // unabhängig vom Aufrufer-Input auf "none" normalisiert.
  input.acceptance = {
    level: "none",
    reason:
      "Aurora erzwingt Verifier-Vollständigkeit und -Urteil bereits über verifier-policy.ts und subagent-output-guard.ts; das Paket-Acceptance-System ist für den Verifier redundant und darf einen sonst erfolgreichen Lauf nicht per Report-Format oder Evidenzanforderung zu Fall bringen.",
  };
  return PERMITTED;
}

/**
 * Prüft einen einzelnen `subagent`-Tool-Call für die Debugger-Rolle.
 * Anders als beim Verifier gibt es keine Pflichtvorlage — `agents/debugger.md`
 * markiert fehlende Angaben selbst als Annahme —, aber dieselbe
 * Budget-Grenze wie beim Verifier gilt: Der Hauptagent darf das großzügige
 * `timeoutMs` aus der Agent-Definition nicht per Aufrufparameter verkürzen.
 */
export function assessDebuggerDelegation(
  event: ToolCallEvent,
): WorkflowAssessment {
  if (event.toolName !== "subagent") return PERMITTED;
  const input = isRecord(event.input) ? event.input : {};
  if (typeof input.action === "string") return PERMITTED;
  if (input.agent !== DEBUGGER_AGENT) return PERMITTED;

  const errors = budgetOverrideErrors(input, "Debugger", "agents/debugger.md");
  if (errors.length > 0) {
    return { blocked: true, reason: errors.join(" ") };
  }
  return PERMITTED;
}

/**
 * `git`'s two option forms that take a separate value argument rather than
 * one attached with `=` — `-C <path>` and `-c <key>=<value>` — are common
 * enough (changing directory, one-off config) that skipping past them
 * without also skipping their value would misidentify the value as the
 * subcommand.
 */
const GIT_VALUE_OPTIONS = new Set(["-C", "-c"]);

function gitSubcommand(tokens: string[]): string | undefined {
  if (tokens[0] !== "git") return undefined;
  let index = 1;
  while (index < tokens.length && tokens[index]?.startsWith("-")) {
    if (GIT_VALUE_OPTIONS.has(tokens[index])) index += 1;
    index += 1;
  }
  return tokens[index];
}

/**
 * A `git commit` invocation is matched conservatively: segments split on
 * shell connectors and newlines (a multi-line bash body chains commands
 * exactly like `;` does) without honoring quoting, and options are skipped
 * by a plain dash-prefix scan rather than a full git CLI parser — so
 * `echo "git commit" | cat` can in theory over-trigger. Over-triggering
 * costs the caller an extra verifier run; under-triggering would recreate
 * exactly the silent gap this gate exists to close, so the asymmetry is
 * intentional.
 */
export function bashTouchesGitCommit(command: string): boolean {
  return command
    .split(/&&|\|\||[;|]|\r?\n/)
    .some((segment) => gitSubcommand(segment.trim().split(/\s+/)) === "commit");
}

/**
 * Pure decision over an already-collected diff: does it hit a mandatory
 * path, and if so, does the verification snapshot cover exactly this
 * fingerprint with a passing verdict? Kept separate from
 * assessGitCommitVerifierGate so it can be unit-tested without spawning
 * real git processes — same split as verification-status.ts's pure
 * evaluateCheckRun/verificationStatus versus setup-core's git-calling
 * workspaceSnapshot() wrapper.
 */
export function assessVerifierCoverageForDiff(
  changedFiles: readonly string[],
  workspaceFingerprint: string,
  cwd: string,
  verification: VerificationCapabilitySnapshot,
): WorkflowAssessment {
  const hits = matchingVerifierRequiredPaths(changedFiles);
  if (hits.length === 0) return PERMITTED;

  const covered =
    verification.workspaceRoot === cwd &&
    verification.workspaceFingerprint === workspaceFingerprint &&
    verification.verifierStatus === "completed" &&
    (verification.verifierVerdict === "PASS" ||
      verification.verifierVerdict === "PASS_WITH_WARNINGS");
  if (covered) return PERMITTED;

  const paths = [...new Set(hits.map((hit) => hit.path))].join(", ");
  const categories = [...new Set(hits.map((hit) => hit.category))].join("; ");
  return {
    blocked: true,
    reason:
      `Verifier-Pflicht (technisch erzwungen): der aktuelle Diff berührt ` +
      `${paths} (${categories}). Commit ist erst nach einem verifier-Lauf ` +
      `mit Urteil PASS oder PASS_WITH_WARNINGS über exakt diesen Workspace-` +
      `Zustand erlaubt — Delegationsvorlage siehe docs/subagents.md.`,
  };
}

/**
 * `git push` is deliberately not gated here: collectWorkspaceSnapshot()
 * reports the *uncommitted* working-tree diff, which is normally empty by
 * the time a push happens — checking it at push would just never fire.
 * Gating the commit itself is the point where a risky diff can still be
 * caught before it enters history at all.
 */
export function assessGitCommitVerifierGate(
  event: ToolCallEvent,
  cwd: string,
  verification: VerificationCapabilitySnapshot,
): WorkflowAssessment {
  if (event.toolName !== "bash") return PERMITTED;
  const input = isRecord(event.input) ? event.input : {};
  const command = typeof input.command === "string" ? input.command : "";
  if (!bashTouchesGitCommit(command)) return PERMITTED;

  let snapshot: WorkspaceSnapshot | undefined;
  try {
    snapshot = collectWorkspaceSnapshot(cwd);
  } catch {
    // Same precedent as setup-core's own workspaceSnapshot() wrapper: a
    // snapshot that cannot be collected reports as unavailable, not as a
    // block — this gate only ever acts on evidence it actually has.
    return PERMITTED;
  }

  return assessVerifierCoverageForDiff(
    snapshot.changedFiles,
    snapshot.fingerprint,
    cwd,
    verification,
  );
}
