/** Global keyboard control plane. Domain extensions keep ownership of state. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runTabbedOverlay } from "./shared/tabbed-overlay.ts";
import { CONTROL_CENTER_EVENTS } from "./shared/control-center-events.ts";
import { SHORTCUTS } from "./shared/shortcuts.ts";

type MainAction = "permissions" | "diagnostics" | "thinking" | "thinking-view";

export default function controlPlaneExtension(pi: ExtensionAPI): void {
  async function openMainMenu(ctx: ExtensionContext): Promise<void> {
    // Die Modellauswahl wird absichtlich nicht über das Hauptmenü angeboten:
    // Sie ist bereits direkt über Super+M (SHORTCUTS.modelMenu) und im
    // Control Center (Shift+Tab → Modell → Modellrolle wechseln) erreichbar.
    const selected = await runTabbedOverlay<MainAction>(ctx, "Hauptmenü", [
      {
        id: "permissions",
        label: "Permissions",
        entries: [
          { id: "permission-level", label: "Zugriffsstufe", description: "Nur Lesen bis YOLO; Workflow-Grenzen bleiben unverändert", value: "permissions" },
          { id: "permission-rules", label: "Whitelist / Blacklist / Dateisystem", description: "Globale Policy-Datei", disabled: true, disabledReason: "Policy-Regeln bleiben bewusst außerhalb der Laufzeit-TUI." },
        ],
      },
      {
        id: "tools",
        label: "Tools",
        entries: [
          { id: "tool-diagnostics", label: "LSP-Diagnose", description: "Status und Diagnose einer Datei", value: "diagnostics" },
          { id: "tool-plugins", label: "Plugins & Erweiterungen", description: "Aktive Extensions werden beim Start geladen", disabled: true, disabledReason: "Dynamisches Laden/Entladen wird von Pi nicht unterstützt." },
        ],
      },
      {
        id: "thinking",
        label: "Thinking",
        entries: [
          { id: "thinking-depth", label: "Denktiefe", description: "Auto oder manuelle Denktiefe für diese Sitzung", value: "thinking" },
          { id: "thinking-view", label: "Visualisierung", description: "Kompakt, Fokus oder ausgeblendet", disabled: true, disabledReason: "Die Thinking-Ansicht ist in dieser Runtime nicht aktiviert." },
        ],
      },
      {
        id: "system",
        label: "System",
        entries: [
          { id: "system-theme", label: "Theme & Motion", description: "Aurora Night und Bewegungsmodus", disabled: true, disabledReason: "Persistente UI-Konfiguration wird noch nicht von der Pi-Runtime geschrieben." },
          { id: "system-hotkeys", label: "Hotkeys", description: "CSI-u/Kitty Keyboard Protocol erforderlich", disabled: true, disabledReason: "Die Belegung wird zentral aus der Agent-Konfiguration geladen." },
        ],
      },
    ], { nonInteractiveHint: "Hauptmenü benötigt den TUI-Modus." });
    const action = selected?.entry.value;
    if (!action) return;
    switch (action) {
      case "permissions": pi.events.emit(CONTROL_CENTER_EVENTS.openPermissions, { ctx }); break;
      case "diagnostics": pi.events.emit(CONTROL_CENTER_EVENTS.openDiagnostics, { ctx }); break;
      case "thinking": pi.events.emit(CONTROL_CENTER_EVENTS.openThinking, { ctx }); break;
      case "thinking-view": pi.events.emit(CONTROL_CENTER_EVENTS.openThinkingView, { ctx }); break;
    }
  }

  pi.registerShortcut(SHORTCUTS.mainMenu.keys, {
    description: SHORTCUTS.mainMenu.description,
    handler: async (ctx) => openMainMenu(ctx),
  });
}
