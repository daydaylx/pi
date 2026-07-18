import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { basename, dirname, normalize } from "node:path";
import { homedir } from "node:os";
import type { PolicyDecision } from "./permission-policy.ts";

// pi-tui remains dynamically imported below so this shared module remains
// loadable through the tests/run.mjs jiti harness.

const MAX_PREVIEW = 140;
const MAX_REASON_LINES = 3;

type RiskLevel = "low" | "medium" | "high";

function decisionRisk(decision: PolicyDecision): RiskLevel {
  return decision.action === "block" || decision.hard ? "high" : "medium";
}

function riskLabel(risk: RiskLevel): string {
  return { low: "niedrig", medium: "mittel", high: "hoch" }[risk];
}

function projectLabel(cwd: string): string {
  const home = normalize(homedir());
  const normalized = normalize(cwd);
  if (normalized === home) return "~";
  if (normalized.startsWith(`${home}/`)) return `~/${normalized.slice(home.length + 1)}`;
  const parent = basename(dirname(normalized));
  const leaf = basename(normalized);
  return parent && parent !== "." ? `${parent}/${leaf}` : leaf;
}

export function preview(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= MAX_PREVIEW ? oneLine : `${oneLine.slice(0, MAX_PREVIEW - 1)}…`;
}

async function confirmWithCustomUi(
  ctx: ExtensionContext,
  decision: PolicyDecision,
  subject: string,
  toolName: string | undefined,
): Promise<boolean> {
  if (typeof ctx.ui.custom !== "function") {
    throw new Error("Benutzerdefiniertes UI-Overlay wird in diesem Kontext nicht unterstützt.");
  }
  const { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } = await import("@earendil-works/pi-tui");
  const risk = decisionRisk(decision);
  const tone = risk === "high" ? "error" : "warning";
  return ctx.ui.custom<boolean>(
    (_tui, theme, _keybindings, done) => ({
      render(width: number): string[] {
        const innerWidth = Math.max(1, width - 2);
        const subjectLabel = toolName === "bash" || !toolName ? "Befehl" : "Ziel";
        const subjectWrapped = wrapTextWithAnsi(subject, innerWidth).slice(0, 4);
        const reasonWrapped = wrapTextWithAnsi(decision.reason, innerWidth).slice(0, MAX_REASON_LINES);
        const details = wrapTextWithAnsi(
          theme.fg("muted", `Werkzeug: ${toolName ?? "bash"} · Kontext: ${projectLabel(ctx.cwd)} · Risiko: ${riskLabel(risk)} (${risk})`),
          innerWidth,
        );
        if (width < 4) return [truncateToWidth("Warnung", width, "…")];
        const pad = (line: string) => truncateToWidth(line, innerWidth, "…", true);
        const border = (line: string) => `${theme.fg("border", "│")}${pad(line)}${theme.fg("border", "│")}`;
        const divider = `${theme.fg(tone, "├")}${theme.fg(tone, "─".repeat(innerWidth))}${theme.fg(tone, "┤")}`;
        const body = [
          theme.fg(tone, theme.bold(" Berechtigungsanfrage")),
          ...details,
          "",
          theme.fg("muted", `${subjectLabel}:`),
          ...(subjectWrapped.length ? subjectWrapped : ["(leer)"]),
          "",
          theme.fg("muted", "Begründung:"),
          ...(reasonWrapped.length ? reasonWrapped : ["(keine Begründung)"]),
        ];
        return [
          `${theme.fg(tone, "╭")}${theme.fg(tone, "─".repeat(innerWidth))}${theme.fg(tone, "╮")}`,
          ...body.map(border),
          divider,
          border(theme.fg("accent", " [a] Einmal erlauben   [d] Ablehnen")),
          `${theme.fg(tone, "╰")}${theme.fg(tone, "─".repeat(innerWidth))}${theme.fg(tone, "╯")}`,
        ];
      },
      invalidate() {},
      handleInput(data: string): void {
        if (data === "a" || data === "A" || matchesKey(data, Key.enter)) done(true);
        else if (data === "d" || data === "D" || matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) done(false);
      },
    }),
    { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%", margin: 2 } },
  );
}

export async function confirmAction(
  ctx: ExtensionContext,
  decision: PolicyDecision,
  subject: string,
  toolName?: string,
): Promise<boolean> {
  if (typeof ctx.ui.custom === "function") {
    try {
      return await confirmWithCustomUi(ctx, decision, subject, toolName);
    } catch {
      // Fall through to the established confirm fallback.
    }
  }
  const title = decision.hard ? "HARTE WARNUNG — Aktion bestätigen?" : "Riskante Aktion bestätigen?";
  return ctx.ui.confirm(title, `${decision.reason}\n\n${preview(subject)}`);
}
