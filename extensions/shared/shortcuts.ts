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
    description: "Control Center öffnen",
  },
  modelMenu: {
    keys: "ctrl+shift+m",
    label: "Ctrl+Shift+M",
    description: "Modellsteuerung öffnen",
  },
  thinkingMenu: {
    keys: "ctrl+shift+d",
    label: "Ctrl+Shift+D",
    description: "Thinking wählen",
  },
  mainMenu: {
    keys: "ctrl+shift+q",
    label: "Ctrl+Shift+Q",
    description: "Hauptmenü öffnen",
  },
  help: {
    keys: "ctrl+shift+h",
    label: "Ctrl+Shift+H",
    description: "Shortcut-/Command-Hilfe anzeigen",
  },
  planAssistant: {
    keys: "ctrl+alt+p",
    label: "Ctrl+Alt+P",
    description: "Plan-Assistent öffnen",
  },
} as const satisfies Record<string, ShortcutBinding>;
