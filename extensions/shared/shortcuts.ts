/**
 * Zentrale Shortcut-Definitionen. Die vier globalen Bereiche nutzen bewusst
 * modifier-eindeutige CSI-u/Kitty-Sequenzen. Terminale müssen das erweiterte
 * Tastaturprotokoll aktivieren, damit die Kombinationen unterscheidbar sind.
 */

export interface ShortcutBinding {
  /** Key-Spezifikation für pi.registerShortcut(). */
  keys: string;
  /** Menschlich lesbare Taste für Hilfetexte. */
  label: string;
  /** Beschreibung für Registrierung und Hilfe. */
  description: string;
}

export const SHORTCUTS = {
  modeMenu: {
    keys: "shift+tab",
    label: "Shift+Tab",
    description: "Workflow wechseln",
  },
  modelMenu: {
    keys: "super+m",
    label: "Super+M",
    description: "Modellsteuerung öffnen",
  },
  thinkingMenu: {
    keys: "super+d",
    label: "Super+D",
    description: "Thinking wählen",
  },
  mainMenu: {
    keys: "super+q",
    label: "Super+Q",
    description: "Hauptmenü öffnen",
  },
  planAssistant: {
    keys: "super+p",
    label: "Super+P",
    description: "Plan-Assistent öffnen",
  },
  yoloToggle: {
    keys: "super+y",
    label: "Super+Y",
    description: "Temporären YOLO-Modus ein-/ausschalten",
  },
} as const satisfies Record<string, ShortcutBinding>;
