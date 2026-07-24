/**
 * Lightweight task contract + scope control (issue #106).
 *
 * A compact, machine-readable working contract for direct tasks (no full plan),
 * so that scope drift and lost requirements become detectable before
 * completion. This is the piece the advisory verification gate (#102) needs to
 * turn "list all changed files" into real "unexpected file" detection.
 *
 * Architectural constraint (from the issue): reuse the existing plan-id /
 * execution-id logic — do NOT introduce a second workflow state machine.
 * Therefore this module never touches `extensions/plan-mode/state.ts` (CAS-
 * locked, v1/v2 migration). The contract may REFERENCE an active planId but
 * stores no workflow transitions of its own.
 *
 * Storage: `.agent/task-contract.json` (volatile; archive/discard after
 * completion; not committed) — consistent with `.agent/plans/`.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { extractSectionItems, extractSectionText } from "../plan-mode/utils.ts";

const CONTRACT_RELATIVE_PATH = join(".agent", "task-contract.json");

export type ContractSource = "direct" | "plan";
export type CriterionStatus = "pending" | "met" | "broken";

export interface AcceptanceCriterion {
  criterion: string;
  status: CriterionStatus;
}

export interface TaskContract {
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  /** Expected file scope as paths or globs. */
  expectedScope: string[];
  nonGoals: string[];
  /** Names of checks the task should pass (setup names + #105 profile ids). */
  verification: string[];
  /** User assumptions, explicitly separated from confirmed requirements. */
  assumptions: string[];
  /** Optional reference to the active plan; never drives workflow state. */
  planId?: string;
  source: ContractSource;
}

export interface ScopeMatchResult {
  /** Changed files that match a declared scope pattern. */
  inScope: string[];
  /** Changed files that match NO declared scope pattern (drift). */
  outOfScope: string[];
  /** Declared scope patterns that no changed file matched (possibly incomplete). */
  undeclared: string[];
}

export interface ScopeDriftAnalysis {
  match: ScopeMatchResult;
  /** Changed files flagged as likely noise (lockfiles, node_modules, .git). */
  noise: string[];
  /** Acceptance criteria still pending or broken (lost/unmet requirements). */
  openCriteria: AcceptanceCriterion[];
}

export interface ContractDiagnostic {
  level: "error" | "warning";
  source: string;
  message: string;
}

export interface LoadedContract {
  contract?: TaskContract;
  diagnostics: ContractDiagnostic[];
  source?: string;
}

/** Minimal plan facts needed to derive a contract; avoids importing plan-mode types. */
export interface PlanContractSource {
  planId: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Normalize a path/glob: forward slashes, no leading "./". */
function normalizePath(p: string): string {
  let n = p.trim().replace(/\\/g, "/");
  while (n.startsWith("./")) n = n.slice(2);
  return n;
}

type ScopeCandidateKind = "code" | "list" | "plain";

/**
 * Normalize a plan-authored scope path/glob conservatively.
 *
 * Scope entries become inputs to drift enforcement, so ambiguous prose and
 * path forms that can escape the repository are ignored rather than guessed.
 * The matcher only implements `*`, `**`, and `?`; unsupported glob syntax is
 * rejected here instead of being persisted as a misleading literal pattern.
 */
function normalizePlanScopeCandidate(
  raw: string,
  kind: ScopeCandidateKind,
): string | undefined {
  let candidate = raw.trim();
  if (!candidate || candidate.startsWith("!")) return undefined;
  if (/^[A-Za-z]:/.test(candidate)) return undefined;
  if (/^(?:[/\\]|~)/.test(candidate)) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return undefined;

  candidate = candidate.replace(/\\/g, "/");
  while (candidate.startsWith("./")) candidate = candidate.slice(2);
  candidate = candidate.replace(/\/{2,}/g, "/");

  if (candidate.startsWith("!")) return undefined;
  const trailingSlash = candidate.endsWith("/");
  const segments = candidate.split("/");
  if (
    candidate === "" ||
    segments.some((segment) => segment === "..") ||
    /[`"'<>|:;,$&#[\]{}]/.test(candidate)
  ) {
    return undefined;
  }
  candidate = segments
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
  if (trailingSlash && candidate) candidate += "/";

  // A code span is explicit enough to support a real filename containing
  // spaces. Unquoted list/plain lines with whitespace are treated as prose.
  if (kind !== "code" && /\s/.test(candidate)) return undefined;
  if (!/^[A-Za-z0-9._@+*?()/ -]+$/.test(candidate)) return undefined;

  // A free-standing word is more likely prose than a repository path. Lists
  // and code spans are explicit declarations and may name extensionless files.
  if (
    kind === "plain" &&
    !candidate.includes("/") &&
    !candidate.includes(".") &&
    !/[?*]/.test(candidate)
  ) {
    return undefined;
  }

  return candidate;
}

/**
 * Extract safe, repository-relative paths/globs from a plan's
 * "Betroffene Bereiche" section.
 *
 * Accepted authoring forms are inline-code paths, markdown list entries, and
 * unambiguous plain path lines. Invalid entries are intentionally omitted so
 * prose, absolute paths, parent traversal, drive paths, and negated globs
 * cannot weaken scope enforcement.
 */
export function extractExpectedScopeFromPlan(planContent: string): string[] {
  const section = extractSectionText(planContent, "Betroffene Bereiche");
  if (!section) return [];

  const scope: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string, kind: ScopeCandidateKind): void => {
    const normalized = normalizePlanScopeCandidate(raw, kind);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    scope.push(normalized);
  };

  for (const rawLine of section.split(/\r?\n/)) {
    const codeSpans = [...rawLine.matchAll(/`([^`\r\n]+)`/g)];
    if (codeSpans.length > 0) {
      for (const match of codeSpans) add(match[1], "code");
      continue;
    }

    const list = rawLine.match(
      /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+?)\s*$/,
    );
    if (list) {
      add(list[1], "list");
      continue;
    }

    add(rawLine, "plain");
  }

  return scope;
}

/**
 * Convert a minimal glob into a RegExp. Supports:
 *   **  -> any characters including '/'  (across segments)
 *   *   -> any characters except '/'     (within one segment)
 *   ?   -> one character except '/'
 * Everything else is escaped literally.
 */
export function globToRegExp(pattern: string): RegExp {
  const src = normalizePath(pattern);
  const endsWithSlash = src.endsWith("/");
  let out = "^";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "*") {
      if (src[i + 1] === "*") {
        out += ".*";
        i++; // consume second '*'
        // tolerate an optional following slash so "src/**" matches "src/x/y"
        if (src[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  // A bare directory prefix like "docs/" should match files beneath it.
  if (endsWithSlash) out += ".+";
  out += "$";
  return new RegExp(out);
}

/**
 * Match changed files against a declared scope. A file is "in scope" if it
 * matches any pattern; a pattern is "undeclared" if no changed file matched it.
 * Exact paths and directory prefixes ("src/") are handled by the matcher too
 * (a prefix like "src/" matches via the trailing-slash literal).
 *
 * An empty `expectedScope` means "no usable scope was declared" (e.g. a direct
 * task or a legacy plan without safe path entries) — it is NOT the same as
 * "everything is out of scope". Callers that want to surface this should
 * check `expectedScope.length === 0` themselves.
 */
export function matchScope(
  expectedScope: string[],
  changedFiles: string[],
): ScopeMatchResult {
  const patterns = expectedScope.map(normalizePath).filter(Boolean);
  const files = changedFiles.map(normalizePath).filter(Boolean);
  if (patterns.length === 0)
    return { inScope: [], outOfScope: [], undeclared: [] };
  const regexes = patterns.map((p) => globToRegExp(p));
  const matched = new Set<string>();
  const usedPatterns = new Set<number>();
  for (const file of files) {
    for (let i = 0; i < regexes.length; i++) {
      if (regexes[i].test(file)) {
        matched.add(file);
        usedPatterns.add(i);
      }
    }
  }
  return {
    inScope: files.filter((f) => matched.has(f)),
    outOfScope: files.filter((f) => !matched.has(f)),
    undeclared: patterns.filter((_, i) => !usedPatterns.has(i)),
  };
}

const NOISE_PATTERN = /(node_modules|\.lock$|^package-lock\.json$|\/\.git\/)/;

export function analyzeScopeDrift(
  contract: TaskContract,
  changedFiles: string[],
): ScopeDriftAnalysis {
  const match = matchScope(contract.expectedScope, changedFiles);
  const noise = changedFiles.filter((f) =>
    NOISE_PATTERN.test(normalizePath(f)),
  );
  const openCriteria = contract.acceptanceCriteria.filter(
    (c) => c.status !== "met",
  );
  return { match, noise, openCriteria };
}

function validateContract(
  raw: unknown,
  source: string,
  diagnostics: ContractDiagnostic[],
): TaskContract | undefined {
  if (!isObject(raw)) {
    diagnostics.push({
      level: "error",
      source,
      message: "task-contract muss ein JSON-Objekt sein",
    });
    return undefined;
  }
  const allowed = [
    "goal",
    "acceptanceCriteria",
    "expectedScope",
    "nonGoals",
    "verification",
    "assumptions",
    "planId",
    "source",
  ];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      diagnostics.push({
        level: "error",
        source,
        message: `unbekannter Schlüssel '${key}'`,
      });
    }
  }

  const goal = raw.goal;
  if (typeof goal !== "string" || goal.trim() === "") {
    diagnostics.push({
      level: "error",
      source,
      message: "goal muss ein nicht-leerer String sein",
    });
    return undefined;
  }

  const acceptanceCriteria: AcceptanceCriterion[] = [];
  const rawCriteria = raw.acceptanceCriteria;
  if (rawCriteria !== undefined) {
    if (!Array.isArray(rawCriteria)) {
      diagnostics.push({
        level: "error",
        source,
        message: "acceptanceCriteria muss ein Array sein",
      });
      return undefined;
    }
    for (let i = 0; i < rawCriteria.length; i++) {
      const entry = rawCriteria[i];
      if (
        !isObject(entry) ||
        typeof entry.criterion !== "string" ||
        entry.criterion.trim() === ""
      ) {
        diagnostics.push({
          level: "error",
          source,
          message: `acceptanceCriteria[${i}].criterion muss ein nicht-leerer String sein`,
        });
        continue;
      }
      const status = entry.status ?? "pending";
      if (status !== "pending" && status !== "met" && status !== "broken") {
        diagnostics.push({
          level: "error",
          source,
          message: `acceptanceCriteria[${i}].status muss pending|met|broken sein`,
        });
        continue;
      }
      acceptanceCriteria.push({ criterion: entry.criterion, status });
    }
  }

  const expectedScope = isStringArray(raw.expectedScope)
    ? [...raw.expectedScope]
    : [];
  if (raw.expectedScope !== undefined && !isStringArray(raw.expectedScope)) {
    diagnostics.push({
      level: "error",
      source,
      message: "expectedScope muss ein String-Array sein",
    });
  }
  const nonGoals = isStringArray(raw.nonGoals) ? [...raw.nonGoals] : [];
  if (raw.nonGoals !== undefined && !isStringArray(raw.nonGoals)) {
    diagnostics.push({
      level: "error",
      source,
      message: "nonGoals muss ein String-Array sein",
    });
  }
  const verification = isStringArray(raw.verification)
    ? [...raw.verification]
    : [];
  if (raw.verification !== undefined && !isStringArray(raw.verification)) {
    diagnostics.push({
      level: "error",
      source,
      message: "verification muss ein String-Array sein",
    });
  }
  const assumptions = isStringArray(raw.assumptions)
    ? [...raw.assumptions]
    : [];
  if (raw.assumptions !== undefined && !isStringArray(raw.assumptions)) {
    diagnostics.push({
      level: "error",
      source,
      message: "assumptions muss ein String-Array sein",
    });
  }

  let sourceKind: ContractSource = "direct";
  if (raw.source !== undefined) {
    if (raw.source !== "direct" && raw.source !== "plan") {
      diagnostics.push({
        level: "error",
        source,
        message: "source muss 'direct' oder 'plan' sein",
      });
      return undefined;
    }
    sourceKind = raw.source;
  }

  const planId =
    typeof raw.planId === "string" && raw.planId.trim() !== ""
      ? raw.planId
      : undefined;

  return {
    goal,
    acceptanceCriteria,
    expectedScope,
    nonGoals,
    verification,
    assumptions,
    ...(planId ? { planId } : {}),
    source: sourceKind,
  };
}

/**
 * Derive a task contract from a reviewed plan's "Auftrag",
 * "Abschlusskriterien", and safe "Betroffene Bereiche" entries. Returns
 * undefined if the plan has no usable goal, so callers can skip saving rather
 * than persist an empty contract.
 *
 * References the plan's existing planId (source.planId) instead of minting
 * a new identity — keeps this a data-only derivation, not a second workflow
 * state machine.
 */
export function deriveContractFromPlan(
  planContent: string,
  source: PlanContractSource,
): TaskContract | undefined {
  const goal = extractSectionText(planContent, "Auftrag");
  if (!goal) return undefined;
  const acceptanceCriteria: AcceptanceCriterion[] = extractSectionItems(
    planContent,
    "Abschlusskriterien",
  ).map((criterion) => ({ criterion, status: "pending" as const }));
  const nonGoals = extractSectionItems(planContent, "Nicht-Ziele");
  const verification = extractSectionItems(planContent, "Tests / Checks");
  return {
    goal,
    acceptanceCriteria,
    expectedScope: extractExpectedScopeFromPlan(planContent),
    nonGoals,
    verification,
    assumptions: [],
    planId: source.planId,
    source: "plan",
  };
}

/**
 * Build a task contract for a direct task (no `/plan`), from the goal text a
 * user supplies to `/task`. Unlike `deriveContractFromPlan`, there is no
 * markdown to parse — acceptanceCriteria/expectedScope/etc. start empty. An
 * empty `expectedScope` is not treated as "everything drifted" (see
 * `matchScope`), so this is safe to save as-is.
 */
export function createDirectContract(goal: string): TaskContract {
  return {
    goal,
    acceptanceCriteria: [],
    expectedScope: [],
    nonGoals: [],
    verification: [],
    assumptions: [],
    source: "direct",
  };
}

/** Load the active task contract, if any. Schema-validated, fail-closed. */
export function loadTaskContract(cwd: string): LoadedContract {
  const diagnostics: ContractDiagnostic[] = [];
  const contractPath = join(cwd, CONTRACT_RELATIVE_PATH);
  if (!existsSync(contractPath)) {
    return { diagnostics };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(contractPath, "utf8"));
  } catch (error) {
    diagnostics.push({
      level: "error",
      source: contractPath,
      message: `failed to parse: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { diagnostics, source: contractPath };
  }
  const contract = validateContract(parsed, contractPath, diagnostics);
  return {
    ...(contract ? { contract } : {}),
    diagnostics,
    source: contractPath,
  };
}

/** Persist a task contract (volatile sidecar). */
export function saveTaskContract(cwd: string, contract: TaskContract): void {
  const contractPath = join(cwd, CONTRACT_RELATIVE_PATH);
  mkdirSync(dirname(contractPath), { recursive: true });
  writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n", "utf8");
}

/** Remove the task contract (archive/discard after completion). */
export function clearTaskContract(cwd: string): void {
  const contractPath = join(cwd, CONTRACT_RELATIVE_PATH);
  try {
    rmSync(contractPath, { force: true });
  } catch {
    /* ignore */
  }
}
