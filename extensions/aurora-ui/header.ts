import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { crop } from "./layout.ts";
import { compactCwd } from "./cwd.ts";
import type { AuroraUiState } from "./state.ts";

export type HeaderActivity =
  "idle" | "thinking" | "running" | "waiting" | "done" | "error";

function activityLabel(activity: HeaderActivity): string {
  switch (activity) {
    case "thinking":
      return "THINKING";
    case "running":
      return "RUNNING";
    case "waiting":
      return "WAITING";
    case "done":
      return "DONE";
    case "error":
      return "ERROR";
    default:
      return "IDLE";
  }
}

function activityTone(
  activity: HeaderActivity,
): "accent" | "muted" | "success" | "error" {
  if (activity === "error") return "error";
  if (activity === "done") return "success";
  if (activity === "idle" || activity === "waiting") return "muted";
  return "accent";
}

/** The fixed one-line orientation surface above the workspace/editor. */
export function renderHeaderLines(
  theme: Theme,
  width: number,
  input: {
    state: AuroraUiState;
    cwd?: string;
    homeDirectory?: string;
    activity: HeaderActivity;
  },
): string[] {
  const available = Math.max(1, width);
  const mode = input.state.workflow.label.toUpperCase();
  const run = activityLabel(input.activity);
  const right = `${theme.fg("accent", mode)} ${theme.fg(activityTone(input.activity), run)}`;
  const separator = theme.fg("borderMuted", " ─ ");
  const leftPrefix = theme.bold("PI");

  if (available < 52)
    return [
      crop(`${leftPrefix}${separator}${theme.fg("accent", mode)}`, available),
    ];

  const folder = input.cwd
    ? compactCwd(
        input.cwd,
        Math.max(8, Math.min(34, available - 28)),
        input.homeDirectory,
      )
    : "";
  const left = folder
    ? `${leftPrefix}${separator}${theme.fg("muted", folder)}`
    : leftPrefix;
  const gap = Math.max(1, available - visibleWidth(left) - visibleWidth(right));
  return [crop(`${left}${" ".repeat(gap)}${right}`, available)];
}
