/**
 * Mini Subagent/Thinking Widget (#30–#33)
 *
 * Zeigt Subagentenstatus, Modell, Thinking-Level und eine sichere
 * Reasoning-Summary in maximal 4 Zeilen an.
 *
 * Sicherheitsregel (#32): Keine rohe Chain-of-Thought oder versteckte
 * Reasoning-Tokens rendern. Nur explizit vom Agenten formatierte Summaries.
 */

const MAX_WIDGET_LINES = 4;
const MAX_SA_LINE_WIDTH = 90;
const MAX_THINK_LENGTH = 100;
const MAX_DISPLAYED_AGENTS = 8;
// Fertige Läufe verfallen nach dieser Zeit, sonst wächst die Map unbegrenzt,
// weil jede Run-ID eindeutig ist (#42).
const DONE_ENTRY_TTL_MS = 5 * 60 * 1000;

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
  done: "completed",
  completed: "completed",
  running: "running",
  waiting: "waiting",
  warning: "warning",
  failed: "failed",
  blocked: "blocked",
  idle: "idle",
  queued: "queued",
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
    visible: true,
    compact: true,
    debug: false,
    subagentsLoaded: false,
    agentCount: 0,
    subagents: new Map(),
  };
}

let widgetState: WidgetState = createWidgetState();

export function getWidgetState(): WidgetState {
  return widgetState;
}

export function resetWidgetState(): void {
  widgetState = createWidgetState();
}

export function setWidgetVisible(visible: boolean): void {
  widgetState.visible = visible;
}

export function setWidgetCompact(compact: boolean): void {
  widgetState.compact = compact;
}

export function setWidgetDebug(debug: boolean): void {
  widgetState.debug = debug;
}

export function setSubagentAvailability(
  loaded: boolean,
  agentCount: number,
): void {
  widgetState.subagentsLoaded = loaded;
  widgetState.agentCount = Math.max(0, agentCount);
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
}

export function setModel(model?: string): void {
  widgetState.model = model;
}

export function setThinking(thinking?: string): void {
  widgetState.thinking = thinking;
}

export function setNow(text?: string): void {
  widgetState.now = text;
}

export function setThink(text?: string): void {
  widgetState.think = text;
}

export function setNext(text?: string): void {
  widgetState.next = text;
}

export function setRisk(text?: string): void {
  widgetState.risk = text;
}

export function upsertSubagent(entry: SubagentEntry): void {
  entry.lastUpdate = Date.now();
  const cutoff = Date.now() - DONE_ENTRY_TTL_MS;
  for (const [id, existing] of widgetState.subagents) {
    if (
      (existing.status === "done" ||
        existing.status === "completed" ||
        existing.status === "warning" ||
        existing.status === "failed" ||
        existing.status === "blocked") &&
      existing.lastUpdate < cutoff
    ) {
      widgetState.subagents.delete(id);
    }
  }
  widgetState.subagents.set(entry.id, entry);
}

export function removeSubagent(id: string): void {
  widgetState.subagents.delete(id);
}

export function clearSubagents(): void {
  widgetState.subagents.clear();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatSA(entry: SubagentEntry): string {
  const symbol = STATUS_SYMBOL[entry.status];
  const label = STATUS_LABEL[entry.status];
  const counts = [
    entry.warnings ? `w:${entry.warnings}` : undefined,
    entry.errors ? `e:${entry.errors}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const suffix = counts ? ` ${counts}` : "";
  return `${symbol} ${entry.label} ${label}${suffix}`;
}

function renderStatusLine(state: WidgetState): string {
  const loaded = state.subagentsLoaded ? "loaded" : "not loaded";
  const last = state.lastRun
    ? `${state.lastRun.agent}/${state.lastRun.mode}/${state.lastRun.time}`
    : "none";
  return truncate(
    `Subagents: ${loaded} | Agents: ${state.agentCount} | Last run: ${last}`,
    MAX_THINK_LENGTH,
  );
}

function renderSALine(state: WidgetState): string {
  const entries = Array.from(state.subagents.values()).sort((a, b) => {
    const order: SubagentStatus[] = [
      "failed",
      "blocked",
      "warning",
      "running",
      "waiting",
      "queued",
      "done",
      "completed",
      "idle",
    ];
    return order.indexOf(a.status) - order.indexOf(b.status);
  });

  const displayed = entries.slice(0, MAX_DISPLAYED_AGENTS);
  const overflow = entries.length - MAX_DISPLAYED_AGENTS;

  let saLine = displayed.map((e) => formatSA(e)).join(" | ");
  if (overflow > 0) saLine += ` +${overflow}`;
  if (!saLine) saLine = "no agents";

  const model = state.model ?? "?";
  const thinking = (state.thinking ?? "-").toUpperCase();

  return truncate(
    `SA: ${saLine} | M: ${model} | T: ${thinking}`,
    MAX_SA_LINE_WIDTH,
  );
}

function renderNowLine(state: WidgetState): string {
  return `Now: ${truncate(state.now ?? "idle", MAX_THINK_LENGTH)}`;
}

function renderThinkLine(state: WidgetState): string {
  return `Think: ${truncate(state.think ?? "working…", MAX_THINK_LENGTH)}`;
}

function renderNextLine(state: WidgetState): string {
  const parts: string[] = [`Next: ${truncate(state.next ?? "-", 40)}`];
  if (state.risk) parts.push(`Risk: ${truncate(state.risk, 30)}`);
  return truncate(parts.join(" | "), MAX_THINK_LENGTH);
}

export function renderWidget(state: WidgetState): string[] {
  if (!state.visible) return [];
  const lines = [
    renderStatusLine(state),
    renderSALine(state),
    renderNowLine(state),
    renderThinkLine(state),
  ];

  if (!state.compact || state.debug) {
    lines.push(renderNextLine(state));
  }

  if (state.debug) {
    const agentDebug = Array.from(state.subagents.values())
      .map(
        (e) => `  ${e.label}:${e.status} task=${truncate(e.currentTask, 30)}`,
      )
      .join("\n");
    if (agentDebug) lines.push(`---\n${agentDebug}`);
  }

  return lines.slice(0, state.debug ? lines.length : MAX_WIDGET_LINES);
}
