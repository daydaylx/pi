/**
 * Shortcut-Mapping: bestehende TUI-Shortcuts werden auf semantische
 * Command-IDs abgebildet (Dokument 02: "Shift+Tab -> command:
 * workflow.open", nicht auf eine UI-Komponente). Die Tasten bleiben die
 * gewohnten; portable Einträge sind in einer Desktop-GUI direkt
 * reproduzierbar, nicht-portable brauchen eine Bridge-Operation oder sind
 * editornativ (dokumentiert statt still weggelassen).
 */
import type { CommandId } from "./commands.ts";

export interface ShortcutMapping {
  keys: string;
  command: CommandId;
  /**
   * true: ohne Core-Brücke übertragbar (RPC/local). false: braucht eine
   * dokumentierte Brückenoperation bzw. ist editornativ.
   */
  portable: boolean;
  note?: string;
}

export const SHORTCUT_COMMAND_MAP: readonly ShortcutMapping[] = [
  {
    keys: "shift+tab",
    command: "workflow.open",
    portable: true,
    note: "Seit Phase 5: GUI-Picker über WORKFLOW_MODES, Ausführung via /workflow-set.",
  },
  { keys: "super+m", command: "model.open", portable: true },
  { keys: "super+d", command: "thinking.open", portable: true },
  { keys: "super+q", command: "app.commandCenter", portable: true },
  {
    keys: "super+i",
    command: "inspector.open",
    portable: true,
    note: "GUI-spezifisch: blendet den Kontextbereich ein oder aus.",
  },
  { keys: "super+y", command: "yolo.toggle", portable: true },
  { keys: "super+s", command: "subagents.rolesModel", portable: true },
  {
    keys: "super+r",
    command: "session.resume",
    portable: true,
    note: "Auswahl liest das GUI aus dem Session-Verzeichnis; Ausführung via switch_session.",
  },
  { keys: "super+t", command: "thinking.cycle", portable: true },
  { keys: "super+,", command: "model.cycle", portable: true },
  {
    keys: "super+shift+y",
    command: "editor.yank",
    portable: false,
    note: "TUI-editornative Bindung.",
  },
];
