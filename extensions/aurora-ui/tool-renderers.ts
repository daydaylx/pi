import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { footerTier } from "../shared/layout.ts";

/** The compact running marker shared by tool rows. */
export const RUNNING_GLYPH = "◌";

/** Presentation-only categories; tool execution remains entirely in Pi core. */
export type ActivityToolKind =
  | "read"
  | "search"
  | "edit"
  | "bash"
  | "lsp"
  | "test"
  | "verification"
  | "subagent"
  | "wait"
  | "web"
  | "generic";

export type ActivityToolTone = "running" | "warning" | "error";

export interface ActiveToolView {
  id: string;
  name: string;
  kind?: ActivityToolKind;
  target?: string;
  startedAt: number;
  tone?: ActivityToolTone;
}

/**
 * A subagent the current turn started. Aurora keeps no independent lifecycle:
 * foreground entries are derived from the actual tool call, async entries from
 * the package's start/complete events, and attention only from its control
 * event.
 */
export interface SubagentInfo {
  agent: string;
  phase?: string;
  label?: string;
  runId?: string;
  status: "running" | "paused" | "needs_attention" | "queued";
}

interface ToolPresentation {
  glyph: string;
  label: string;
}

const PRESENTATIONS: Record<ActivityToolKind, ToolPresentation> = {
  read: { glyph: "◌", label: "Lesen" },
  search: { glyph: "⌕", label: "Suchen" },
  edit: { glyph: "✎", label: "Bearbeiten" },
  bash: { glyph: "›", label: "Shell" },
  lsp: { glyph: "◇", label: "LSP" },
  test: { glyph: "▹", label: "Testen" },
  verification: { glyph: "✓", label: "Prüfen" },
  subagent: { glyph: "◉", label: "Subagent" },
  wait: { glyph: "◌", label: "Warten" },
  web: { glyph: "◎", label: "Web" },
  generic: { glyph: RUNNING_GLYPH, label: "Werkzeug" },
};

const LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_workspace_symbols",
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(
  args: unknown,
  candidates: readonly string[],
): string | undefined {
  const values = record(args);
  if (!values) return undefined;
  for (const key of candidates) {
    const value = values[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function numberValue(args: unknown, key: string): number | undefined {
  const value = record(args)?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function normalizedCommand(args: unknown): string | undefined {
  return firstString(args, ["command"])?.replace(/\s+/g, " ");
}

/**
 * Match only a command position (or a shell chain boundary), not arbitrary
 * output text such as `echo jest`. The command is never executed or parsed by
 * a shell; this only chooses a presentation label for the real bash event.
 */
function commandStarts(command: string, expression: string): boolean {
  return new RegExp(`(?:^|(?:&&|\\|\\||;|\\n)\\s*)${expression}`, "i").test(
    command,
  );
}

function isVerificationCommand(command: string): boolean {
  const packageManager = "(?:npm|pnpm|yarn|bun)";
  return (
    commandStarts(
      command,
      `${packageManager}(?:\\s+--[^\\s]+(?:\\s+[^\\s]+)?)?\\s+run\\s+verify(?:\\s|$)`,
    ) || commandStarts(command, `${packageManager}\\s+verify(?:\\s|$)`)
  );
}

function isTestCommand(command: string): boolean {
  const packageManager = "(?:npm|pnpm|yarn|bun)";
  return (
    commandStarts(
      command,
      `${packageManager}(?:\\s+--[^\\s]+(?:\\s+[^\\s]+)?)?\\s+(?:run\\s+)?test(?:\\s|$)`,
    ) ||
    commandStarts(
      command,
      "(?:npx|pnpx|yarn\\s+dlx|bunx\\s+)?(?:vitest|jest|pytest)(?:\\s|$)",
    ) ||
    commandStarts(command, "cargo\\s+test(?:\\s|$)") ||
    commandStarts(command, "go\\s+test(?:\\s|$)")
  );
}

/** Classify only names and arguments that the running Pi runtime actually emits. */
export function classifyTool(
  toolName: string,
  args: unknown,
): ActivityToolKind {
  const name = toolName.toLowerCase();
  switch (name) {
    case "read":
      return "read";
    case "grep":
    case "find":
      return "search";
    case "edit":
    case "write":
      return "edit";
    case "verify":
    case "project_check":
      return "verification";
    case "subagent":
      return "subagent";
    case "wait":
      return "wait";
    case "web":
    case "web__run":
      return "web";
    case "bash": {
      const command = normalizedCommand(args);
      if (!command) return "bash";
      if (isVerificationCommand(command)) return "verification";
      return isTestCommand(command) ? "test" : "bash";
    }
    default:
      return LSP_TOOLS.has(name) ? "lsp" : "generic";
  }
}

function pathWithPosition(args: unknown): string | undefined {
  const path = firstString(args, ["path"]);
  if (!path) return undefined;
  const line = numberValue(args, "line");
  const character = numberValue(args, "character");
  if (line === undefined || character === undefined) return path;
  return `${path}:${line + 1}:${character + 1}`;
}

function lspTarget(toolName: string, args: unknown): string | undefined {
  switch (toolName.toLowerCase()) {
    case "lsp_diagnostics":
      return `Diagnosen · ${firstString(args, ["path"]) ?? ""}`.trim();
    case "lsp_definition":
      return `Definition · ${pathWithPosition(args) ?? ""}`.trim();
    case "lsp_references":
      return `Referenzen · ${pathWithPosition(args) ?? ""}`.trim();
    case "lsp_hover":
      return `Info · ${pathWithPosition(args) ?? ""}`.trim();
    case "lsp_workspace_symbols": {
      const query = firstString(args, ["query"]);
      return query
        ? `Workspace-Symbole · ${quote(query)}`
        : "Workspace-Symbole";
    }
    default:
      return undefined;
  }
}

function agentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = record(item);
    if (!entry) return [];
    const agent = typeof entry.agent === "string" ? entry.agent : undefined;
    return [
      ...(agent ? [agent] : []),
      ...agentNames(entry.tasks),
      ...agentNames(entry.parallel),
    ];
  });
}

function subagentTarget(args: unknown): string | undefined {
  const input = record(args);
  if (!input) return undefined;
  if (typeof input.action === "string") return input.action;
  if (typeof input.agent === "string") return input.agent;
  const agents = [...agentNames(input.tasks), ...agentNames(input.chain)];
  const unique = [...new Set(agents)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return `${unique.length} agents`;
  if (Array.isArray(input.tasks)) return `parallel · ${input.tasks.length}`;
  if (Array.isArray(input.chain)) return `chain · ${input.chain.length}`;
  return undefined;
}

function verificationTarget(args: unknown): string | undefined {
  const input = record(args);
  if (!input) return undefined;
  if (typeof input.check === "string") return input.check;
  if (typeof input.profile === "string") return input.profile;
  if (
    Array.isArray(input.profiles) &&
    input.profiles.every((profile) => typeof profile === "string")
  )
    return input.profiles.join(", ");
  return undefined;
}

function searchTarget(toolName: string, args: unknown): string | undefined {
  const query = firstString(args, ["query", "pattern"]);
  if (query) return quote(query);
  return toolName.toLowerCase() === "find"
    ? firstString(args, ["path"])
    : undefined;
}

function genericTarget(args: unknown): string | undefined {
  return firstString(args, [
    "path",
    "file_path",
    "file",
    "query",
    "pattern",
    "url",
    "symbol",
    "name",
    "target",
  ]);
}

function waitTarget(args: unknown): string | undefined {
  const input = record(args);
  if (!input) return undefined;
  if (input.all === true) return "alle Subagenten";
  return firstString(args, ["agent", "runId", "target"]);
}

/** Derive an Activity line entirely from the tool execution start payload. */
export function describeToolActivity(
  toolName: string,
  args: unknown,
): Pick<ActiveToolView, "kind" | "target"> {
  const kind = classifyTool(toolName, args);
  switch (kind) {
    case "read":
    case "edit":
      return { kind, target: firstString(args, ["path"]) };
    case "search":
      return { kind, target: searchTarget(toolName, args) };
    case "bash":
    case "test":
      return { kind, target: normalizedCommand(args) };
    case "lsp":
      return { kind, target: lspTarget(toolName, args) };
    case "verification":
      return {
        kind,
        target:
          toolName.toLowerCase() === "bash"
            ? normalizedCommand(args)
            : verificationTarget(args),
      };
    case "subagent":
      return { kind, target: subagentTarget(args) };
    case "wait":
      return { kind, target: waitTarget(args) };
    case "web":
    case "generic":
      return { kind, target: genericTarget(args) };
  }
}

export function toolPresentation(
  name: string,
  args?: unknown,
): ToolPresentation {
  const kind = classifyTool(name, args);
  const presentation = PRESENTATIONS[kind];
  return kind === "generic" && name.trim()
    ? { ...presentation, label: `${presentation.label} · ${name}` }
    : presentation;
}

function toolStatus(tool: ActiveToolView): {
  tone: "accent" | "warning" | "error";
  label: string;
} {
  if (tool.tone === "error") return { tone: "error", label: "FEHLER" };
  if (tool.tone === "warning") return { tone: "warning", label: "HINWEIS" };
  return { tone: "accent", label: "LÄUFT" };
}

/**
 * The one status tally every overflow line uses. Counting in more than one
 * place is how the same state ends up named two different ways in one frame.
 */
function tally(labels: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
}

function toolTally(tools: readonly ActiveToolView[]): string {
  return tally(tools.map((tool) => toolStatus(tool).label.toLowerCase()));
}

function subagentTally(subagents: readonly SubagentInfo[]): string {
  return tally(
    subagents.map((entry) => subagentStatusLabel(entry.status).toLowerCase()),
  );
}

function toolSummary(tools: readonly ActiveToolView[]): string {
  const statuses = toolTally(tools);
  return `+${tools.length} weitere Tools${statuses ? ` · ${statuses}` : ""}`;
}

/**
 * The activity widget's combined overflow line. It lives here, next to the row
 * renderers, so the labels and the tally have exactly one source; the widget
 * only decides how many rows fit.
 */
export function hiddenActivitySummary(
  hiddenTools: readonly ActiveToolView[],
  hiddenSubagents: readonly SubagentInfo[],
): string {
  const parts: string[] = [];
  if (hiddenTools.length > 0) {
    const statuses = toolTally(hiddenTools);
    parts.push(`${hiddenTools.length} Tools${statuses ? ` · ${statuses}` : ""}`);
  }
  if (hiddenSubagents.length > 0) {
    const statuses = subagentTally(hiddenSubagents);
    parts.push(
      `${hiddenSubagents.length} Subagenten${statuses ? ` · ${statuses}` : ""}`,
    );
  }
  return `↳ +${parts.join(" · ")}`;
}

function padToWidth(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
}

/**
 * Renders lifecycle metadata only. Aurora deliberately does not re-register or
 * wrap tools, so argument validation, execution, cancellation, updates and
 * results continue to be handled exactly by Pi's core tool definitions.
 */
export function renderActiveTools(
  tools: readonly ActiveToolView[],
  theme: Theme,
  width: number,
  now: number,
  options: { compact?: boolean; wide?: boolean; limit?: number } = {},
): string[] {
  const available = Math.max(1, width);
  const compact = options.compact ?? footerTier(width) === "compact";
  const wide = options.wide ?? footerTier(width) === "wide";
  const limit = options.limit ?? (compact ? 1 : 3);
  const visible = tools.slice(0, limit).map((tool) => {
    const elapsed = Math.max(0, Math.floor((now - tool.startedAt) / 1000));
    const presentation =
      tool.kind === undefined || tool.kind === "generic"
        ? toolPresentation(tool.name)
        : PRESENTATIONS[tool.kind];
    const target = tool.target ? ` · ${theme.fg("muted", tool.target)}` : "";
    // A checkmark would falsely claim success while the verification is still
    // running. Completed tools disappear from this transient surface, so only
    // Pi's real result renderer may show the success glyph.
    const glyph =
      tool.kind === "verification" ? RUNNING_GLYPH : presentation.glyph;
    const status = toolStatus(tool);
    const marker = theme.fg(status.tone, glyph);
    if (wide) {
      const type = padToWidth(theme.bold(presentation.label), 12);
      const suffix = ` · ${theme.fg(status.tone, status.label)} · ${theme.fg("dim", `${elapsed}s`)}`;
      const targetWidth = Math.max(
        1,
        available - visibleWidth(`${marker} ${type} `) - visibleWidth(suffix),
      );
      const target = theme.fg(
        "muted",
        padToWidth(truncateToWidth(tool.target ?? "—", targetWidth, "…"), targetWidth),
      );
      return `${marker} ${type} ${target}${suffix}`;
    }
    const line = `${marker} ${theme.bold(presentation.label)}${target} · ${theme.fg(status.tone, status.label)} · ${theme.fg("dim", `${elapsed}s`)}`;
    return truncateToWidth(line, available, "…");
  });
  const hidden = tools.slice(visible.length);
  if (hidden.length > 0)
    visible.push(
      truncateToWidth(
        theme.fg("muted", `↳ ${toolSummary(hidden)}`),
        available,
        "…",
      ),
    );
  return visible;
}

function subagentTone(
  status: SubagentInfo["status"],
): "success" | "warning" | "error" | "muted" {
  switch (status) {
    case "running":
      return "success";
    case "paused":
      return "warning";
    case "needs_attention":
      return "error";
    case "queued":
      return "muted";
  }
}

function subagentGlyph(status: SubagentInfo["status"]): string {
  switch (status) {
    case "running":
      return "◉";
    case "queued":
      return "○";
    case "paused":
      return "◌";
    case "needs_attention":
      return "!";
  }
}

function subagentStatusLabel(status: SubagentInfo["status"]): string {
  switch (status) {
    case "running":
      return "LÄUFT";
    case "queued":
      return "WARTET";
    case "paused":
      return "PAUSIERT";
    case "needs_attention":
      return "AUFMERKSAMKEIT";
  }
}

function subagentSummary(subagents: readonly SubagentInfo[]): string {
  return `+${subagents.length} weitere · ${subagentTally(subagents)}`;
}

/**
 * Subagents appear inline with the work that started them, for as long as that
 * work runs — no permanent tab strip, no navigation level of their own. When
 * the turn settles the widget goes away with everything else in it.
 */
export function renderSubagents(
  subagents: readonly SubagentInfo[],
  theme: Theme,
  width: number,
  options: { compact?: boolean; limit?: number; summary?: boolean } = {},
): string[] {
  if (subagents.length === 0) return [];
  const available = Math.max(1, width);
  const compact = options.compact ?? footerTier(width) === "compact";
  const clip = (value: string) => truncateToWidth(value, available, "…");
  const attention = subagents.filter(
    (entry) => entry.status === "needs_attention",
  ).length;
  const summary = clip(
    compact
      ? `${theme.fg("accent", "◉")} ${theme.bold("SUBAGENTS")} ${theme.fg("muted", `· ${subagents.length}`)}`
      : theme.bold(theme.fg("border", `SUBAGENTS · ${subagents.length}`)),
  );
  const attentionLine = attention
    ? theme.fg("error", ` · ${attention} Aufmerksamkeit`)
    : "";
  const summaryWithAttention = clip(`${summary}${attentionLine}`);
  // Whatever needs a decision is worth the few lines this surface has.
  const ordered = [...subagents].sort(
    (a, b) =>
      Number(b.status === "needs_attention") -
      Number(a.status === "needs_attention"),
  );
  const limit = options.limit ?? (compact ? 0 : 3);
  const visible = ordered.slice(0, limit);
  const lines = visible.map((entry) => {
    const glyph = theme.fg(
      subagentTone(entry.status),
      subagentGlyph(entry.status),
    );
    const detail = entry.phase ?? entry.label;
    const suffix = detail ? ` · ${theme.fg("muted", detail)}` : "";
    return clip(
      `   ${glyph} ${theme.bold(entry.agent)} · ${theme.fg(subagentTone(entry.status), subagentStatusLabel(entry.status))}${suffix}`,
    );
  });
  const hidden = ordered.slice(visible.length);
  if (hidden.length > 0)
    lines.push(clip(`   ${theme.fg("muted", `↳ ${subagentSummary(hidden)}`)}`));
  return options.summary === false ? lines : [summaryWithAttention, ...lines];
}
