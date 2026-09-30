/**
 * Kennzeichnet Thinking-Änderungen der Extension `task-tier`, damit
 * `permissions/thinking-control.ts` sie nicht als manuelle Nutzerwahl
 * persistiert. Nur ein Zähler erwarteter Level, kein weiterer Zustand.
 */
const expected: string[] = [];

export function expectAutoThinking(level: string): void {
  expected.push(level);
}

/** True (und verbraucht), wenn `level` eine erwartete Auto-Änderung ist. */
export function consumeAutoThinking(level: string): boolean {
  const index = expected.indexOf(level);
  if (index < 0) return false;
  expected.splice(index, 1);
  return true;
}

export function clearAutoThinking(): void {
  expected.length = 0;
}
