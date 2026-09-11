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
import { collectWorkspaceSnapshot } from "../../shared/workspace-snapshot.mjs";
import {
  hasEvaluableVerifierResult,
  type VerificationCapabilitySnapshot,
} from "../shared/verification-capabilities.ts";
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

/**
 * Pflichtabschnitte der Delegationsvorlage aus docs/subagents.md.
 *
 * Der Guard prüft die inhaltlichen Blöcke, nicht eine einzige Schreibweise der
 * Überschrift. Im Plan→Work-Pilot waren zwei vollständige Übergaben allein an
 * `## Original user request` bzw. `## Target (Original User Request)` statt
 * des bytegenauen Markers gescheitert; die anschließenden Versuche, die Doku
 * aus dem fremden Worktree zu lesen, erzeugten zwei weitere Toolfehler. Die
 * Varianten bleiben absichtlich eng, zeilenbasiert und überschriftenförmig —
 * eine beiläufige Erwähnung im Fließtext erfüllt den Contract weiterhin nicht.
 */
export const VERIFIER_REQUIRED_SECTIONS = [
  {
    patterns: [
      /^(?:#{1,6}\s*)?(?:target\s*\(\s*)?original user request(?:\s*\))?\s*:?\s*$/im,
    ],
    label: "Ziel (Original User Request)",
  },
  {
    patterns: [
      /^(?:#{1,6}\s*)?(?:scope\s*\/\s*)?delegated question\s*:?\s*$/im,
      /^(?:#{1,6}\s*)?ziel der unabhängigen prüfung\s*:?\s*$/im,
    ],
    label: "konkrete Teilfrage/Scope (Delegated Question)",
  },
  {
    patterns: [
      /^(?:#{1,6}\s*)?implementation\s*\/\s*diff to verify\s*:?\s*$/im,
      /^(?:#{1,6}\s*)?diff\s*\(\s*implementation\s*\/\s*diff to verify\s*\)\s*:?\s*$/im,
      /^(?:#{1,6}\s*)?zu prüfender diff(?:\s*\([^\n]*\))?\s*:?\s*$/im,
    ],
    label: "Diff (Implementation / Diff to verify)",
  },
  {
    patterns: [
      /^(?:#{1,6}\s*)?pre-existing workspace state(?:\s*\([^\n]*\))?\s*:?\s*$/im,
      /^(?:#{1,6}\s*)?baseline\s*\(\s*pre-existing workspace state\s*\)\s*:?\s*$/im,
      /^(?:#{1,6}\s*)?baseline vor der ersten änderung\s*:?\s*$/im,
    ],
    label: "Baseline (Pre-existing workspace state)",
  },
] as const;

const ACCEPTANCE_PATTERN = /acceptance|akzeptanz/i;

/**
 * Optionaler Abschnitt, der nur geprüft wird, wenn der aktuelle Diff schon
 * einen abgeschlossenen Verifier-Lauf hat (siehe assessVerifierDedup). Für
 * jede Erstverifikation ist er irrelevant — daher kein Eintrag in
 * VERIFIER_REQUIRED_SECTIONS, sondern eine eigene, bedingte Prüfung.
 */
const REVERIFICATION_JUSTIFICATION_PATTERN =
  /^(?:#{1,6}\s*)?(?:re-verification justification|grund für erneute prüfung)\s*:?\s*$/im;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Produces the verifier-only input normalization without changing the
 * assessment input. The guard applies the returned copy only after this
 * module has permitted the delegation, keeping validation pure and the
 * executor-facing normalization explicit and idempotent.
 */
export function normalizeVerifierDelegationInput(
  event: ToolCallEvent,
): Record<string, unknown> | undefined {
  if (event.toolName !== "subagent") return undefined;
  const input = isRecord(event.input) ? event.input : undefined;
  if (
    !input ||
    typeof input.action === "string" ||
    input.agent !== VERIFIER_AGENT
  ) {
    return undefined;
  }
  return {
    ...input,
    // The installed pi-subagents package infers stricter acceptance levels
    // from task wording, but Aurora already enforces verifier completeness and
    // a substantive verdict. Package acceptance is intentionally disabled for
    // this one executor-facing input.
    acceptance: {
      level: "none",
      reason:
        "Aurora erzwingt Verifier-Vollständigkeit und -Urteil bereits über verifier-policy.ts und subagent-output-guard.ts; das Paket-Acceptance-System ist für den Verifier redundant und darf einen sonst erfolgreichen Lauf nicht per Report-Format oder Evidenzanforderung zu Fall bringen.",
    },
  };
}

/**
 * Ein zweiter `verifier`-Lauf auf einem Diff, der seit dem letzten
 * abgeschlossenen Urteil unverändert ist, prüft nichts Neues — er
 * wiederholt nur die vorherige Arbeit. `lastVerifierRun`
 * (extensions/setup-core/index.ts) bindet Urteil und Fingerprint bereits
 * zusammen; dieselbe Bindung, die bislang nur für das Commit-Gate genutzt
 * wird (assessVerifierCoverageForDiff: blockiere, wenn NICHT verifiziert),
 * greift hier in die andere Richtung: blockiere, wenn SCHON verifiziert und
 * seither nichts geändert wurde. Ein `"incomplete"`-Lauf (Timeout,
 * Turn-Budget, Provider-Fehler) zählt nie als Vorlauf — ein Retry bleibt
 * uneingeschränkt erlaubt, exakt wie beim Commit-Gate.
 */
export async function assessVerifierDedup(
  task: string,
  cwd: string,
  verification: VerificationCapabilitySnapshot,
): Promise<WorkflowAssessment> {
  if (!hasEvaluableVerifierResult(verification)) return PERMITTED;
  if (verification.workspaceRoot !== cwd) return PERMITTED;

  const result = await collectWorkspaceSnapshot(cwd);
  if (!result.ok) {
    // A snapshot that cannot be collected is no evidence the diff is
    // unchanged, so it must not block a fresh verifier run — the safe
    // reaction to "don't know" here is to allow re-checking, never to
    // prevent it.
    return PERMITTED;
  }
  if (verification.workspaceFingerprint !== result.snapshot.fingerprint) {
    return PERMITTED;
  }
  if (REVERIFICATION_JUSTIFICATION_PATTERN.test(task)) return PERMITTED;

  return {
    blocked: true,
    reason:
      `Verifier-Delegation abgelehnt: Diff ist seit dem letzten abgeschlossenen ` +
      `Verifier-Lauf unverändert (Urteil: ${verification.verifierVerdict}). ` +
      `Kein neuer Lauf nötig — nutze das bestehende Urteil. Falls eine ` +
      `erneute Prüfung trotzdem nötig ist (z. B. andere Teilfrage, neue ` +
      `Erkenntnisse), ergänze im Prüfauftrag einen Abschnitt "Grund für ` +
      `erneute Prüfung" mit der Begründung.`,
  };
}

/**
 * Prüft einen einzelnen `subagent`-Tool-Call. Management-Aktionen und alle
 * anderen Rollen laufen unverändert durch.
 */
export async function assessVerifierDelegation(
  event: ToolCallEvent,
  cwd: string,
  verification: VerificationCapabilitySnapshot,
): Promise<WorkflowAssessment> {
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
    (section) => !section.patterns.some((pattern) => pattern.test(task)),
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
  const dedup = await assessVerifierDedup(task, cwd, verification);
  if (dedup.blocked) return dedup;
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
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree"]);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=.*/;

function isGitExecutable(token: string | undefined): boolean {
  return token === "git" || token === "/usr/bin/git";
}

function skipLeadingEnvironment(tokens: string[]): number {
  let index = 0;
  while (ENV_ASSIGNMENT.test(tokens[index] ?? "")) index += 1;
  if (tokens[index] !== "env") return index;

  index += 1;
  // `env git commit` and `env NAME=value git commit` are intentionally
  // supported. Its option grammar is deliberately kept narrow here: the
  // commit gate is not a shell parser.
  while (
    index < tokens.length &&
    (ENV_ASSIGNMENT.test(tokens[index] ?? "") ||
      ["-i", "--ignore-environment"].includes(tokens[index] ?? ""))
  ) {
    index += 1;
  }
  return index;
}

function gitSubcommand(tokens: string[]): string | undefined {
  let index = skipLeadingEnvironment(tokens);
  if (!isGitExecutable(tokens[index])) return undefined;
  index += 1;
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
    hasEvaluableVerifierResult(verification) &&
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
export async function assessGitCommitVerifierGate(
  event: ToolCallEvent,
  cwd: string,
  verification: VerificationCapabilitySnapshot,
): Promise<WorkflowAssessment> {
  if (event.toolName !== "bash") return PERMITTED;
  const input = isRecord(event.input) ? event.input : {};
  const command = typeof input.command === "string" ? input.command : "";
  if (!bashTouchesGitCommit(command)) return PERMITTED;

  const result = await collectWorkspaceSnapshot(cwd);
  if (!result.ok) {
    // F-01: a snapshot that cannot be collected must block visibly, not
    // report PERMITTED. Without a snapshot this gate cannot know whether
    // the diff touches a mandatory verifier path, and "cannot tell" is not
    // evidence of safety — exactly the large-diff case the gate exists for
    // (a diff big enough to ENOBUFS the old implementation was also big
    // enough to plausibly touch a mandatory path). Every git commit blocks
    // here while the snapshot is uncollectible, not only ones later proven
    // to touch a mandatory path, because that determination itself requires
    // the snapshot this branch doesn't have.
    return {
      blocked: true,
      reason:
        `Verifier-Pflicht kann nicht geprüft werden: Workspace-Snapshot nicht ` +
        `erfassbar (${result.error.code}: ${result.error.message}). Ein ` +
        `git commit ist erst nach Behebung möglich — eine Verifier-Pflicht ` +
        `darf nie stillschweigend umgangen werden, nur weil sie nicht ` +
        `geprüft werden konnte.`,
    };
  }

  return assessVerifierCoverageForDiff(
    result.snapshot.changedFiles,
    result.snapshot.fingerprint,
    cwd,
    verification,
  );
}
