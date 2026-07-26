/**
 * Non-modal transcript cards shown after a plan has been created.
 *
 * The cards intentionally own no input handling. `plan-mode/index.ts` keeps
 * that session-scoped concern next to the workflow actions and only uses these
 * renderers to keep the normal chat transcript readable.
 */

import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export type PostPlanAction = "work" | "edit" | "defer" | "discard";

export interface PostPlanCardData {
  cardId: string;
  planHash: string;
  planId?: string;
}

export interface PostPlanCardViewState {
  focused: boolean;
  selected: number;
}

export interface PlanReplayEntryData {
  content: string;
}

export const POST_PLAN_CARD_ENTRY = "plan-next-actions";
export const PLAN_REPLAY_ENTRY = "plan-replay";
export const POST_PLAN_DISCARD_CONFIRM_ENTRY = "plan-discard-confirm";

export const POST_PLAN_ACTIONS: ReadonlyArray<{
  key: string;
  label: string;
  value: PostPlanAction;
}> = [
  { key: "1", label: "Arbeitsmodus starten", value: "work" },
  { key: "2", label: "Plan bearbeiten", value: "edit" },
  { key: "3", label: "Später fortsetzen", value: "defer" },
  { key: "4", label: "Plan verwerfen", value: "discard" },
];

type CardTheme = Pick<Theme, "fg" | "bold" | "bg">;

function cardFrame(
  width: number,
  theme: CardTheme,
  title: string,
  lines: string[],
): string[] {
  if (width < 4) return [truncateToWidth(title, Math.max(1, width), "…", true)];
  const inner = Math.max(1, width - 2);
  const border = (value: string) => theme.fg("border", value);
  const frame = (value: string) =>
    `${border("│")}${truncateToWidth(value, inner, "…", true)}${border("│")}`;
  return [
    `${border("╭")}${border("─".repeat(inner))}${border("╮")}`,
    frame(theme.fg("accent", theme.bold(` ${title}`))),
    `${border("├")}${border("─".repeat(inner))}${border("┤")}`,
    ...lines.map(frame),
    `${border("╰")}${border("─".repeat(inner))}${border("╯")}`,
  ];
}

function selectedRow(theme: CardTheme, text: string, selected: boolean): string {
  if (!selected) return theme.fg("text", text);
  if (theme.bg) return theme.bg("selectedBg", theme.fg("accent", theme.bold(text)));
  return theme.fg("accent", theme.bold(text));
}

export function createPostPlanCardRenderer(
  getState: (cardId: string) => PostPlanCardViewState | undefined,
) {
  return (entry: { data?: unknown }, _options: unknown, theme: CardTheme) => {
    const data = entry.data as PostPlanCardData | undefined;
    const state = data ? getState(data.cardId) : undefined;
    return {
      render(width: number): string[] {
        const selected = state?.focused ? state.selected : -1;
        const lines = POST_PLAN_ACTIONS.map((action, index) =>
          selectedRow(
            theme,
            ` ${selected === index ? "▌" : " "} ${action.key} ${action.label}`,
            selected === index,
          ),
        );
        lines.push("");
        lines.push(theme.fg("muted", " R Plan erneut anzeigen"));
        lines.push(theme.fg("dim", " ↑↓ wählen · Enter bestätigen · Esc schließen"));
        return cardFrame(width, theme, "Nächster Schritt", lines);
      },
      invalidate() {},
    };
  };
}

export function createPlanReplayRenderer() {
  return (entry: { data?: unknown }, _options: unknown, theme: CardTheme) => {
    const content = (entry.data as PlanReplayEntryData | undefined)?.content ?? "";
    return {
      render(width: number): string[] {
        const body = content
          .split("\n")
          .flatMap((line) =>
            wrapTextWithAnsi(theme.fg("text", line), Math.max(1, width - 2)),
          );
        return cardFrame(width, theme, "Plan erneut angezeigt", body);
      },
      invalidate() {},
    };
  };
}

export function createPostPlanDiscardConfirmRenderer() {
  return (_entry: { data?: unknown }, _options: unknown, theme: CardTheme) => ({
    render(width: number): string[] {
      return cardFrame(width, theme, "Plan endgültig verwerfen?", [
        theme.fg("error", " Y endgültig löschen"),
        theme.fg("muted", " Esc abbrechen"),
      ]);
    },
    invalidate() {},
  });
}
