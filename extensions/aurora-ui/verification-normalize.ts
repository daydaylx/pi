/**
 * The one place that strips the footer's UI-formatted "Verify: <status>"
 * prefix back to the raw status enum. Every internal decision (task phase,
 * footer tone/attention, staleness) must compare against this normalized
 * value, never against the display string a renderer produced.
 */
export function normalizeVerificationLabel(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  return raw.replace(/^Verify:\s*/, "");
}

/**
 * German display text for a normalized status — for rendering only. Internal
 * decisions compare the normalized enum from {@link normalizeVerificationLabel}
 * above, never this text. Any status this project doesn't declare here still
 * shows (as itself) rather than disappearing, since a renderer must never
 * hide a real, if unexpected, runtime value.
 */
export function verificationDisplayLabel(normalized: string): string {
  switch (normalized) {
    case "verified":
      return "verifiziert";
    case "checks_failed":
      return "Prüfung fehlgeschlagen";
    case "unchanged":
      return "unverändert";
    default:
      return normalized;
  }
}
