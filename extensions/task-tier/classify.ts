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
  if (text.length > FAST_MAX_CHARS) return "normal";
  if (paths.length > FAST_MAX_PATHS) return "normal";
  if (BROAD_PATTERN.test(text)) return "normal";
  const listItems = text.match(/^\s*(?:[-*]|\d+[.)])\s+/gm)?.length ?? 0;
  if (listItems > FAST_MAX_LIST_ITEMS) return "normal";
  return "fast";
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
