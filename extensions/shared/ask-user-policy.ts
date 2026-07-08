export const MIN_QUESTION_OPTIONS = 2;
export const MAX_QUESTION_OPTIONS = 4;

export function hasValidQuestionOptionCount(count: number): boolean {
  return count >= MIN_QUESTION_OPTIONS && count <= MAX_QUESTION_OPTIONS;
}

/**
 * Resolves a single-digit keypress ("1".."N") to the 1-based option index,
 * or `undefined` if the input is not a direct-selection digit.
 *
 * Only real options (1..optionCount) are reachable this way; the inline
 * "Freitext" editor stays reachable via arrow keys + Enter. Multi-byte input
 * (arrow/escape sequences) and non-digit characters never match.
 */
export function digitSelection(
  data: string,
  optionCount: number,
): number | undefined {
  if (typeof data !== "string" || data.length !== 1 || optionCount < 1) {
    return undefined;
  }
  const digit = data.charCodeAt(0) - 48; // "0" === 48
  if (digit >= 1 && digit <= optionCount) return digit;
  return undefined;
}

/** Shared niedrig/mittel/hoch vocabulary for effort/risk, so the TypeBox schema (ask-user.ts) and rendering text never drift apart. */
export const LEVELS = ["niedrig", "mittel", "hoch"] as const;
export type Level = (typeof LEVELS)[number];

/**
 * Validity check for historical rendering (renderCall/renderResult on tool
 * calls recorded before recommendedIndex existed, or from resumed sessions).
 * Deliberately NOT clamped: clamping here would fabricate a recommendation
 * on old data that was never actually made.
 */
export function isValidRecommendedIndex(
  recommendedIndex: number,
  optionCount: number,
): boolean {
  return (
    Number.isInteger(recommendedIndex) &&
    recommendedIndex >= 1 &&
    recommendedIndex <= optionCount
  );
}

/**
 * Normalizes recommendedIndex for a fresh execute() call. Unlike
 * hasValidQuestionOptionCount, an out-of-range index is purely cosmetic (it
 * only affects the EMPFOHLEN tag and the Enter default), so it is clamped
 * rather than rejected. Do not use this for historical rendering — see
 * isValidRecommendedIndex.
 */
export function clampRecommendedIndex(
  recommendedIndex: number,
  optionCount: number,
): number {
  const safeCount = Math.max(1, optionCount);
  if (!Number.isInteger(recommendedIndex)) return 1;
  return Math.min(Math.max(recommendedIndex, 1), safeCount);
}
