/**
 * Zentrale Shortcut-Definitionen. Die vier globalen Bereiche nutzen bewusst
 * modifier-eindeutige CSI-u/Kitty-Sequenzen. Terminale müssen das erweiterte
 * Tastaturprotokoll aktivieren, damit die Kombinationen unterscheidbar sind.
 */
import { catalogLabel } from "./command-catalog.ts";

export interface ShortcutBinding {
  /** Key-Spezifikation für pi.registerShortcut(). */
  keys: string;
  /** Menschlich lesbare Taste für Hilfetexte. */
  label: string;
  /** Beschreibung für Registrierung und Hilfe. */
  description: string;
  /** Kanonischer Slash-Aufruf; Shortcut und Command teilen exakt diesen Weg. */
  command: `/${string}`;
  /** Ob ein vorhandener Editorentwurf vor dem Aufruf bestätigt werden muss. */
  effect?: "preserve-draft" | "starts-turn" | "replaces-session";
}

export const SHORTCUTS = {
  modeMenu: {
    keys: "shift+tab",
    label: "Shift+Tab",
    description: `${catalogLabel("workflow")} · /workflow`,
    command: "/workflow",
  },
  modelMenu: {
    keys: "super+m",
    label: "Super+M",
    description: `${catalogLabel("model")} · /model`,
    command: "/model",
  },
  thinkingMenu: {
    keys: "super+d",
    label: "Super+D",
    description: `${catalogLabel("thinking")} · /thinking`,
    command: "/thinking",
  },
  mainMenu: {
    keys: "super+q",
    label: "Super+Q",
    description: `${catalogLabel("commands")} · /commands`,
    command: "/commands",
  },
  planAssistant: {
    keys: "super+p",
    label: "Super+P",
    description: `${catalogLabel("plan")} · /plan`,
    command: "/plan",
    effect: "starts-turn",
  },
  yoloToggle: {
    keys: "super+y",
    label: "Super+Y",
    description: `${catalogLabel("yolo")} · /yolo`,
    command: "/yolo",
  },
  routingModelMenu: {
    keys: "super+s",
    label: "Super+S",
    description: `${catalogLabel("agent-models")} · /agent-models`,
    command: "/agent-models",
  },
} as const satisfies Record<string, ShortcutBinding>;
