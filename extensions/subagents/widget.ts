/**
 * Reaktives Subagenten-Widget.
 *
 * Sicherheitsregel: Es werden keine rohe Chain-of-Thought oder versteckte
 * Reasoning-Tokens gerendert. Debug zeigt nur explizit gesetzte Statusfelder.
 */

const MAX_WIDGET_LINES = 4;
const MAX_COMPACT_LINES = 2;
const MAX_SA_LINE_WIDTH = 90;
const MAX_TEXT_LENGTH = 100;
const MAX_DISPLAYED_AGENTS = 8;
// Fertige Läufe verfallen nach dieser Zeit, sonst wächst die Map unbegrenzt,
// weil jede Run-ID eindeutig ist.
const DONE_ENTRY_TTL_MS = 5 * 60 * 1000;

export type WidgetMode =
  | "active-only"
  | "on"
  | "off"
  | "compact"
  | "debug";

export type SubagentStatus =
  | "idle"
  | "queued"
  | "waiting"
  | "running"
  | "done"
  | "completed"
  | "warning"
  | "failed"
  | "blocked";

export const STATUS_SYMBOL: Record<SubagentStatus, string> = {
  done: "✓",
  completed: "✓",
  running: "●",
  waiting: "○",
  warning: "!",
  failed: "✕",
  blocked: "⏸",
  idle: "○",
  queued: "○",
};

export const STATUS_LABEL: Record<SubagentStatus, string> = {
  done: "abgeschlossen",
  completed: "abgeschlossen",
  running: "läuft",
  waiting: "wartet",
  warning: "Warnung",
  failed: "fehlgeschlagen",
  blocked: "blockiert",
  idle: "inaktiv",
  queued: "eingeplant",
};

export interface SubagentEntry {
  id: string;
  label: string;
  status: SubagentStatus;
  currentTask: string;
  lastUpdate: number;
  role?: string;
  lastAction?: string;
  warnings?: number;
  errors?: number;
  startedAt?: number;
  completedAt?: number;
  parentAgentId?: string;
  relatedToolCalls?: string[];
  risk?: string;
}

export interface LastSubagentRun {
  agent: string;
  mode: string;
  time: string;
}

export interface WidgetState {
  mode: WidgetMode;
  visible: boolean;
  compact: boolean;
  debug: boolean;
  subagentsLoaded: boolean;
  agentCount: number;
  lastRun?: LastSubagentRun;
  subagents: Map<string, SubagentEntry>;
  model?: string;
  thinking?: string;
  now?: string;
  think?: string;
  next?: string;
  risk?: string;
}

function createWidgetState(): WidgetState {
  return {
    mode: "active-only",
    visible: true,
    compact: true,
    debug: false,
    subagentsLoaded: false,
    agentCount: 0,
    subagents: new Map(),
  };
}

let widgetState: WidgetState = createWidgetState();
const widgetChangeListeners = new Set<() => void>();

function notifyWidgetChange(): void {
  for (const listener of widgetChangeListeners) {
    try {
      listener();
    } catch {
      // Eine rein visuelle Aktualisierung darf Subagentenläufe nicht stören.
    }
  }
}

export function onWidgetChange(listener: () => void): () => void {
  widgetChangeListeners.add(listener);
  return () => widgetChangeListeners.delete(listener);
}

export function getWidgetState(): WidgetState {
  return widgetState;
}

export function resetWidgetState(): void {
  widgetState = createWidgetState();
  notifyWidgetChange();
}

export function setWidgetMode(mode: WidgetMode): void {
  widgetState.mode = mode;
  widgetState.visible = mode !== "off";
  widgetState.compact =
    mode === "active-only" || mode === "compact" || mode === "off";
  widgetState.debug = mode === "debug";
  notifyWidgetChange();
}

// Kompatibilitäts-Setter für bestehende Aufrufer. Neue UI-Pfade verwenden
// setWidgetMode(), damit die Modi eindeutig bleiben.
export function setWidgetVisible(visible: boolean): void {
  widgetState.visible = visible;
  if (!visible) widgetState.mode = "off";
  else if (widgetState.mode === "off") widgetState.mode = "active-only";
  notifyWidgetChange();
}

export function setWidgetCompact(compact: boolean): void {
  widgetState.compact = compact;
  if (widgetState.visible && !widgetState.debug) {
    widgetState.mode = compact ? "compact" : "on";
  }
  notifyWidgetChange();
}

export function setWidgetDebug(debug: boolean): void {
  widgetState.debug = debug;
  widgetState.visible = true;
  widgetState.mode = debug
    ? "debug"
    : widgetState.compact
      ? "compact"
      : "on";
  notifyWidgetChange();
}

export function setSubagentAvailability(
  loaded: boolean,
  agentCount: number,
): void {
  widgetState.subagentsLoaded = loaded;
  widgetState.agentCount = Math.max(0, agentCount);
  notifyWidgetChange();
}

function defaultLastRunTime(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function setLastRun(
  agent: string,
  mode: string,
  time = defaultLastRunTime(),
): void {
  widgetState.lastRun = { agent, mode, time };
  notifyWidgetChange();
}

export function setModel(model?: string): void {
  widgetState.model = model;
  notifyWidgetChange();
}

export function setThinking(thinking?: string): void {
  widgetState.thinking = thinking;
  notifyWidgetChange();
}

export function setNow(text?: string): void {
  widgetState.now = text;
  notifyWidgetChange();
}

export function setThink(text?: string): void {
  widgetState.think = text;
  notifyWidgetChange();
}

export function setNext(text?: string): void {
  widgetState.next = text;
  notifyWidgetChange();
}

export function setRisk(text?: string): void {
  widgetState.risk = text;
  notifyWidgetChange();
}

function isActiveStatus(status: SubagentStatus): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "waiting"
  );
}

export function upsertSubagent(entry: SubagentEntry): void {
  const now = Date.now();
  const existing = widgetState.subagents.get(entry.id);
  const startedAt =
    entry.startedAt ??
    existing?.startedAt ??
    (isActiveStatus(entry.status) ? now : undefined);

  widgetState.subagents.set(entry.id, {
    ...existing,
    ...entry,
    startedAt,
    lastUpdate: now,
  });

  const cutoff = now - DONE_ENTRY_TTL_MS;
  for (const [id, candidate] of widgetState.subagents) {
    if (
      (candidate.status === "done" ||
        candidate.status === "completed" ||
        candidate.status === "warning" ||
        candidate.status === "failed" ||
        candidate.status === "blocked") &&
      candidate.lastUpdate < cutoff
    ) {
      widgetState.subagents.delete(id);
    }
  }
  notifyWidgetChange();
}

export function removeSubagent(id: string): void {
  widgetState.subagents.delete(id);
  notifyWidgetChange();
}

export function clearSubagents(): void {
  widgetState.subagents.clear();
  notifyWidgetChange();
}

function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  );
}

function isCombiningChar(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (isCombiningChar(code)) return 0;
  return isWideChar(code) ? 2 : 1;
}

function visibleWidth(value: string): number {
  let width = 0;
  for (const char of value) width += charWidth(char);
  return width;
}

function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  if (visibleWidth(value) <= max) return value;
  const ellipsis = "…";
  const ellipsisWidth = visibleWidth(ellipsis);
  if (max <= ellipsisWidth) return ellipsis;

  let result = "";
  let width = 0;
  const targetWidth = max - ellipsisWidth;
  for (const char of value) {
    const nextWidth = width + charWidth(char);
    if (nextWidth > targetWidth) break;
    result += char;
    width = nextWidth;
  }
  return `${result}${ellipsis}`;
}

function normalizeRenderWidth(width?: number): number | undefined {
  if (typeof width !== "number" || !Number.isFinite(width)) return undefined;
  return Math.max(1, Math.floor(width));
}

const STATUS_PRIORITY: Record<SubagentStatus, number> = {
  failed: 0,
  blocked: 1,
  warning: 2,
  running: 3,
  waiting: 4,
  queued: 5,
  done: 6,
  completed: 7,
  idle: 8,
};

function relevantEntries(state: WidgetState): SubagentEntry[] {
  return Array.from(state.subagents.values())
    .filter(
      (entry) =>
        entry.status === "failed" ||
        entry.status === "blocked" ||
        entry.status === "warning" ||
        entry.status === "running" ||
        entry.status === "waiting" ||
        entry.status === "queued",
    )
    .sort(
      (a, b) =>
        STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
        b.lastUpdate - a.lastUpdate,
    );
}

function cleanText(value?: string): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatCounts(entry: SubagentEntry): string | undefined {
  const counts: string[] = [];
  if ((entry.errors ?? 0) > 0) {
    counts.push(countLabel(entry.errors ?? 0, "Fehler", "Fehler"));
  }
  if ((entry.warnings ?? 0) > 0) {
    counts.push(countLabel(entry.warnings ?? 0, "Warnung", "Warnungen"));
  }
  return counts.length > 0 ? counts.join(" · ") : undefined;
}

function formatElapsed(entry: SubagentEntry): string | undefined {
  if (entry.startedAt === undefined) return undefined;
  const end = entry.completedAt ?? Date.now();
  const seconds = Math.max(0, Math.floor((end - entry.startedAt) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

function formatRelativeTime(time: string): string | undefined {
  const timestamp = Date.parse(time);
  if (!Number.isFinite(timestamp)) return undefined;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `vor ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  return `vor ${Math.floor(hours / 24)} d`;
}

function formatRunMode(mode: string): string {
  switch (mode) {
    case "single":
      return "einzeln";
    case "chain":
      return "Kette";
    case "list":
      return "Liste";
    default:
      return mode;
  }
}

function formatSubagentLine(entry: SubagentEntry): string {
  const parts = [
    `${STATUS_SYMBOL[entry.status]} ${entry.label}`,
    STATUS_LABEL[entry.status],
  ];
  const activity = cleanText(entry.lastAction) ?? cleanText(entry.currentTask);
  if (activity) parts.push(truncate(activity, 44));
  const elapsed = formatElapsed(entry);
  if (elapsed) parts.push(elapsed);
  const counts = formatCounts(entry);
  if (counts) parts.push(counts);
  return truncate(parts.join(" · "), MAX_SA_LINE_WIDTH);
}

function hasGenuineWarning(state: WidgetState): boolean {
  if (cleanText(state.risk)) return true;
  return Array.from(state.subagents.values()).some(
    (entry) =>
      (entry.warnings ?? 0) > 0 ||
      (entry.errors ?? 0) > 0 ||
      Boolean(cleanText(entry.risk)),
  );
}

function warningLine(
  state: WidgetState,
  visibleEntries: SubagentEntry[],
): string | undefined {
  const risk = cleanText(state.risk);
  const riskAlreadyVisible =
    risk !== undefined &&
    visibleEntries.some(
      (entry) =>
        cleanText(entry.risk) === risk || cleanText(entry.lastAction) === risk,
    );
  if (risk && !riskAlreadyVisible) {
    return `Warnung: ${truncate(risk, MAX_TEXT_LENGTH - 10)}`;
  }

  const hidden = Array.from(state.subagents.values()).filter(
    (entry) => !visibleEntries.includes(entry),
  );
  const errors = hidden.reduce((sum, entry) => sum + (entry.errors ?? 0), 0);
  const warnings = hidden.reduce(
    (sum, entry) => sum + (entry.warnings ?? 0),
    0,
  );
  const parts: string[] = [];
  if (errors > 0) parts.push(countLabel(errors, "Fehler", "Fehler"));
  if (warnings > 0) {
    parts.push(countLabel(warnings, "Warnung", "Warnungen"));
  }
  return parts.length > 0 ? `Warnung: ${parts.join(" · ")}` : undefined;
}

function renderNormal(state: WidgetState): string[] {
  const entries = relevantEntries(state);
  if (entries.length === 0 && !hasGenuineWarning(state)) return [];

  const maxLines = state.mode === "compact" ? MAX_COMPACT_LINES : MAX_WIDGET_LINES;
  const warning = warningLine(state, entries);
  const reservedLines = warning ? 1 : 0;
  const entryLimit = Math.max(0, maxLines - reservedLines);
  const displayed = entries.slice(0, Math.min(entryLimit, MAX_DISPLAYED_AGENTS));
  const lines = displayed.map(formatSubagentLine);
  const overflow = entries.length - displayed.length;
  if (overflow > 0 && lines.length > 0) {
    lines[lines.length - 1] = truncate(
      `${lines[lines.length - 1]} · +${overflow} weitere`,
      MAX_SA_LINE_WIDTH,
    );
  }
  if (warning) lines.push(warning);

  if (state.mode === "on" && lines.length < maxLines && state.lastRun) {
    const relative = formatRelativeTime(state.lastRun.time);
    if (relative) {
      lines.push(
        truncate(
          `Letzter Lauf: ${state.lastRun.agent} · ${formatRunMode(state.lastRun.mode)} · ${relative}`,
          MAX_TEXT_LENGTH,
        ),
      );
    }
  }
  return lines.slice(0, maxLines);
}

function formatIsoTimestamp(timestamp?: number): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

function renderDebug(state: WidgetState): string[] {
  const loaded = state.subagentsLoaded ? "geladen" : "nicht geladen";
  const lines = [
    `Subagenten: ${loaded} · konfiguriert: ${state.agentCount} · Modus: debug`,
  ];
  if (state.lastRun) {
    lines.push(
      `Letzter Lauf: ${state.lastRun.agent} · ${formatRunMode(state.lastRun.mode)} · ${state.lastRun.time}`,
    );
  }
  if (state.model) lines.push(`Modell: ${state.model}`);
  if (state.thinking) lines.push(`Denken: ${state.thinking.toUpperCase()}`);
  if (cleanText(state.now)) lines.push(`Aktuell: ${cleanText(state.now)}`);
  if (cleanText(state.think)) lines.push(`Denknotiz: ${cleanText(state.think)}`);
  if (cleanText(state.next)) lines.push(`Danach: ${cleanText(state.next)}`);
  if (cleanText(state.risk)) lines.push(`Risiko: ${cleanText(state.risk)}`);

  const entries = Array.from(state.subagents.values()).sort(
    (a, b) =>
      STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
      b.lastUpdate - a.lastUpdate,
  );
  for (const entry of entries) {
    lines.push(
      `${STATUS_SYMBOL[entry.status]} ${entry.label} · ${STATUS_LABEL[entry.status]}`,
    );
    const task = cleanText(entry.currentTask);
    const action = cleanText(entry.lastAction);
    if (task) lines.push(`  Aufgabe: ${task}`);
    if (action) lines.push(`  Letzte Aktion: ${action}`);
    const elapsed = formatElapsed(entry);
    if (elapsed) lines.push(`  Laufzeit: ${elapsed}`);
    const startedAt = formatIsoTimestamp(entry.startedAt);
    const completedAt = formatIsoTimestamp(entry.completedAt);
    const updatedAt = formatIsoTimestamp(entry.lastUpdate);
    if (startedAt) lines.push(`  Gestartet: ${startedAt}`);
    if (completedAt) lines.push(`  Beendet: ${completedAt}`);
    if (updatedAt) lines.push(`  Aktualisiert: ${updatedAt}`);
    const counts = formatCounts(entry);
    if (counts) lines.push(`  Befunde: ${counts}`);
    const risk = cleanText(entry.risk);
    if (risk) lines.push(`  Risiko: ${risk}`);
  }
  return lines;
}

export function renderWidget(state: WidgetState, width?: number): string[] {
  if (!state.visible || state.mode === "off") return [];
  const renderWidth = normalizeRenderWidth(width);
  const lines = state.debug || state.mode === "debug"
    ? renderDebug(state)
    : renderNormal(state);
  return renderWidth === undefined
    ? lines
    : lines.map((line) => truncate(line, renderWidth));
}
