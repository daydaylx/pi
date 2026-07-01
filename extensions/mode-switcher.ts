import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MODES = [
  { name: "auto", label: "Auto       — Router entscheidet", command: "/auto" },
  { name: "turbo", label: "Turbo      — schnelle Aufgaben", command: "/turbo" },
  { name: "deep", label: "Deep       — tiefe Analyse", command: "/deep" },
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
    label: "Finish     — Plan archivieren",
    command: "/finish",
  },
  {
    name: "actions",
    label: "Actions    — Aktionsmenü öffnen",
    command: "/actions",
  },
  { name: "home", label: "Home       — Status anzeigen", command: "/home" },
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
      const available = MODES.filter((m) => registered.has(m.name));

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
