import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  CONTROL_CENTER_EVENTS,
  type OpenControlCenterMenuEvent,
} from "./shared/control-center-events.ts";
import { runMenu, type MenuEntry } from "./shared/menu-ui.ts";

export type ContextMenuAction = "usage" | "session" | "compact";

export interface ContextMenuState {
  percent: number | null;
  tokens: number | null;
  contextWindow: number | undefined;
  sessionName: string | undefined;
  branchEntries: number;
  compactAvailable: boolean;
  compactDisabledReason: string | undefined;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function usageSummary(state: ContextMenuState): string {
  if (state.contextWindow === undefined)
    return "Für das aktuelle Modell nicht verfügbar";
  if (state.tokens === null || state.percent === null)
    return `Kontextfenster: ${formatTokens(state.contextWindow)} Tokens; aktuelle Nutzung wird noch berechnet`;
  return `${formatTokens(state.tokens)} von ${formatTokens(state.contextWindow)} Tokens (${Math.round(state.percent)} %)`;
}

export function contextMenuState(
  ctx: ExtensionContext,
  sessionName: string | undefined,
): ContextMenuState {
  const usage = ctx.getContextUsage();
  const compactDisabledReason = !ctx.isIdle()
    ? "Kompaktierung ist nur möglich, wenn kein Agent-Turn läuft."
    : !usage || usage.percent === null
      ? "Die aktuelle Kontextnutzung ist noch nicht verfügbar."
      : undefined;
  return {
    percent: usage?.percent ?? null,
    tokens: usage?.tokens ?? null,
    contextWindow: usage?.contextWindow,
    sessionName,
    branchEntries: ctx.sessionManager.getBranch().length,
    compactAvailable: compactDisabledReason === undefined,
    compactDisabledReason,
  };
}

export function buildContextMenu(
  state: ContextMenuState,
): MenuEntry<ContextMenuAction>[] {
  const session = state.sessionName ?? "Unbenannte Sitzung";
  return [
    {
      id: "context-usage",
      label: "Nutzung",
      description: usageSummary(state),
      value: "usage",
    },
    {
      id: "context-session",
      label: "Sitzung & Verlauf",
      description: `${session} · ${state.branchEntries} Einträge im aktuellen Verlauf`,
      details:
        "Den vollständigen Sitzungsbaum öffnest du weiterhin mit Esc Esc.",
      value: "session",
    },
    {
      id: "context-compact",
      label: "Jetzt kompaktieren",
      description:
        "Fasst den bisherigen Verlauf zu einer kompakten Sitzungserinnerung zusammen",
      details: "Startet erst nach Bestätigung und nur im Leerlauf.",
      tone: "warning",
      dangerous: true,
      disabled: !state.compactAvailable,
      disabledReason: state.compactDisabledReason,
      value: "compact",
    },
  ];
}

function isCurrentSession(ctx: ExtensionContext, sessionId: string): boolean {
  return ctx.sessionManager.getSessionId() === sessionId;
}

export default function contextMenuExtension(pi: ExtensionAPI): void {
  pi.events.on(CONTROL_CENTER_EVENTS.openContext, async (event) => {
    const ctx = (event as OpenControlCenterMenuEvent).ctx;
    const sessionId = ctx.sessionManager.getSessionId();
    const readState = () => contextMenuState(ctx, pi.getSessionName());
    const selected = await runMenu(
      ctx,
      "Kontext",
      buildContextMenu(readState()),
      {
        fallbackPrompt: "Kontextaktion wählen",
        nonInteractiveHint: "Das Kontextmenü benötigt den TUI-Modus.",
      },
    );
    if (!selected || !isCurrentSession(ctx, sessionId)) return;

    const state = readState();
    if (selected === "usage") {
      ctx.ui.notify(`Kontext: ${usageSummary(state)}.`, "info");
      return;
    }
    if (selected === "session") {
      const name = state.sessionName ?? "Unbenannte Sitzung";
      ctx.ui.notify(
        `Sitzung: ${name}. Aktueller Verlauf: ${state.branchEntries} Einträge. Sitzungsbaum: Esc Esc.`,
        "info",
      );
      return;
    }
    if (!state.compactAvailable) {
      ctx.ui.notify(
        state.compactDisabledReason ??
          "Kompaktierung ist derzeit nicht verfügbar.",
        "warning",
      );
      return;
    }

    const confirmed = await ctx.ui.confirm(
      "Kontext jetzt kompaktieren?",
      "Der bisherige Verlauf wird zu einer kompakten Erinnerung zusammengefasst. Diese Aktion kann nicht rückgängig gemacht werden.",
    );
    if (!confirmed || !isCurrentSession(ctx, sessionId)) return;

    const freshState = readState();
    if (!freshState.compactAvailable) {
      ctx.ui.notify(
        freshState.compactDisabledReason ??
          "Kompaktierung ist derzeit nicht verfügbar.",
        "warning",
      );
      return;
    }
    ctx.compact({
      onComplete: (result) => {
        if (!isCurrentSession(ctx, sessionId)) return;
        ctx.ui.notify(
          `Kontext komprimiert. Vorher: ${formatTokens(result.tokensBefore)} Tokens.`,
          "info",
        );
      },
      onError: (error) => {
        if (!isCurrentSession(ctx, sessionId)) return;
        ctx.ui.notify(
          `Kompaktierung fehlgeschlagen: ${error.message}`,
          "error",
        );
      },
    });
    ctx.ui.notify("Kompaktierung des Kontexts gestartet.", "info");
  });
}
