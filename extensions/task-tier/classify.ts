/**
 * Task-Klassen (FAST / NORMAL / DEEP): reine Heuristik ohne Seiteneffekte.
 *
 * Konservativ: DEEP-Signale gewinnen immer, NORMAL ist der Default bei
 * Unsicherheit und entspricht dem unveränderten bisherigen Workflow.
 */
import { matchingVerifierRequiredPaths } from "../permissions/verifier-required-paths.ts";

export type TaskTier = "fast" | "normal" | "deep";

export interface ClassifyOptions {
  /** Plan Mode (simple/detailed) ist aktiv. */
  planning: boolean;
}

const DEEP_PATTERN = new RegExp(
  [
    "security",
    "sicherheit",
    "permission",
    "berechtigung",
    "trust",
    "secret",
    "credential",
    "auth(?:entication|orization|entifizierung)?\\b",
    "sandbox",
    "architektur",
    "architecture",
    "migrat",
    "refactor",
    "umbau",
    "neu\\s*schreiben",
    "rewrite",
    "protokoll",
    "protocol",
    "frontend[- ]api",
    "\\bipc\\b",
    "dependenc",
    "abhängigkeit",
    "plan[- ]?mode",
    "planmodus",
    "\\bplan\\b",
    "verifier",
    "subagent",
    "race condition",
    "intermittier",
    "nicht reproduzierbar",
    "root cause",
    "ursache.*unklar",
  ].join("|"),
  "i",
);

/** Hinweise auf breiten Umfang: nicht FAST. */
const BROAD_PATTERN =
  /\b(alle[nrms]?|überall|komplett\w*|gesamte\w*|repo-?weit|projektweit|across|everywhere|all files|whole|entire)\b/i;

/**
 * Veröffentlichende Aktionen brauchen laut AGENTS.md einen Verifier-Lauf vor
 * Commit/Push; FAST sperrt Verifier technisch, daher nie FAST.
 */
const RELEASE_PATTERN =
  /\b(commit\w*|push\w*|merge\w*|publish\w*|release\w*|deploy\w*|veröffentlich\w*|pull[- ]?request|pr)\b/i;

/** Kurze Fortsetzungs-Prompts ("weiter", "ja", "go"): Klasse erbt vom Vorgänger. */
const CONTINUATION_PATTERN =
  /^\s*(weiter|mach weiter|fortsetzen|ja|ok(?:ay)?|go|los|jo|passt|bitte|dann|continue|proceed|yes)\b[\s\w,.!?äöüß-]{0,40}$/i;

const PATH_PATTERN =
  /(?:[\w.-]+\/)+[\w.-]+\.\w+|\b[\w-]+\.(?:ts|tsx|js|mjs|cjs|json|md|css|py|sh|ya?ml)\b/g;

const FAST_MAX_CHARS = 500;
const FAST_MAX_PATHS = 3;
const FAST_MAX_LIST_ITEMS = 2;

export function mentionedPaths(prompt: string): string[] {
  return [...new Set(prompt.match(PATH_PATTERN) ?? [])];
}

export function classifyPrompt(
  prompt: string,
  options: ClassifyOptions,
): TaskTier {
  if (options.planning) return "deep";
  const text = prompt.trim();
  if (!text) return "normal";
  const paths = mentionedPaths(text);
  if (DEEP_PATTERN.test(text)) return "deep";
  if (matchingVerifierRequiredPaths(paths).length > 0) return "deep";
  if (RELEASE_PATTERN.test(text)) return "normal";
  if (text.length > FAST_MAX_CHARS) return "normal";
  if (paths.length > FAST_MAX_PATHS) return "normal";
  if (BROAD_PATTERN.test(text)) return "normal";
  const listItems = text.match(/^\s*(?:[-*]|\d+[.)])\s+/gm)?.length ?? 0;
  if (listItems > FAST_MAX_LIST_ITEMS) return "normal";
  return "fast";
}

export function isContinuationPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return (
    text.length > 0 && text.length <= 48 && CONTINUATION_PATTERN.test(text)
  );
}

const TIER_RANK: Record<TaskTier, number> = { fast: 0, normal: 1, deep: 2 };

/** Höhere der beiden Klassen. */
export function maxTier(a: TaskTier, b: TaskTier): TaskTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

export type ThinkingTarget = "low" | "medium" | "high" | undefined;

/**
 * Ziel-Thinking je Klasse. `undefined` = Einstellung nicht anfassen (NORMAL).
 * FAST: sehr kurze Aufträge `low`, sonst `medium`.
 */
export function thinkingForTier(
  tier: TaskTier,
  prompt: string,
): ThinkingTarget {
  if (tier === "deep") return "high";
  if (tier === "fast") return prompt.trim().length <= 120 ? "low" : "medium";
  return undefined;
}

const LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** True, wenn `target` unter dem aktuellen Level liegt (FAST senkt nur). */
export function isLowerThan(target: string, current: string): boolean {
  return LEVEL_ORDER.indexOf(target) < LEVEL_ORDER.indexOf(current);
}

export function isHigherThan(target: string, current: string): boolean {
  return LEVEL_ORDER.indexOf(target) > LEVEL_ORDER.indexOf(current);
}
