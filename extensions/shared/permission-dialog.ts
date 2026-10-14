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
  if (normalized.startsWith(`${home}/`))
    return `~/${normalized.slice(home.length + 1)}`;
  const parent = basename(dirname(normalized));
  const leaf = basename(normalized);
  return parent && parent !== "." ? `${parent}/${leaf}` : leaf;
}

export function preview(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= MAX_PREVIEW
    ? oneLine
    : `${oneLine.slice(0, MAX_PREVIEW - 1)}…`;
}

// Fernfreigabe: Steuerzeichen (außer \n und \t) sichtbar machen, damit ANSI-/Steuersequenzen die Anzeige nicht verfälschen.
function sanitizeRemoteSubject(subject: string): string {
  return subject.replace(
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
    (character) =>
      `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

// Längere Aktionen werden fern nicht freigegeben: Ein gekürzter Befehl wäre keine informierte Entscheidung.
const MAX_REMOTE_SUBJECT = 2_000;

// --- QuickPanel-Anbindung (optional) -------------------------------------------------------------------------
// Eine geladene Extension (`quickpanel-agent`) kann diese – vom Guard bereits als `ask` entschiedene – Anfrage zusätzlich
// extern beantworten lassen. Die erste gültige Antwort gewinnt (TUI-Taste oder extern). Ohne registrierten Hook, bei
// Fehlern oder bei harten Warnungen bleibt alles exakt wie zuvor. Der Guard behält die Policy; `once` entspricht [a],
// `deny` entspricht [d].
type ExternalOutcome = "executed" | "denied" | "unknown";
interface ExternalApprovalHook {
  begin(
    info: { ctx: unknown; decision: unknown; subject: string; toolName?: string },
    answer: (choice: "once" | "deny") => void,
  ): { cancel(outcome: ExternalOutcome): void } | null;
}

function withExternalAnswer(
  ctx: ExtensionContext,
  decision: PolicyDecision,
  subject: string,
  toolName: string | undefined,
  rawDone: (value: boolean) => void,
): (value: boolean) => void {
  let settled = false;
  let external: { cancel(outcome: ExternalOutcome): void } | null = null;
  try {
    const hook = (globalThis as Record<symbol, unknown>)[
      Symbol.for("quickpanel.agent.approval-hook")
    ] as ExternalApprovalHook | undefined;
    external =
      hook?.begin({ ctx, decision, subject, toolName }, (choice) => {
        if (settled) return;
        settled = true;
        rawDone(choice === "once");
      }) ?? null;
  } catch {
    external = null;
  }
  return (value: boolean): void => {
    if (settled) return;
    settled = true;
    external?.cancel(value ? "unknown" : "denied");
    rawDone(value);
  };
}

async function confirmWithCustomUi(
  ctx: ExtensionContext,
  decision: PolicyDecision,
  subject: string,
  toolName: string | undefined,
): Promise<boolean> {
  if (typeof ctx.ui.custom !== "function") {
    throw new Error(
      "Benutzerdefiniertes UI-Overlay wird in diesem Kontext nicht unterstützt.",
    );
  }
  const { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } =
    await import("@earendil-works/pi-tui");
  const risk = decisionRisk(decision);
  const tone = risk === "high" ? "error" : "warning";
  return ctx.ui.custom<boolean>(
    (_tui, theme, _keybindings, rawDone) => {
      const done = withExternalAnswer(ctx, decision, subject, toolName, rawDone);
      return {
      render(width: number): string[] {
        const innerWidth = Math.max(1, width - 2);
        const contentWidth = Math.max(1, innerWidth - 2);
        const subjectLabel =
          toolName === "bash" || !toolName ? "Befehl" : "Ziel";
        const subjectWrapped = wrapTextWithAnsi(subject, contentWidth).slice(
          0,
          4,
        );
        const reasonWrapped = wrapTextWithAnsi(
          decision.reason,
          contentWidth,
        ).slice(0, MAX_REASON_LINES);
        const details = wrapTextWithAnsi(
          theme.fg(
            "muted",
            `Werkzeug: ${toolName ?? "bash"} · Kontext: ${projectLabel(ctx.cwd)} · Risiko: ${riskLabel(risk)} (${risk})`,
          ),
          contentWidth,
        );
        if (width < 4) return [truncateToWidth("Warnung", width, "…")];
        const pad = (line: string) =>
          truncateToWidth(` ${line} `, innerWidth, "…", true);
        const border = (line: string) =>
          `${theme.fg(tone, "│")}${pad(line)}${theme.fg(tone, "│")}`;
        const emptyLine = `${theme.fg(tone, "│")}${" ".repeat(innerWidth)}${theme.fg(tone, "│")}`;
        const divider = `${theme.fg(tone, "├")}${theme.fg(tone, "─".repeat(innerWidth))}${theme.fg(tone, "┤")}`;
        const body = [
          theme.fg(tone, theme.bold("⚠️  BERECHTIGUNGSANFRAGE")),
          ...details,
          "",
          theme.fg("warning", theme.bold(`${subjectLabel}:`)),
          ...(subjectWrapped.length ? subjectWrapped : ["(leer)"]),
          "",
          theme.fg("muted", theme.bold("Begründung:")),
          ...(reasonWrapped.length
            ? reasonWrapped.map((r) => theme.fg("muted", r))
            : [theme.fg("muted", "(keine Begründung)")]),
        ];
        return [
          `${theme.fg(tone, "╭")}${theme.fg(tone, "─".repeat(innerWidth))}${theme.fg(tone, "╮")}`,
          emptyLine,
          ...body.map(border),
          emptyLine,
          divider,
          emptyLine,
          border(
            `${theme.fg("accent", theme.bold("[a] Einmal erlauben"))}   ${theme.fg("muted", "[d] Ablehnen")}`,
          ),
          emptyLine,
          `${theme.fg(tone, "╰")}${theme.fg(tone, "─".repeat(innerWidth))}${theme.fg(tone, "╯")}`,
        ];
      },
      invalidate() {},
      handleInput(data: string): void {
        if (data === "a" || data === "A" || matchesKey(data, Key.enter))
          done(true);
        else if (
          data === "d" ||
          data === "D" ||
          matchesKey(data, Key.escape) ||
          matchesKey(data, Key.ctrl("c"))
        )
          done(false);
      },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "90%",
        maxHeight: "70%",
        margin: 2,
      },
    },
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
      const result = await confirmWithCustomUi(ctx, decision, subject, toolName);
      // Der RPC-Modus stellt `custom` nur als Stub bereit (liefert `undefined`): kein boolean = nicht beantwortet.
      if (typeof result === "boolean") return result;
    } catch {
      // Fall through to the established confirm fallback.
    }
  }
  const title = decision.hard
    ? "HARTE WARNUNG — Aktion bestätigen?"
    : "Riskante Aktion bestätigen?";
  if (ctx.mode !== "tui") {
    if (subject.length > MAX_REMOTE_SUBJECT) {
      try {
        ctx.ui.notify?.(
          "Aktion zu lang für eine Fernfreigabe (maximal 2.000 Zeichen).",
          "warning",
        );
      } catch {
        // Benachrichtigung ist best effort.
      }
      return false;
    }
    return ctx.ui.confirm(
      title,
      `${decision.reason}\n\nAktion (${toolName ?? "bash"}):\n${sanitizeRemoteSubject(subject)}`,
    );
  }
  return ctx.ui.confirm(title, `${decision.reason}\n\n${preview(subject)}`);
}
