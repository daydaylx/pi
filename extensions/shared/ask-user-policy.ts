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
