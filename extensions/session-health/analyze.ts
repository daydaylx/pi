/**
 * Read-only-Auswertung von Pi-Session-JSONLs für /session-health.
 *
 * Die Session-JSONL ist die einzige autoritative Workflow-Historie. Diese
 * Funktionen lesen ausschließlich strukturierte Custom-Einträge und rohe
 * Zeilenstatistik; sie schreiben nichts und erfinden keine Gesamtwertung.
 * `run-history.jsonl` bleibt eine separat ausgewiesene Rohhistorie und wird
 * hier höchstens als Zeilen-/Zeitstempelsummen erwähnt.
 */
import { readFileSync } from "node:fs";
import {
  gateRequiresInspection,
  latestRecoveryGate,
} from "../resilience/recovery-state.ts";

export interface SessionHealthTurns {
  total: number;
  completed: number;
  completedAfterFailure: number;
  failed: number;
  /** Turn-Starts ohne passendes Settled — abgebrochen oder noch offen. */
  open: number;
}

export interface SessionHealthRecovery {
  required: number;
  checked: number;
  /** Gates, die eine Prüfung verlangen und keine hatten (pro Session). */
  uncheckedGates: number;
}

export interface SessionHealthFailures {
  total: number;
  byClass: Record<string, number>;
  byProvider: Record<string, number>;
  byPhase: Record<string, number>;
}

export interface SessionHealthPermissions {
  transitions: number;
  denied: number;
  deniedYoloAttempts: number;
  yoloOverrides: number;
}

export interface SessionHealthVerifier {
  completed: number;
  incomplete: number;
  byVerdict: Record<string, number>;
  incompleteReasons: Record<string, number>;
}

export interface SessionHealthReport {
  files: number;
  entries: number;
  parseErrors: number;
  turns: SessionHealthTurns;
  recovery: SessionHealthRecovery;
  failures: SessionHealthFailures;
  permissions: SessionHealthPermissions;
  verifier: SessionHealthVerifier;
  compactionFailures: number;
}

export function emptySessionHealthReport(): SessionHealthReport {
  return {
    files: 0,
    entries: 0,
    parseErrors: 0,
    turns: {
      total: 0,
      completed: 0,
      completedAfterFailure: 0,
      failed: 0,
      open: 0,
    },
    recovery: { required: 0, checked: 0, uncheckedGates: 0 },
    failures: { total: 0, byClass: {}, byProvider: {}, byPhase: {} },
    permissions: {
      transitions: 0,
      denied: 0,
      deniedYoloAttempts: 0,
      yoloOverrides: 0,
    },
    verifier: {
      completed: 0,
      incomplete: 0,
      byVerdict: {},
      incompleteReasons: {},
    },
    compactionFailures: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function customData<T>(entry: unknown, customType: string): T | undefined {
  if (!isRecord(entry)) return undefined;
  return entry.type === "custom" && entry.customType === customType
    ? (entry.data as T)
    : undefined;
}

function bump(map: Record<string, number>, key: string | undefined): void {
  const safe = key ?? "unknown";
  map[safe] = (map[safe] ?? 0) + 1;
}

export function parseSessionLines(text: string): {
  entries: unknown[];
  parseErrors: number;
} {
  const entries: unknown[] = [];
  let parseErrors = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      parseErrors += 1;
    }
  }
  return { entries, parseErrors };
}

function entryTimestampMs(entry: unknown): number | undefined {
  if (!isRecord(entry) || typeof entry.timestamp !== "string") return undefined;
  const ms = Date.parse(entry.timestamp);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Wertet die Einträge einer einzelnen Session-Datei aus. Gates und offene
 * Turns werden pro Session geführt — ein Gate der einen Sitzung darf die
 * andere nicht entsperren oder belasten.
 */
export function aggregateSessionEntries(
  entries: readonly unknown[],
  report: SessionHealthReport,
  sinceMs?: number,
): void {
  const openTurns = new Set<string>();
  for (const rawEntry of entries) {
    if (sinceMs !== undefined) {
      const ms = entryTimestampMs(rawEntry);
      if (ms !== undefined && ms < sinceMs) continue;
    }
    report.entries += 1;

    const start = customData<{ timestamp?: unknown }>(
      rawEntry,
      "resilience.turn-start",
    );
    if (start && typeof start.timestamp === "string") {
      report.turns.total += 1;
      openTurns.add(start.timestamp);
      continue;
    }
    const settled = customData<{
      turnStartedAt?: unknown;
      outcome?: unknown;
    }>(rawEntry, "resilience.turn-settled");
    if (settled && typeof settled.turnStartedAt === "string") {
      openTurns.delete(settled.turnStartedAt);
      if (settled.outcome === "failed") report.turns.failed += 1;
      else if (settled.outcome === "completed_after_failure")
        report.turns.completedAfterFailure += 1;
      else report.turns.completed += 1;
      continue;
    }
    const required = customData<Record<string, unknown>>(
      rawEntry,
      "resilience.recovery-required",
    );
    if (required) {
      report.recovery.required += 1;
      continue;
    }
    const checked = customData<Record<string, unknown>>(
      rawEntry,
      "resilience.recovery-checked",
    );
    if (checked) {
      report.recovery.checked += 1;
      continue;
    }
    const failure = customData<{
      errorClass?: unknown;
      provider?: unknown;
      phase?: unknown;
    }>(rawEntry, "resilience.failure");
    if (failure) {
      report.failures.total += 1;
      bump(
        report.failures.byClass,
        typeof failure.errorClass === "string" ? failure.errorClass : undefined,
      );
      bump(
        report.failures.byProvider,
        typeof failure.provider === "string" ? failure.provider : undefined,
      );
      bump(
        report.failures.byPhase,
        typeof failure.phase === "string" ? failure.phase : undefined,
      );
      continue;
    }
    const boundary = customData<{ boundary?: unknown }>(
      rawEntry,
      "resilience.compaction-boundary",
    );
    if (boundary && boundary.boundary === "failed") {
      report.compactionFailures += 1;
      continue;
    }
    const transition = customData<{ state?: unknown }>(
      rawEntry,
      "permission-transition",
    );
    if (transition) {
      report.permissions.transitions += 1;
      if (transition.state === "YOLO_OVERRIDE")
        report.permissions.yoloOverrides += 1;
      continue;
    }
    const denied = customData<{ attemptedLevel?: unknown }>(
      rawEntry,
      "permission-transition-denied",
    );
    if (denied) {
      report.permissions.denied += 1;
      if (denied.attemptedLevel === "yolo")
        report.permissions.deniedYoloAttempts += 1;
      continue;
    }
    const verifierRun = customData<{
      status?: unknown;
      verdict?: unknown;
      reason?: unknown;
    }>(rawEntry, "verifier-run");
    if (verifierRun) {
      if (verifierRun.status === "incomplete") {
        report.verifier.incomplete += 1;
        bump(
          report.verifier.incompleteReasons,
          typeof verifierRun.reason === "string" ? verifierRun.reason : undefined,
        );
      } else {
        report.verifier.completed += 1;
        if (typeof verifierRun.verdict === "string")
          bump(report.verifier.byVerdict, verifierRun.verdict);
      }
      continue;
    }
  }
  report.turns.open += openTurns.size;

  const gate = latestRecoveryGate(entries);
  if (
    gate &&
    gateRequiresInspection(gate.required) &&
    !gate.checked
  ) {
    report.recovery.uncheckedGates += 1;
  }
}

/** Liest eine Session-Datei und faltet sie in den Bericht. */
export function aggregateSessionFile(
  path: string,
  report: SessionHealthReport,
  sinceMs?: number,
): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    report.parseErrors += 1;
    return;
  }
  const { entries, parseErrors } = parseSessionLines(text);
  report.parseErrors += parseErrors;
  report.files += 1;
  aggregateSessionEntries(entries, report, sinceMs);
}

const RECORD_ORDER = new Intl.Collator("de");

export function formatCounts(map: Record<string, number>): string {
  const keys = Object.keys(map).sort(RECORD_ORDER.compare);
  if (keys.length === 0) return "keine";
  return keys.map((key) => `${key}: ${map[key]}`).join(", ");
}

export function formatSessionHealth(report: SessionHealthReport): string {
  const lines = [
    "Session-Health",
    `  Dateien: ${report.files} · Einträge: ${report.entries} · Parsefehler: ${report.parseErrors}`,
    `  Turns: ${report.turns.total} gesamt · ${report.turns.completed} abgeschlossen · ${report.turns.completedAfterFailure} nach Fehler fortgesetzt · ${report.turns.failed} fehlgeschlagen · ${report.turns.open} offen/unbesiedelt`,
    `  Recovery: ${report.recovery.required} erforderlich · ${report.recovery.checked} geprüft · ${report.recovery.uncheckedGates} offene Gates`,
    `  Fehler: ${report.failures.total} gesamt`,
    `    nach Klasse: ${formatCounts(report.failures.byClass)}`,
    `    nach Provider: ${formatCounts(report.failures.byProvider)}`,
    `    nach Phase: ${formatCounts(report.failures.byPhase)}`,
    `  Berechtigungen: ${report.permissions.transitions} Übergänge · ${report.permissions.yoloOverrides} YOLO-Overrides · ${report.permissions.denied} verweigert (${report.permissions.deniedYoloAttempts} YOLO-Versuche)`,
    `  Verifier: ${report.verifier.completed} abgeschlossen (${formatCounts(report.verifier.byVerdict)}) · ${report.verifier.incomplete} unvollständig (${formatCounts(report.verifier.incompleteReasons)})`,
    `  Kompaktierungen fehlgeschlagen: ${report.compactionFailures}`,
    "  Hinweis: run-history.jsonl ist eine rohe Test-/Legacy-Historie und fließt nicht in diese Auswertung ein. Sessions ohne verifier-run-Einträge (Altbestand) erscheinen in der Verifier-Zeile nicht.",
  ];
  return lines.join("\n");
}
