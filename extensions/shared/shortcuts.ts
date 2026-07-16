/**
 * Zentrale Shortcut-Definitionen. Registrierung (mode-permissions.ts,
 * plan-mode/index.ts) und die Ctrl+Shift+H-Hilfe lesen dieselben Einträge,
 * damit Tastenkürzel und Hilfetext nie auseinanderdriften.
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
