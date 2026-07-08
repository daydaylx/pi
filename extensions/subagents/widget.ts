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
const MAX_SA_LINE_WIDTH = 60;
const MAX_THINK_LENGTH = 100;
const MAX_DISPLAYED_AGENTS = 8;

export type SubagentStatus = "idle" | "queued" | "running" | "done" | "blocked";

const STATUS_SYMBOL: Record<SubagentStatus, string> = {
  done: "✓",
  running: "…",
  blocked: "!",
  idle: "idle",
  queued: "queued",
};

export interface SubagentEntry {
  id: string;
  label: string;
  status: SubagentStatus;
  currentTask: string;
  lastUpdate: number;
  risk?: string;
}

export interface WidgetState {
  visible: boolean;
  compact: boolean;
  debug: boolean;
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

function formatSA(status: SubagentStatus, label: string): string {
  const symbol = STATUS_SYMBOL[status];
  if (status === "idle") return `${label} idle`;
  if (status === "queued") return `${label} queued`;
  return `${label}${symbol}`;
}

function renderSALine(state: WidgetState): string {
  const entries = Array.from(state.subagents.values())
    .sort((a, b) => {
      const order: SubagentStatus[] = ["blocked", "running", "queued", "done", "idle"];
      return order.indexOf(a.status) - order.indexOf(b.status);
    });

  const displayed = entries.slice(0, MAX_DISPLAYED_AGENTS);
  const overflow = entries.length - MAX_DISPLAYED_AGENTS;

  let saLine = displayed.map((e) => formatSA(e.status, e.label)).join(" ");
  if (overflow > 0) saLine += ` +${overflow}`;
  if (!saLine) saLine = "no agents";

  const model = state.model ?? "?";
  const thinking = (state.thinking ?? "-").toUpperCase();

  return truncate(`SA: ${saLine} | M: ${model} | T: ${thinking}`, MAX_SA_LINE_WIDTH);
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
    renderSALine(state),
    renderNowLine(state),
    renderThinkLine(state),
  ];

  if (!state.compact || state.debug) {
    lines.push(renderNextLine(state));
  }

  if (state.debug) {
    const agentDebug = Array.from(state.subagents.values())
      .map((e) => `  ${e.label}:${e.status} task=${truncate(e.currentTask, 30)}`)
      .join("\n");
    if (agentDebug) lines.push(`---\n${agentDebug}`);
  }

  return lines.slice(0, state.debug ? lines.length : MAX_WIDGET_LINES);
}
