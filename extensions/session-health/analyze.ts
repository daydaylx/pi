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
  aborted: number;
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

/** Modell- und Tool-Nutzung aus den Nachrichteneinträgen der Sessions. */
export interface SessionHealthUsage {
  userMessages: number;
  requests: number;
  /** Requests, die mit `stopReason: "error"` endeten. */
  requestErrors: number;
  toolCalls: number;
  toolErrors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  toolCallsByName: Record<string, number>;
  toolErrorsByName: Record<string, number>;
  /** Roh-Stichprobe der Request-Dauer; `summarizeUsage` verdichtet sie. */
  latencySamplesMs: number[];
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
  usage: SessionHealthUsage;
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
      aborted: 0,
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
    usage: {
      userMessages: 0,
      requests: 0,
      requestErrors: 0,
      toolCalls: 0,
      toolErrors: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      toolCallsByName: {},
      toolErrorsByName: {},
      latencySamplesMs: [],
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

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Faltet eine Nachricht (user/assistant/toolResult) in die Nutzungszahlen. */
function aggregateMessage(
  entry: Record<string, unknown>,
  usage: SessionHealthUsage,
): boolean {
  if (entry.type !== "message" || !isRecord(entry.message)) return false;
  const message = entry.message;
  if (message.role === "user") {
    usage.userMessages += 1;
  } else if (message.role === "assistant") {
    usage.requests += 1;
    if (message.stopReason === "error") usage.requestErrors += 1;
    if (isRecord(message.usage)) {
      usage.inputTokens += numberOr0(message.usage.input);
      usage.outputTokens += numberOr0(message.usage.output);
      usage.cacheReadTokens += numberOr0(message.usage.cacheRead);
      if (isRecord(message.usage.cost))
        usage.costUsd += numberOr0(message.usage.cost.total);
    }
    const duration = numberOr0(message.durationMs);
    if (duration > 0) usage.latencySamplesMs.push(duration);
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (isRecord(block) && block.type === "toolCall") {
          usage.toolCalls += 1;
          bump(
            usage.toolCallsByName,
            typeof block.name === "string" ? block.name : undefined,
          );
        }
      }
    }
  } else if (message.role === "toolResult" && message.isError === true) {
    usage.toolErrors += 1;
    bump(
      usage.toolErrorsByName,
      typeof message.toolName === "string" ? message.toolName : undefined,
    );
  }
  return true;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ]!;
}

/** Abgeleitete Kennzahlen; ohne die Roh-Stichprobe, daher JSON-tauglich. */
export function summarizeUsage(usage: SessionHealthUsage) {
  const { latencySamplesMs, ...counts } = usage;
  const sorted = [...latencySamplesMs].sort((a, b) => a - b);
  const prompt = usage.inputTokens + usage.cacheReadTokens;
  return {
    ...counts,
    cacheShare: prompt > 0 ? usage.cacheReadTokens / prompt : 0,
    toolCallsPerUserMessage:
      usage.userMessages > 0 ? usage.toolCalls / usage.userMessages : 0,
    toolErrorRate: usage.toolCalls > 0 ? usage.toolErrors / usage.toolCalls : 0,
    latencyMedianMs: percentile(sorted, 0.5),
    latencyP90Ms: percentile(sorted, 0.9),
  };
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

    if (isRecord(rawEntry) && aggregateMessage(rawEntry, report.usage))
      continue;

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
      else if (settled.outcome === "aborted") report.turns.aborted += 1;
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
          typeof verifierRun.reason === "string"
            ? verifierRun.reason
            : undefined,
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
  if (gate && gateRequiresInspection(gate.required) && !gate.checked) {
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

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} k`;
  return String(value);
}

function topCounts(map: Record<string, number>, limit: number): string {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "keine";
  return entries
    .slice(0, limit)
    .map(([key, count]) => `${key}: ${count}`)
    .join(", ");
}

export function formatCounts(map: Record<string, number>): string {
  const keys = Object.keys(map).sort(RECORD_ORDER.compare);
  if (keys.length === 0) return "keine";
  return keys.map((key) => `${key}: ${map[key]}`).join(", ");
}

export function formatSessionHealth(report: SessionHealthReport): string {
  const lines = [
    "Session-Health",
    `  Dateien: ${report.files} · Einträge: ${report.entries} · Parsefehler: ${report.parseErrors}`,
    `  Turns: ${report.turns.total} gesamt · ${report.turns.completed} abgeschlossen · ${report.turns.completedAfterFailure} nach Fehler fortgesetzt · ${report.turns.failed} fehlgeschlagen · ${report.turns.aborted} abgebrochen · ${report.turns.open} offen/unbesiedelt`,
    `  Recovery: ${report.recovery.required} erforderlich · ${report.recovery.checked} geprüft · ${report.recovery.uncheckedGates} offene Gates`,
    `  Fehler: ${report.failures.total} gesamt`,
    `    nach Klasse: ${formatCounts(report.failures.byClass)}`,
    `    nach Provider: ${formatCounts(report.failures.byProvider)}`,
    `    nach Phase: ${formatCounts(report.failures.byPhase)}`,
    `  Berechtigungen: ${report.permissions.transitions} Übergänge · ${report.permissions.yoloOverrides} YOLO-Overrides · ${report.permissions.denied} verweigert (${report.permissions.deniedYoloAttempts} YOLO-Versuche)`,
    `  Verifier: ${report.verifier.completed} abgeschlossen (${formatCounts(report.verifier.byVerdict)}) · ${report.verifier.incomplete} unvollständig (${formatCounts(report.verifier.incompleteReasons)})`,
    ...formatUsage(report.usage),
    `  Kompaktierungen fehlgeschlagen: ${report.compactionFailures}`,
    "  Hinweis: run-history.jsonl ist eine rohe Test-/Legacy-Historie und fließt nicht in diese Auswertung ein. Sessions ohne verifier-run-Einträge (Altbestand) erscheinen in der Verifier-Zeile nicht.",
  ];
  return lines.join("\n");
}

function formatUsage(usage: SessionHealthUsage): string[] {
  const summary = summarizeUsage(usage);
  return [
    `  Nutzung: ${usage.userMessages} Nutzernachrichten · ${usage.requests} Requests (${usage.requestErrors} mit Fehler) · ${usage.toolCalls} Tool-Calls (${usage.toolErrors} fehlgeschlagen, ${(summary.toolErrorRate * 100).toFixed(1)} %) · Ø ${summary.toolCallsPerUserMessage.toFixed(1)} Tool-Calls je Nutzernachricht`,
    `    Tokens: ${formatTokens(usage.inputTokens)} Input · ${formatTokens(usage.outputTokens)} Output · ${formatTokens(usage.cacheReadTokens)} Cache-Read (${(summary.cacheShare * 100).toFixed(1)} % des Prompts) · Kosten $${usage.costUsd.toFixed(2)}`,
    `    Request-Dauer: Median ${(summary.latencyMedianMs / 1000).toFixed(1)} s · p90 ${(summary.latencyP90Ms / 1000).toFixed(1)} s`,
    `    Tool-Calls: ${topCounts(usage.toolCallsByName, 8)}`,
    `    Fehlgeschlagen: ${topCounts(usage.toolErrorsByName, 6)}`,
  ];
}
