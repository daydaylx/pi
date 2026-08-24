import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { footerTier } from "../shared/layout.ts";
import { ellipsizeMiddle, toWorkspaceRelative } from "../shared/paths.ts";
import { crop } from "./layout.ts";
import { renderPanel } from "./panel.ts";
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
 * No further progress (e.g. bash producing no new output) for this long is
 * shown as a neutral "keine Ausgabe" state — informational, not an error:
 * plenty of legitimate commands (sleep, slow installs) go quiet for a while.
 */
const STALL_THRESHOLD_MS = 15_000;

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
  tone: "accent" | "warning" | "error";
  label: string;
} {
  if (tool.tone === "error") return { tone: "error", label: "FEHLER" };
  if (tool.tone === "warning") return { tone: "warning", label: "HINWEIS" };
  const sinceUpdate = now - (tool.lastUpdateAt ?? tool.startedAt);
  if (sinceUpdate >= STALL_THRESHOLD_MS) {
    return {
      tone: "warning",
      label: `KEINE AUSGABE SEIT ${Math.floor(sinceUpdate / 1000)}S`,
    };
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
    const suffix = ` · ${theme.fg(status.tone, status.label)} · ${theme.fg("dim", `${elapsed}s`)}`;
    if (!tool.target) {
      return truncateToWidth(`${marker} ${label}${suffix}`, available, "…");
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
      truncateToWidth(
        theme.fg("muted", `↳ ${toolSummary(hidden, now)}`),
        available,
        "…",
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

/**
 * A persistent session overview composed only from the task projection and
 * current runtime activity. The caller owns row budgeting; this renderer keeps
 * panels intact instead of truncating a frame halfway through.
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
  const taskPanel = renderPanel(theme, available, {
    title: "AUFGABE",
    badge: task.phaseLabel.toUpperCase(),
    tone: "accent",
    lines: [
      theme.bold(task.title),
      ...(task.goal && !hasFailure ? [theme.fg("muted", task.goal)] : []),
      ...(showProgress ? [renderProgressBar(task.phase, theme, available - 4)] : []),
    ],
  });
  const activityPanel = renderPanel(theme, available, {
    title: "AKTIVITÄT",
    badge: input.activityLines.length > 0 ? "LÄUFT" : "BEREIT",
    tone: input.activityLines.length > 0 ? "accent" : "muted",
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
  });
  const changes = task.changesSummary;
  const changesPanel = changes
    ? renderPanel(theme, available, {
        title: "ÄNDERUNGEN",
        badge: `${changes.filesCount} ${changes.filesCount === 1 ? "DATEI" : "DATEIEN"}`,
        tone: "accent",
        lines: [
          `${theme.fg("success", `+${changes.linesAdded}`)} ${theme.fg("error", `−${changes.linesRemoved}`)}`,
          theme.fg("muted", changes.files.slice(0, 3).join(" · ")),
        ],
      })
    : [];
  const verificationPanel = verification
    ? renderPanel(theme, available, {
        title: "PRÜFUNGEN",
        badge:
          verification.verdict === "READY"
            ? "BEREIT"
            : verification.verdict === "NOT_READY"
              ? "NICHT BEREIT"
              : "OFFEN",
        tone:
          verification.verdict === "READY"
            ? "success"
            : verification.verdict === "NOT_READY"
              ? "error"
              : "muted",
        lines: renderVerificationBlock(verification, theme, available - 4).slice(
          1,
          hasFailure ? 3 : 2,
        ),
      })
    : [];
  // At a standard terminal's shortest supported heights, preserve the failure
  // verdict before any routine activity. A frame with title and badge costs two
  // rows and, paired with the compact task panel, fits the five-row budget.
  const failedVerificationFallback =
    hasFailure &&
    taskPanel.length + verificationPanel.length > input.maxRows
      ? renderPanel(theme, available, {
          title: "PRÜFUNGEN",
          badge: "NICHT BEREIT",
          tone: "error",
          lines: [],
        })
      : verificationPanel;

  const candidates = hasFailure
    ? [taskPanel, failedVerificationFallback, activityPanel, changesPanel]
    : [taskPanel, activityPanel, changesPanel, verificationPanel];
  const lines: string[] = [];
  for (const panel of candidates) {
    if (panel.length === 0) continue;
    if (lines.length > 0 && lines.length + panel.length > input.maxRows) continue;
    lines.push(...panel);
  }
  return lines.length > 0 ? lines : taskPanel;
}
