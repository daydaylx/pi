/**
 * Zentrale Shortcut-Definitionen. Registrierung (actions.ts,
 * mode-permissions.ts, plan-mode/index.ts) und die Ctrl+Shift+H-Hilfe lesen
 * dieselben Einträge, damit Tastenkürzel und Hilfetext nie auseinanderdriften.
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
    description: "Modus wählen",
  },
  permissionMenu: {
    keys: "ctrl+shift+y",
    label: "Ctrl+Shift+Y",
    description: "Permission-Schnellmenü öffnen",
  },
  thinkingMenu: {
    keys: "ctrl+shift+t",
    label: "Ctrl+Shift+T",
    description: "Thinking wählen",
  },
  commandMenu: {
    keys: "ctrl+shift+x",
    label: "Ctrl+Shift+X",
    description: "Befehlsmenü öffnen",
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
