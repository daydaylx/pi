/**
 * Context Ledger — dauerhaftes, kuratiertes Projektgedächtnis.
 *
 * Der Ledger speichert AUSSCHLIESSLICH dauerhaft relevante Fakten
 * (bestätigte Entscheidungen, Architekturentscheidungen, Nicht-Ziele,
 * Einschränkungen, offene Risiken/Fragen, Projektregeln, aktuelle
 * Prioritäten). Er ist bewusst KEIN wachsendes Log, sondern ein ersetzendes
 * Register mit festem Abschnitts-Vertrag und harter Größengrenze.
 *
 * Verantwortungstrennung (keine Doppelrollen):
 * - Pi Core besitzt die Compaction des Chats. Dieser Ledger ersetzt sie nicht.
 * - `docs/PROJECT_STATE.md` bleibt der FLÜCHTIGE Arbeitszustand.
 * - `.agent/plans/decision-brief.md` und `current-plan.md` bleiben die QUELLEN;
 *   dieser Ledger konsolidiert sie deterministisch, ohne Modellaufruf.
 *
 * Alle exportierten Kernfunktionen sind rein und ohne Nebenwirkungen (testbar).
 * Nur `readLedger`, `writeLedgerAtomic` und `consolidateLedger` berühren das
 * Dateisystem.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { readArtifactTriState } from "../plan-mode/utils.ts";

export const CONTEXT_LEDGER_RELATIVE_PATH = "docs/CONTEXT_LEDGER.md";
export const CONTEXT_LEDGER_MAX_BYTES = 32 * 1024;
export const CONTEXT_LEDGER_MAX_LINES = 200;
export const CONTEXT_LEDGER_SCHEMA_VERSION = 1 as const;
export const CONTEXT_LEDGER_META_PREFIX = "CONTEXT-LEDGER-META:";
export const CONTEXT_LEDGER_TOKEN_THRESHOLD = 0.75;

// Fester Abschnitts-Vertrag. Der Writer akzeptiert AUSSCHLIESSLICH diese
// Abschnitte (Whitelist, kein Freitext-Passthrough). Reihenfolge = Priorität.
export const LEDGER_SECTIONS = [
  "Bestätigte Nutzerentscheidungen",
  "Architekturentscheidungen",
  "Nicht-Ziele",
  "Bekannte Einschränkungen",
  "Offene Risiken",
  "Offene Fragen",
  "Wichtige Projektregeln",
  "Aktuelle Prioritäten",
  "Verworfene Optionen",
] as const;

export type LedgerSectionName = (typeof LEDGER_SECTIONS)[number];

// Abschnitte, die bei jeder Konsolidierung ERSETZT werden (aktueller
// Momentanwert), statt dedupliziert angehängt zu werden. Alles andere ist
// dauerhaft und wächst nur durch neue, nicht-duplizierte Einträge.
const REPLACE_SECTIONS: ReadonlySet<LedgerSectionName> = new Set([
  "Aktuelle Prioritäten",
]);

const MAX_PRIORITIES = 5;

// Platzhalter für leere Abschnitte. Wird geschrieben, aber beim Parsen nicht
// als echter Eintrag gewertet (sonst zählte er in der Recovery-Kopfzeile mit).
const EMPTY_PLACEHOLDER = "(keine Einträge)";

export type LedgerTrigger =
  | "plan-to-work"
  | "plan-complete"
  | "decision-brief"
  | "token-threshold"
  | "session-shutdown"
  | "manual";

export interface LedgerMeta {
  schemaVersion: typeof CONTEXT_LEDGER_SCHEMA_VERSION;
  lastCheckpoint: string;
  lastTrigger: LedgerTrigger;
  briefHash?: string;
  planHash?: string;
}

export type LedgerSections = Record<LedgerSectionName, string[]>;

export interface LedgerSources {
  briefContent?: string;
  planContent?: string;
  /** Offene Todos (bereits gefiltert), höchste Priorität zuerst. */
  openPriorities?: string[];
}

export interface LedgerClassification {
  decisions: number;
  nonGoals: number;
  openRisks: number;
  openQuestions: number;
  topPriority: string | undefined;
  /** true, wenn Quell-Hashes (Brief/Plan) vom gespeicherten Stand abweichen. */
  possiblyStale: boolean;
  isEmpty: boolean;
}

// ---------------------------------------------------------------------------
// Sicherheit: „nie automatisch übernehmen" wird technisch erzwungen. Zeilen,
// die wie Secrets, Zugangsdaten, Env-Werte oder absolute Systempfade aussehen,
// werden verworfen — nicht der gesamte Ledger, nur die betroffene Zeile.
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:pass(?:word|wort)|secret|token|api[_-]?key|apikey|client[_-]?secret|private[_-]?key)\b/i,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[A-Z][A-Z0-9_]{3,}=[^\s]/, // ENV_VAR=value
  /\b(?:sk|pk|ghp|gho|xox[baprs])[-_][A-Za-z0-9]{10,}/, // gängige Key-Präfixe
  /\bssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/]{20,}/,
];

export function isSensitiveLine(line: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Normalisiert und säubert eine einzelne Bullet-Zeile. Liefert undefined,
 * wenn die Zeile leer oder sensibel ist (dann wird sie ausgelassen).
 */
export function sanitizeBullet(raw: string): string | undefined {
  const text = raw
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return undefined;
  if (isSensitiveLine(text)) return undefined;
  return text;
}

function normalizeKey(text: string): string {
  return text
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("de-DE");
}

function normalizeHeading(value: string): string {
  return value
    .replace(/^\d+\.\s*/, "")
    .trim()
    .toLocaleLowerCase("de-DE");
}

// ---------------------------------------------------------------------------
// Generisches Abschnitts-Parsing (## Überschriften mit Bullet-Zeilen).
// ---------------------------------------------------------------------------

interface RawSection {
  heading: string;
  lines: string[];
}

function splitSections(content: string): Map<string, RawSection> {
  const lines = content.split(/\r?\n/);
  const sections = new Map<string, RawSection>();
  let current: RawSection | undefined;
  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      current = { heading: match[1].trim(), lines: [] };
      sections.set(normalizeHeading(match[1]), current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections;
}

function bulletLines(section: RawSection | undefined): string[] {
  if (!section) return [];
  const out: string[] = [];
  for (const line of section.lines) {
    if (!/^\s*[-*•]\s+/.test(line)) continue;
    const cleaned = sanitizeBullet(line);
    if (cleaned !== undefined && cleaned !== EMPTY_PLACEHOLDER) out.push(cleaned);
  }
  return out;
}

function emptySections(): LedgerSections {
  return LEDGER_SECTIONS.reduce((acc, name) => {
    acc[name] = [];
    return acc;
  }, {} as LedgerSections);
}

export function parseLedgerSections(content: string): LedgerSections {
  const raw = splitSections(content);
  const result = emptySections();
  for (const name of LEDGER_SECTIONS) {
    result[name] = bulletLines(raw.get(normalizeHeading(name)));
  }
  return result;
}

export function parseLedgerMeta(content: string): LedgerMeta | undefined {
  const match = content.match(
    /<!--\s*CONTEXT-LEDGER-META:\s*(\{[^\r\n]*\})\s*-->/,
  );
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]) as Partial<LedgerMeta>;
    if (value.schemaVersion !== CONTEXT_LEDGER_SCHEMA_VERSION) return undefined;
    if (typeof value.lastCheckpoint !== "string") return undefined;
    return value as LedgerMeta;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Merge: append-dedupe für dauerhafte Abschnitte, replace für Momentanwerte.
// Idempotent — dieselbe Quelle zweimal gemergt ändert nichts.
// ---------------------------------------------------------------------------

function mergeBullets(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map(normalizeKey));
  const merged = [...existing];
  for (const item of incoming) {
    const cleaned = sanitizeBullet(item);
    if (cleaned === undefined) continue;
    const key = normalizeKey(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cleaned);
  }
  return merged;
}

// Zuordnung Decision-Brief-Abschnitt → Ledger-Abschnitt.
const BRIEF_TO_LEDGER: ReadonlyArray<[string, LedgerSectionName]> = [
  ["Entscheidungen", "Bestätigte Nutzerentscheidungen"],
  ["Nicht-Ziele", "Nicht-Ziele"],
  ["Risiken / Constraints", "Offene Risiken"],
  ["Offene Fragen", "Offene Fragen"],
  ["Verworfene Optionen", "Verworfene Optionen"],
];

// Zuordnung Plan-Abschnitt → Ledger-Abschnitt (nur dauerhafte Anteile).
const PLAN_TO_LEDGER: ReadonlyArray<[string, LedgerSectionName]> = [
  ["Nicht-Ziele", "Nicht-Ziele"],
  ["Risiken / Entscheidungen", "Offene Risiken"],
];

function mergeSourceSections(
  sections: LedgerSections,
  content: string,
  mapping: ReadonlyArray<[string, LedgerSectionName]>,
): void {
  const raw = splitSections(content);
  for (const [sourceHeading, target] of mapping) {
    const source = raw.get(normalizeHeading(sourceHeading));
    if (!source) continue;
    sections[target] = mergeBullets(sections[target], bulletLines(source));
  }
}

export interface LedgerUpdateResult {
  content: string;
  sections: LedgerSections;
  changed: boolean;
}

/**
 * Reine Kernfunktion: berechnet den neuen Ledger-Inhalt aus dem bestehenden
 * Inhalt plus den strukturierten Quellen. Kein Dateisystem, kein Modellaufruf.
 */
export function computeLedgerContent(
  projectName: string,
  existingContent: string | undefined,
  sources: LedgerSources,
  trigger: LedgerTrigger,
  now: Date = new Date(),
): LedgerUpdateResult {
  const sections = existingContent
    ? parseLedgerSections(existingContent)
    : emptySections();

  if (sources.briefContent) {
    mergeSourceSections(sections, sources.briefContent, BRIEF_TO_LEDGER);
  }
  if (sources.planContent) {
    mergeSourceSections(sections, sources.planContent, PLAN_TO_LEDGER);
  }
  if (sources.openPriorities && REPLACE_SECTIONS.has("Aktuelle Prioritäten")) {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const item of sources.openPriorities) {
      const value = sanitizeBullet(item);
      if (value === undefined) continue;
      const key = normalizeKey(value);
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(value);
      if (cleaned.length >= MAX_PRIORITIES) break;
    }
    sections["Aktuelle Prioritäten"] = cleaned;
  }

  const meta: LedgerMeta = {
    schemaVersion: CONTEXT_LEDGER_SCHEMA_VERSION,
    lastCheckpoint: now.toISOString(),
    lastTrigger: trigger,
    ...(sources.briefContent
      ? { briefHash: hashContent(sources.briefContent) }
      : {}),
    ...(sources.planContent
      ? { planHash: hashContent(sources.planContent) }
      : {}),
  };

  const content = serializeLedger(projectName, sections, meta);
  const changed =
    existingContent === undefined ||
    stripMeta(existingContent).trim() !== stripMeta(content).trim();
  return { content, sections, changed };
}

function stripMeta(content: string): string {
  return content.replace(
    /<!--\s*CONTEXT-LEDGER-META:[^\r\n]*-->\s*/g,
    "",
  );
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Serialisierung mit Größen-/Zeilengrenze (dauerhaft klein halten).
// ---------------------------------------------------------------------------

export function serializeLedger(
  projectName: string,
  sections: LedgerSections,
  meta: LedgerMeta,
): string {
  const parts: string[] = [`# Context Ledger — ${projectName}`, ""];
  parts.push(
    "<!-- Dauerhaftes Projektgedächtnis. Nur bestätigte, dauerhaft relevante",
    "     Fakten. Keine Logs, Chats, Secrets, Rohdaten. Flüchtiger",
    "     Arbeitszustand gehört in docs/PROJECT_STATE.md. -->",
    "",
  );
  for (const name of LEDGER_SECTIONS) {
    parts.push(`## ${name}`);
    const items = sections[name];
    if (items.length === 0) {
      parts.push(`- ${EMPTY_PLACEHOLDER}`);
    } else {
      for (const item of items) parts.push(`- ${item}`);
    }
    parts.push("");
  }
  parts.push(`<!-- ${CONTEXT_LEDGER_META_PREFIX} ${JSON.stringify(meta)} -->`);
  parts.push("");
  return enforceLimits(parts.join("\n"));
}

function enforceLimits(content: string): string {
  const bytes = Buffer.byteLength(content, "utf8");
  const lineCount = content.split(/\r?\n/).length;
  if (bytes <= CONTEXT_LEDGER_MAX_BYTES && lineCount <= CONTEXT_LEDGER_MAX_LINES)
    return content;
  throw new Error(
    `Context Ledger überschreitet die Grenze (${bytes} Bytes / ${lineCount} Zeilen; ` +
      `maximal ${CONTEXT_LEDGER_MAX_BYTES} Bytes / ${CONTEXT_LEDGER_MAX_LINES} Zeilen). ` +
      `Kuratiere veraltete Einträge, statt den Ledger wachsen zu lassen.`,
  );
}

// ---------------------------------------------------------------------------
// Intelligente Wiederherstellung: Klassifikation für die Recovery-Kopfzeile.
// ---------------------------------------------------------------------------

export function classifyLedger(
  content: string | undefined,
  currentBriefHash?: string,
  currentPlanHash?: string,
): LedgerClassification {
  if (!content) {
    return {
      decisions: 0,
      nonGoals: 0,
      openRisks: 0,
      openQuestions: 0,
      topPriority: undefined,
      possiblyStale: false,
      isEmpty: true,
    };
  }
  const sections = parseLedgerSections(content);
  const meta = parseLedgerMeta(content);
  const possiblyStale =
    (meta?.briefHash !== undefined &&
      currentBriefHash !== undefined &&
      meta.briefHash !== currentBriefHash) ||
    (meta?.planHash !== undefined &&
      currentPlanHash !== undefined &&
      meta.planHash !== currentPlanHash);
  const decisions = sections["Bestätigte Nutzerentscheidungen"].length;
  const nonGoals = sections["Nicht-Ziele"].length;
  const openRisks = sections["Offene Risiken"].length;
  const openQuestions = sections["Offene Fragen"].length;
  return {
    decisions,
    nonGoals,
    openRisks,
    openQuestions,
    topPriority: sections["Aktuelle Prioritäten"][0],
    possiblyStale,
    isEmpty:
      decisions + nonGoals + openRisks + openQuestions === 0 &&
      sections["Aktuelle Prioritäten"].length === 0,
  };
}

/** Kompakte, tokensparsame Kopfzeile für die Session-Start-Recovery. */
export function ledgerSummaryLine(
  classification: LedgerClassification,
): string | undefined {
  if (classification.isEmpty) return undefined;
  const parts = [
    `${classification.decisions} Entscheidung(en)`,
    `${classification.nonGoals} Nicht-Ziel(e)`,
    `${classification.openRisks} offene Risiken`,
  ];
  if (classification.openQuestions > 0) {
    parts.push(`${classification.openQuestions} offene Frage(n)`);
  }
  let line = `Context Ledger: ${parts.join(", ")}.`;
  if (classification.topPriority) {
    line += ` Priorität: ${classification.topPriority}.`;
  }
  if (classification.possiblyStale) {
    line += " Hinweis: Quell-Hash geändert, Einträge ggf. veraltet prüfen.";
  }
  line += ` Voller Inhalt bei Bedarf: ${CONTEXT_LEDGER_RELATIVE_PATH}.`;
  return line;
}

// ---------------------------------------------------------------------------
// Token-Proxy für „vor Compaction". Pi Core besitzt keinen before_compaction-
// Hook; deshalb konsolidieren wir konservativ VOR Pis Schwelle, einmal je
// Fensterzyklus (das Flag verwaltet der Aufrufer).
// ---------------------------------------------------------------------------

export function shouldCheckpointForTokens(
  usedTokens: number,
  contextWindow: number,
  threshold: number = CONTEXT_LEDGER_TOKEN_THRESHOLD,
): boolean {
  if (!Number.isFinite(usedTokens) || usedTokens <= 0) return false;
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return false;
  return usedTokens / contextWindow >= threshold;
}

// ---------------------------------------------------------------------------
// Dateisystem: symlink-sicheres Lesen/Schreiben (Muster analog plan-mode).
// ---------------------------------------------------------------------------

function isInside(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function assertNoSymlinkComponents(basePath: string, candidatePath: string): void {
  if (!isInside(basePath, candidatePath)) {
    throw new Error(`Pfad verlässt das Arbeitsverzeichnis: ${candidatePath}`);
  }
  const rel = relative(basePath, candidatePath);
  let current = basePath;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symbolische Links sind im Ledger-Pfad nicht erlaubt: ${current}`);
    }
  }
}

export function getLedgerPath(cwd: string): string {
  return resolve(cwd, CONTEXT_LEDGER_RELATIVE_PATH);
}

export function readLedger(cwd: string): string | undefined {
  const result = readArtifactTriState(
    cwd,
    CONTEXT_LEDGER_RELATIVE_PATH,
    CONTEXT_LEDGER_MAX_BYTES,
  );
  if (result.status === "missing") return undefined;
  if (result.status === "unreadable") throw new Error(result.error);
  return result.content;
}

export function writeLedgerAtomic(cwd: string, content: string): void {
  enforceLimits(content);
  const root = resolve(cwd);
  const ledgerPath = getLedgerPath(root);
  const ledgerDir = dirname(ledgerPath);
  assertNoSymlinkComponents(root, ledgerDir);
  mkdirSync(ledgerDir, { recursive: true });
  assertNoSymlinkComponents(root, ledgerPath);

  const mode = existsSync(ledgerPath)
    ? statSync(ledgerPath).mode & 0o777
    : 0o600;
  const temporaryPath = `${ledgerPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx", mode });
    renameSync(temporaryPath, ledgerPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

/**
 * Orchestriert eine Konsolidierung: liest den bestehenden Ledger plus die
 * strukturierten Quellen und schreibt den zusammengeführten Stand atomar —
 * nur wenn sich inhaltlich etwas geändert hat. Kein Modellaufruf.
 * Liefert true, wenn geschrieben wurde.
 */
export function consolidateLedger(
  cwd: string,
  projectName: string,
  sources: LedgerSources,
  trigger: LedgerTrigger,
  now: Date = new Date(),
): boolean {
  const existing = readLedger(cwd);
  const result = computeLedgerContent(
    projectName,
    existing,
    sources,
    trigger,
    now,
  );
  if (!result.changed) return false;
  writeLedgerAtomic(cwd, result.content);
  return true;
}
