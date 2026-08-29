import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  footerTier,
  LAYOUT_COLUMNS,
  type Layout,
} from "../shared/layout.ts";
import { ellipsizeMiddle, toWorkspaceRelative } from "../shared/paths.ts";
import { crop } from "./layout.ts";
import {
  NEUTRAL_TILE_FILL,
  renderTile,
  renderTileGrid,
  statusFill,
  tileHeight,
  type TileInput,
} from "./tile.ts";
import type {
  CurrentWorkViewModel,
  SubagentBranchInfo,
  TaskPhase,
  TaskViewModel,
  VerificationViewModel,
} from "./task-view-model.ts";

/** The compact running marker shared by tool rows. */
export const RUNNING_GLYPH = "◌";

/**
 * No further progress (e.g. bash producing no new output) is reported in two
 * neutral stages — informational, not an alarm: plenty of legitimate commands
 * (sleep, slow installs) go quiet for a while. Only real failures or explicit
 * attention events ever get warning/error tone.
 */
const QUIET_STILL_THRESHOLD_MS = 15_000;
const QUIET_INFO_THRESHOLD_MS = 30_000;

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
  /** Timestamp of the last observed progress (e.g. new bash output). */
  lastUpdateAt?: number;
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
  wait: { glyph: "⋯", label: "Warten" },
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

function pathWithPosition(cwd: string, args: unknown): string | undefined {
  const path = firstString(args, ["path"]);
  if (!path) return undefined;
  const relPath = toWorkspaceRelative(cwd, path);
  const line = numberValue(args, "line");
  const character = numberValue(args, "character");
  if (line === undefined || character === undefined) return relPath;
  return `${relPath}:${line + 1}:${character + 1}`;
}

function lspTarget(
  cwd: string,
  toolName: string,
  args: unknown,
): string | undefined {
  switch (toolName.toLowerCase()) {
    case "lsp_diagnostics": {
      const path = firstString(args, ["path"]);
      return `Diagnosen · ${path ? toWorkspaceRelative(cwd, path) : ""}`.trim();
    }
    case "lsp_definition":
      return `Definition · ${pathWithPosition(cwd, args) ?? ""}`.trim();
    case "lsp_references":
      return `Referenzen · ${pathWithPosition(cwd, args) ?? ""}`.trim();
    case "lsp_hover":
      return `Info · ${pathWithPosition(cwd, args) ?? ""}`.trim();
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

function searchTarget(
  cwd: string,
  toolName: string,
  args: unknown,
): string | undefined {
  const query = firstString(args, ["query", "pattern"]);
  if (query) return quote(query);
  if (toolName.toLowerCase() !== "find") return undefined;
  const path = firstString(args, ["path"]);
  return path ? toWorkspaceRelative(cwd, path) : undefined;
}

function genericTarget(cwd: string, args: unknown): string | undefined {
  const path = firstString(args, ["path", "file_path", "file"]);
  if (path) return toWorkspaceRelative(cwd, path);
  return firstString(args, [
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
  cwd: string,
): Pick<ActiveToolView, "kind" | "target"> {
  const kind = classifyTool(toolName, args);
  switch (kind) {
    case "read":
    case "edit": {
      const path = firstString(args, ["path"]);
      return {
        kind,
        target: path ? toWorkspaceRelative(cwd, path) : undefined,
      };
    }
    case "search":
      return { kind, target: searchTarget(cwd, toolName, args) };
    case "bash":
    case "test":
      return { kind, target: normalizedCommand(args) };
    case "lsp":
      return { kind, target: lspTarget(cwd, toolName, args) };
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
      return { kind, target: genericTarget(cwd, args) };
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

function toolStatus(
  tool: ActiveToolView,
  now: number,
): {
  tone: "accent" | "warning" | "error" | "muted";
  label: string;
} {
  if (tool.tone === "error") return { tone: "error", label: "FEHLER" };
  if (tool.tone === "warning") return { tone: "warning", label: "HINWEIS" };
  const sinceUpdate = now - (tool.lastUpdateAt ?? tool.startedAt);
  // Neutral silence is not an alarm: first a calm still-active marker,
  // then the silent duration itself — both without warning tone.
  // Evidence-backed problems carry their own tone via tool.tone above.
  if (sinceUpdate >= QUIET_INFO_THRESHOLD_MS) {
    return {
      tone: "muted",
      label: `${Math.floor(sinceUpdate / 1000)}s ohne neue Ausgabe`,
    };
  }
  if (sinceUpdate >= QUIET_STILL_THRESHOLD_MS) {
    return { tone: "muted", label: "STILL AKTIV" };
  }
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

function toolTally(tools: readonly ActiveToolView[], now: number): string {
  return tally(tools.map((tool) => toolStatus(tool, now).label.toLowerCase()));
}

function subagentTally(subagents: readonly SubagentInfo[]): string {
  return tally(
    subagents.map((entry) => subagentStatusLabel(entry.status).toLowerCase()),
  );
}

function toolSummary(tools: readonly ActiveToolView[], now: number): string {
  const statuses = toolTally(tools, now);
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
  now: number,
): string {
  const parts: string[] = [];
  if (hiddenTools.length > 0) {
    const statuses = toolTally(hiddenTools, now);
    parts.push(
      `${hiddenTools.length} Tools${statuses ? ` · ${statuses}` : ""}`,
    );
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
  options: {
    compact?: boolean;
    wide?: boolean;
    limit?: number;
    /** Omit the per-row LÄUFT/elapsed suffix when the activity heading above
     * already says exactly that — one fact, one row. */
    suppressRunningStatus?: boolean;
  } = {},
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
    // A checkmark would falsely claim success while the verification is still
    // running. Completed tools disappear from this transient surface, so only
    // Pi's real result renderer may show the success glyph.
    const glyph =
      tool.kind === "verification" ? RUNNING_GLYPH : presentation.glyph;
    const status = toolStatus(tool, now);
    const marker = theme.fg(status.tone, glyph);
    const label = compact
      ? theme.bold(presentation.label)
      : padToWidth(theme.bold(presentation.label), 12);
    const statusIsPlainRunning =
      status.tone === "accent" && status.label === "LÄUFT";
    const suffix =
      options.suppressRunningStatus && statusIsPlainRunning
        ? ""
        : ` · ${theme.fg(status.tone, status.label)} · ${theme.fg("dim", `${elapsed}s`)}`;
    if (!tool.target) {
      return crop(`${marker} ${label}${suffix}`, available);
    }
    // The target field is ellipsized on its own, leaf-preserving, so a long
    // path never eats into the status/runtime suffix — the one part a
    // failing tool most needs visible.
    const targetWidth = Math.max(
      1,
      available - visibleWidth(`${marker} ${label} `) - visibleWidth(suffix),
    );
    const shortened = ellipsizeMiddle(tool.target, targetWidth);
    const target = theme.fg(
      "muted",
      wide ? padToWidth(shortened, targetWidth) : shortened,
    );
    return `${marker} ${label} ${target}${suffix}`;
  });
  const hidden = tools.slice(visible.length);
  if (hidden.length > 0)
    visible.push(
      crop(
        theme.fg("muted", `↳ ${toolSummary(hidden, now)}`),
        available,
      ),
    );
  return visible;
}

function subagentTone(
  status: SubagentInfo["status"],
): "accent" | "warning" | "error" | "muted" {
  switch (status) {
    // Matches the "running" tone of a normal tool row — green stays reserved
    // for real, finished success (see themes/aurora-night.json `success`).
    case "running":
      return "accent";
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
      return "IM HINTERGRUND";
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
  const clip = (value: string) => crop(value, available);
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

const PHASES: Array<{ id: TaskPhase; label: string }> = [
  { id: "understand", label: "Verstehen" },
  { id: "plan", label: "Planen" },
  { id: "work", label: "Arbeiten" },
  { id: "verify", label: "Prüfen" },
  { id: "done", label: "Fertig" },
];

export function renderProgressBar(
  currentPhase: TaskPhase,
  theme: Theme,
  width: number,
): string {
  const currentIndex = PHASES.findIndex((p) => p.id === currentPhase);
  const segments = PHASES.map((phase, index) => {
    if (index < currentIndex) {
      return `${theme.fg("success", "●")} ${theme.fg("muted", phase.label)}`;
    }
    if (index === currentIndex) {
      return `${theme.fg("accent", "●")} ${theme.bold(phase.label)}`;
    }
    return `${theme.fg("muted", "○")} ${theme.fg("dim", phase.label)}`;
  });
  const separator = theme.fg("borderMuted", " ─ ");
  return crop(segments.join(separator), width);
}

function branchTone(
  status: SubagentBranchInfo["status"],
): "success" | "error" | "accent" | "warning" | "muted" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "needs_attention":
      return "error";
    case "paused":
      return "warning";
    case "queued":
      return "muted";
    case "running":
      return "accent";
  }
}

function branchGlyph(status: SubagentBranchInfo["status"]): string {
  switch (status) {
    case "completed":
      return "✓";
    case "failed":
      return "✗";
    case "needs_attention":
      return "!";
    case "paused":
      return "◌";
    case "queued":
      return "○";
    case "running":
      return "●";
  }
}

// Same German vocabulary as subagentStatusLabel() above, so a subagent's
// status reads the same whether it shows up in the flat SUBAGENTS list or
// here in the branch tree.
function branchStatusLabel(status: SubagentBranchInfo["status"]): string {
  switch (status) {
    case "completed":
      return "FERTIG";
    case "failed":
      return "FEHLGESCHLAGEN";
    case "needs_attention":
      return "AUFMERKSAMKEIT";
    case "paused":
      return "PAUSIERT";
    case "queued":
      return "IM HINTERGRUND";
    case "running":
      return "LÄUFT";
  }
}

export function renderSubagentBranches(
  branches: readonly SubagentBranchInfo[],
  theme: Theme,
  width: number,
  limit = 3,
): string[] {
  if (branches.length === 0) return [];
  const lines: string[] = [];
  const visible = branches.slice(0, limit);

  for (let i = 0; i < visible.length; i++) {
    const branch = visible[i]!;
    const isLast = i === visible.length - 1;
    const rail = isLast ? "└─ " : "├─ ";
    const tone = branchTone(branch.status);
    const glyph = theme.fg(tone, branchGlyph(branch.status));
    const label = theme.fg(tone, branchStatusLabel(branch.status));

    const header = `${theme.fg("borderMuted", rail)}${theme.bold(branch.agent)} ${glyph} ${label}`;
    lines.push(crop(header, width));

    if (branch.focus || branch.progress) {
      const detail = branch.focus ?? branch.progress ?? "";
      const subRail = isLast ? "   " : "│  ";
      lines.push(
        crop(
          `${theme.fg("borderMuted", subRail)}${theme.fg("muted", detail)}`,
          width,
        ),
      );
    }
  }

  return lines;
}

export function renderVerificationBlock(
  verification: VerificationViewModel,
  theme: Theme,
  width: number,
): string[] {
  const lines: string[] = [];
  const isReady = verification.verdict === "READY";
  const isFailed = verification.verdict === "NOT_READY";

  const verdictText = isReady
    ? `${theme.fg("success", "✓ BEREIT")}`
    : isFailed
      ? `${theme.fg("error", "⚠ NICHT BEREIT")}`
      : `${theme.fg("muted", "○ UNGEPRÜFT")}`;

  lines.push(crop(`${theme.bold("PRÜFUNGEN")} · ${verdictText}`, width));

  for (const criterion of verification.criteria) {
    const glyph =
      criterion.status === "passed"
        ? theme.fg("success", "✓")
        : criterion.status === "failed"
          ? theme.fg("error", "✗")
          : theme.fg("muted", "○");
    lines.push(crop(` ${glyph} ${criterion.label}`, width));
  }

  const visibleBlockers = (verification.blockers ?? []).slice(0, 3);
  for (const blocker of visibleBlockers) {
    lines.push(crop(` ${theme.fg("error", "Blockiert:")} ${blocker}`, width));
  }
  const hiddenBlockerCount =
    (verification.blockers?.length ?? 0) - visibleBlockers.length;
  if (hiddenBlockerCount > 0) {
    lines.push(
      crop(theme.fg("muted", ` +${hiddenBlockerCount} weitere`), width),
    );
  }

  return lines;
}

/** Just the title (+ optional goal) line, for callers that already render
 * their own progress bar and current-work detail via the dedicated
 * functions and would otherwise duplicate them through {@link renderTaskWorkspace}. */
export function renderTaskHeader(
  task: TaskViewModel,
  theme: Theme,
  width: number,
): string[] {
  const lines = [crop(theme.bold(task.title.toUpperCase()), width)];
  if (task.goal) {
    lines.push(crop(theme.fg("muted", task.goal), width));
  }
  return lines;
}

/** Just the "Changing: a, b, c" line, for callers that show the cumulative
 * change list without the rest of {@link renderTaskWorkspace}'s current-work
 * block (e.g. alongside {@link renderActiveTools}, which already covers the
 * currently running tool). */
export function renderChangingFiles(
  work: CurrentWorkViewModel,
  theme: Theme,
  width: number,
): string[] {
  if (!work.changingFiles || work.changingFiles.length === 0) return [];
  return [
    crop(
      theme.fg("muted", `Geändert: ${work.changingFiles.join(", ")}`),
      width,
    ),
  ];
}

export function renderTaskWorkspace(
  task: TaskViewModel,
  theme: Theme,
  width: number,
): string[] {
  const lines: string[] = [];
  lines.push(crop(theme.bold(task.title.toUpperCase()), width));
  lines.push(renderProgressBar(task.phase, theme, width));

  if (task.currentWork) {
    lines.push(crop(theme.bold("AKTUELLE ARBEIT"), width));
    lines.push(crop(task.currentWork.summary ?? task.currentWork.title, width));
    lines.push(...renderChangingFiles(task.currentWork, theme, width));
  }

  return lines;
}

export interface DashboardInput {
  activityLines: readonly string[];
  maxRows: number;
  compact?: boolean;
}

/** The runtime signals auto mode needs beyond the task view model itself. */
export interface AutoDashboardInput {
  activityLines: readonly string[];
  layout: Layout;
  /** At least one tool or subagent is running right now. */
  hasActiveWork: boolean;
  /** A completed check no longer describes the workspace (mutation since). */
  verificationStale: boolean;
  /** Any verification status is known for this session (a check ran). */
  verificationKnown: boolean;
}

/** Row budget for the responsive default dashboard. The regular presentation
 * stays short enough to leave the editor dominant; compact terminals keep the
 * one-line summary plus the most important state. */
const AUTO_MAX_ROWS: Record<Layout, number> = {
  compact: 2,
  standard: 7,
  comfortable: 7,
  wide: 7,
};

/** The one "first 3 files, then a +N indicator" rule, shared by every
 * changed-files preview so the auto and expanded dashboards never disagree
 * on how much detail they show. */
function summarizeChangedFiles(
  changes: NonNullable<TaskViewModel["changesSummary"]>,
  separator: string,
): string {
  const files = changes.files.slice(0, 3).join(separator);
  const more = changes.filesCount > 3 ? `, … +${changes.filesCount - 3}` : "";
  return `${files}${more}`;
}

/**
 * A persistent session overview composed only from the task projection and
 * current runtime activity. The caller owns row budgeting; this renderer keeps
 * tiles intact instead of truncating a frame halfway through.
 *
 * From `wide` width on, tiles are paired side by side (task + activity,
 * changes + verification): a pair costs the height of its taller member, not
 * the sum, so a wide terminal sees a 2×2 card grid. Below that, tiles stack.
 */
export function renderDashboard(
  task: TaskViewModel,
  theme: Theme,
  width: number,
  input: DashboardInput,
): string[] {
  const available = Math.max(1, width);
  const compact = input.compact ?? false;
  const verification = task.verification;
  const hasFailure = verification?.verdict === "NOT_READY";

  if (compact) {
    const lines = [
      crop(
        `${theme.bold(task.phaseLabel.toUpperCase())} · ${task.title}`,
        available,
      ),
    ];
    if (hasFailure) {
      lines.push(
        crop(theme.fg("error", "⚠ Prüfung fehlgeschlagen"), available),
      );
    } else if (input.activityLines[0]) {
      lines.push(crop(input.activityLines[0], available));
    }
    return lines.slice(0, Math.max(1, input.maxRows));
  }

  const showProgress =
    !hasFailure && (input.activityLines.length === 0 || input.maxRows > 8);
  const verificationTone =
    verification?.verdict === "READY"
      ? "success"
      : verification?.verdict === "NOT_READY"
        ? "error"
        : "muted";
  const taskTile: TileInput = {
    title: "AUFGABE",
    badge: task.phaseLabel.toUpperCase(),
    tone: "accent",
    fill: NEUTRAL_TILE_FILL,
    lines: [
      theme.bold(task.title),
      ...(task.goal && !hasFailure ? [theme.fg("muted", task.goal)] : []),
      ...(showProgress
        ? [renderProgressBar(task.phase, theme, available - 4)]
        : []),
    ],
  };
  const activityTile: TileInput = {
    title: "AKTIVITÄT",
    badge: input.activityLines.length > 0 ? "LÄUFT" : "BEREIT",
    tone: input.activityLines.length > 0 ? "accent" : "muted",
    fill: NEUTRAL_TILE_FILL,
    lines:
      input.activityLines.length > 0
        ? input.activityLines
        : [
            theme.fg(
              "muted",
              task.phase === "done"
                ? "Letzte Aufgabe abgeschlossen."
                : "Bereit für die nächste Aufgabe.",
            ),
          ],
  };
  const changes = task.changesSummary;
  const changesTile: TileInput | null = changes
    ? {
        title: "ÄNDERUNGEN",
        badge: `${changes.filesCount} ${changes.filesCount === 1 ? "DATEI" : "DATEIEN"}`,
        tone: "accent",
        fill: NEUTRAL_TILE_FILL,
        lines: [
          `${theme.fg("success", `+${changes.linesAdded}`)} ${theme.fg("error", `−${changes.linesRemoved}`)}`,
          theme.fg("muted", summarizeChangedFiles(changes, " · ")),
        ],
      }
    : null;
  const verificationTile: TileInput | null = verification
    ? {
        title: "PRÜFUNGEN",
        badge:
          verification.verdict === "READY"
            ? "BEREIT"
            : verification.verdict === "NOT_READY"
              ? "NICHT BEREIT"
              : "OFFEN",
        tone: verificationTone,
        fill: statusFill(verificationTone),
        lines: renderVerificationBlock(
          verification,
          theme,
          available - 4,
        ).slice(1, hasFailure ? 3 : 2),
      }
    : null;
  // At the shortest supported heights the full failure tile no longer fits:
  // keep the verdict itself visible as a bare card instead of dropping it.
  const bareVerificationTile: TileInput = {
    title: "PRÜFUNGEN",
    badge: "NICHT BEREIT",
    tone: "error",
    fill: "toolErrorBg",
    lines: [],
  };

  const grid = available >= LAYOUT_COLUMNS.wide;
  const ordered = (
    hasFailure
      ? [taskTile, verificationTile, activityTile, changesTile]
      : [taskTile, activityTile, changesTile, verificationTile]
  ).filter((tile): tile is TileInput => tile !== null);
  let groups: TileInput[][] = grid
    ? ordered.reduce<TileInput[][]>((pairs, tile, index) => {
        if (index % 2 === 0) pairs.push([tile]);
        else pairs[pairs.length - 1]!.push(tile);
        return pairs;
      }, [])
    : ordered.map((tile) => [tile]);

  if (hasFailure && verificationTile) {
    // Stacked tiles pay sequential heights, a paired grid pays the taller
    // member only — the fallback condition mirrors each layout's real cost.
    const tooTall = grid
      ? Math.max(
          tileHeight(taskTile),
          tileHeight(verificationTile),
        ) > input.maxRows
      : tileHeight(taskTile) + tileHeight(verificationTile) > input.maxRows;
    if (tooTall) {
      groups = groups.map((group) =>
        group.map((tile) =>
          tile === verificationTile ? bareVerificationTile : tile,
        ),
      );
    }
  }

  const groupHeight = (group: TileInput[]): number =>
    grid
      ? Math.max(...group.map((tile) => tileHeight(tile)))
      : group.reduce((sum, tile) => sum + tileHeight(tile), 0);

  const chosen: TileInput[][] = [];
  let usedRows = 0;
  for (const group of groups) {
    const height = groupHeight(group);
    if (chosen.length > 0 && usedRows + height > input.maxRows) continue;
    chosen.push(group);
    usedRows += height;
  }
  if (chosen.length === 0) return renderTile(theme, available, taskTile);
  return chosen.flatMap((group) =>
    renderTileGrid(theme, available, group, grid ? 2 : 1),
  );
}

/**
 * Aurora's responsive default presentation. Unlike the old state-dependent
 * auto mode, it remains useful after a turn settles: one small session card
 * gives task, activity, changes and verification stable places. Only the
 * compact width tier falls back to two unframed rows.
 */
export function renderAutoDashboard(
  task: TaskViewModel,
  theme: Theme,
  width: number,
  input: AutoDashboardInput,
): string[] {
  const available = Math.max(1, width);
  const budget = AUTO_MAX_ROWS[input.layout];
  const clip = (value: string) => crop(value, available);
  const verification = task.verification;
  const failed = verification?.verdict === "NOT_READY";
  const stale =
    !failed &&
    task.phase !== "verify" &&
    input.verificationStale &&
    (verification?.verdict !== undefined || input.verificationKnown);
  const taskLine = theme.bold(task.title);

  const problemLines: string[] = [];
  if (failed) {
    problemLines.push(theme.fg("error", theme.bold("⚠ Prüfung fehlgeschlagen")));
    const blocker = verification?.blockers?.[0];
    if (blocker) problemLines.push(theme.fg("muted", `  ${blocker}`));
  } else if (stale) {
    problemLines.push(
      theme.fg("warning", "○ Prüfung offen · Änderungen seit dem letzten Lauf"),
    );
  }

  // Live rows exist only during real work; idle sessions get no readiness
  // claim of their own — the panel badge already names the phase.
  const activityLines = input.hasActiveWork
    ? input.activityLines.map((line) => theme.fg("accent", `◌ Aktivität · ${line}`))
    : [];
  const changes = task.changesSummary;
  // Routine rows only ever appear when they carry state: "no changes yet" and
  // "never checked" are zero statements and stay off the dashboard.
  const changesLine = changes
    ? `${theme.fg("accent", "◇ Änderungen")} · ${changes.filesCount} ${changes.filesCount === 1 ? "Datei" : "Dateien"} · ${theme.fg("success", `+${changes.linesAdded}`)} ${theme.fg("error", `−${changes.linesRemoved}`)}`
    : undefined;
  // Only a successful, current verification is routine information. Failed
  // and stale states already have a higher-priority problem line; UNVERIFIED
  // is a zero statement and must not consume dashboard space.
  const verdictLine =
    verification?.verdict === "READY"
      ? theme.fg("success", "✓ Prüfung · Bereit")
      : undefined;
  const idleSegments = [
    changes && changes.filesCount > 0
      ? `${theme.fg("accent", "◇")} ${changes.filesCount} ${changes.filesCount === 1 ? "Datei" : "Dateien"} · ${theme.fg("success", `+${changes.linesAdded}`)} ${theme.fg("error", `−${changes.linesRemoved}`)}`
      : undefined,
    verdictLine,
  ].filter((segment) => segment !== undefined);
  const idleSummary =
    idleSegments.length > 0 ? idleSegments.join(" · ") : undefined;

  if (input.layout === "compact") {
    // Two unframed rows are the whole budget here: the phase line plus at most
    // one information-bearing row. An unrun check stays silent rather than
    // spending half the dashboard on a zero statement.
    const secondRow = problemLines[0] ?? activityLines[0] ?? idleSummary;
    return [
      clip(`${task.phaseLabel.toUpperCase()} · ${theme.bold(task.title)}`),
      ...(secondRow !== undefined ? [clip(secondRow)] : []),
    ].slice(0, budget);
  }

  // A frame costs two rows. Select full sections before framing so a terminal
  // never receives a cropped box and failures retain precedence over routine
  // activity and metadata.
  const contentBudget = Math.max(1, budget - 2);
  // A failure or stale line already owns the verification meaning. Do not
  // repeat it as a second generic verification row; spend that row on the
  // active work or change summary instead. Idle collapses routine metadata
  // into one condensed line — or none, when nothing has a state to report.
  const routineLines = (
    problemLines.length > 0
      ? [changesLine]
      : input.hasActiveWork
        ? [changesLine, verdictLine]
        : [idleSummary]
  ).filter((line) => line !== undefined);
  const activityBudget = Math.max(
    1,
    contentBudget - 1 - problemLines.length - routineLines.length,
  );
  const content = [
    taskLine,
    ...problemLines,
    ...activityLines.slice(0, activityBudget),
    ...routineLines,
  ]
    .slice(0, contentBudget)
    .map(clip);
  return renderTile(theme, available, {
    title: "Sitzung",
    badge: task.phaseLabel.toUpperCase(),
    tone: failed ? "error" : stale ? "warning" : "accent",
    fill: failed ? "toolErrorBg" : NEUTRAL_TILE_FILL,
    lines: content,
  });
}
