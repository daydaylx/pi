import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Nur Modi, die tatsächlich existieren: Extension-Commands werden dynamisch
// über pi.getCommands() geprüft (siehe unten). Native Pi-Commands wie /model
// tauchen dort NICHT auf (getCommands() liefert nur Extension-/Package-
// Commands, Prompt-Templates und Skills), sind aber fester Bestandteil von
// Pi — daher `native: true` statt dynamischer Prüfung.
const MODES = [
  {
    name: "plan",
    label: "Plan       — Plan erstellen/bearbeiten",
    command: "/plan",
  },
  {
    name: "review-plan",
    label: "Review     — Plan prüfen",
    command: "/review-plan",
  },
  {
    name: "go",
    label: "Work       — freigegebenen Plan ausführen",
    command: "/go",
  },
  {
    name: "finish",
    label: "Finish     — Plan abschließen",
    command: "/finish",
  },
  {
    name: "tools",
    label: "Tools      — Tools konfigurieren",
    command: "/tools",
  },
  {
    name: "status",
    label: "Status     — Status/Home anzeigen",
    command: "/status",
  },
  {
    name: "model",
    label: "Model      — Modell wechseln",
    command: "/model",
    native: true,
  },
] as const;

export default function modeSwitcherExtension(pi: ExtensionAPI): void {
  pi.registerShortcut("shift+tab", {
    description: "Modus-Picker öffnen",
    handler: async (ctx) => {
      if (ctx.mode !== "tui") return;
      if (!ctx.isIdle()) {
        ctx.ui.notify("Modus-Picker nur im Leerlauf verfügbar.", "info");
        return;
      }

      const registered = new Set(pi.getCommands().map((c) => c.name));
      const available = MODES.filter(
        (m) => ("native" in m && m.native) || registered.has(m.name),
      );

      if (available.length === 0) {
        ctx.ui.notify("Keine Modus-Commands registriert.", "info");
        return;
      }

      const choice = await ctx.ui.select(
        "Modus wählen",
        available.map((m) => m.label),
      );
      if (!choice) return;

      const selected = available.find((m) => m.label === choice);
      if (!selected) return;

      const existing = ctx.ui.getEditorText().trim();
      if (existing && existing !== selected.command) {
        const replace = await ctx.ui.confirm(
          "Editorinhalt ersetzen?",
          `Der aktuelle Entwurf wird durch ${selected.command} ersetzt.`,
        );
        if (!replace) return;
      }

      ctx.ui.setEditorText(selected.command);
      ctx.ui.notify(
        `${selected.command} bereit — Enter zum Ausführen.`,
        "info",
      );
    },
  });
}
