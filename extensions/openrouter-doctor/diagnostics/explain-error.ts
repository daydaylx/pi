/** Turns a NormalizedError into report-ready German text lines. */
import type { NormalizedError } from "../types.ts";

export function explainError(error: NormalizedError, options: { details?: boolean } = {}): string[] {
  const lines: string[] = [error.humanSummary];
  if (error.likelyCauses.length > 0) {
    lines.push("  Mögliche Ursachen:");
    for (const cause of error.likelyCauses) lines.push(`    - ${cause}`);
  }
  if (error.retryAfterSeconds !== undefined) {
    lines.push(`  Retry-After: ${error.retryAfterSeconds}s`);
  }
  lines.push(`  Empfehlung: ${error.recommendedAction}`);
  if (options.details && error.rawDetails) {
    const { status, code, message } = error.rawDetails;
    const detailParts = [
      status !== undefined ? `status=${status}` : undefined,
      code ? `code=${code}` : undefined,
      message ? `message=${message}` : undefined,
    ].filter((part): part is string => Boolean(part));
    if (detailParts.length > 0) lines.push(`  Technisch: ${detailParts.join(", ")}`);
  }
  return lines;
}
