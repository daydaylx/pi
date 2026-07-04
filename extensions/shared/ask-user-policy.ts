export const MIN_QUESTION_OPTIONS = 2;
export const MAX_QUESTION_OPTIONS = 4;

export function hasValidQuestionOptionCount(count: number): boolean {
  return count >= MIN_QUESTION_OPTIONS && count <= MAX_QUESTION_OPTIONS;
}
