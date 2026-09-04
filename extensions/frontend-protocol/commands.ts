/**
 * Semantische Command-Registry für alle Frontends. IDs beschreiben fachliche
 * Aktionen, niemals eine UI-Komponente — derselbe Shortcut, Klick oder
 * Menüeintrag muss auf dieselbe ID und damit denselben Core-Weg laufen.
 *
 * Target-Klassen:
 * - rpc:    native RPC-Operation der installierten Runtime (sofort nutzbar).
 * - slash:  Extension-Command via RPC "prompt" ("/name"). Extension-UI-
 *           Anfragen (z. B. Selector) kommen als extension_ui_request zurück
 *           und müssen vom Frontend beantwortet werden.
 * - local:  Das Frontend rendert die Oberfläche selbst aus Core-Daten;
 *           menuDataOps liefert die speisenden RPC-Abfragen.
 * - bridge: noch nicht ausführbar; dokumentierte Brückenpflicht für die
 *           Desktop-GUI-Bridge (Phase 3). Kein stiller Fallback (R13).
 * - tui:    TUI-editornativ; bewusst ohne GUI-Entsprechung.
 */
export type CommandTargetKind = "rpc" | "slash" | "bridge" | "local" | "tui";

interface RpcTarget {
  type: "rpc";
  op: string;
}

interface SlashTarget {
  type: "slash";
  name: string;
}

interface BridgeTarget {
  type: "bridge";
  op: string;
  phase: number;
  reason: string;
}

interface LocalTarget {
  type: "local";
}

interface TuiTarget {
  type: "tui";
  note: string;
}

export type CommandTarget =
  | RpcTarget
  | SlashTarget
  | BridgeTarget
  | LocalTarget
  | TuiTarget;

export type ProtocolCommandEffect =
  | "preserve-draft"
  | "starts-turn"
  | "replaces-session";

export interface ProtocolCommandDef {
  title: string;
  target: CommandTarget;
  /**
   * RPC-Abfragen, die eine frontend-eigene Menüoberfläche speisen (nur für
   * target.type === "local").
   */
  menuDataOps?: readonly string[];
  effect?: ProtocolCommandEffect;
  notes?: string;
}

export const COMMAND_REGISTRY = {
  "workflow.open": {
    title: "Workflow-Auswahl öffnen",
    target: { type: "local" },
    menuDataOps: ["get_commands"],
    notes:
      "GUI rendert die Auswahl aus dem statischen Workflow-Modus-Set; Aurora behält den nativen Shift+Tab-Selector.",
  },
  "workflow.set": {
    title: "Workflow setzen",
    target: { type: "slash", name: "/workflow-set" },
    notes: "Direktsetzer /workflow-set (plan-mode) seit Phase 5.",
  },
  "plan.decide": {
    title: "Über den fertigen Plan entscheiden",
    target: { type: "slash", name: "/plan-decide" },
    notes:
      "Öffnet die Entscheidung nach einem abgeschlossenen Planning-Turn: ausführen, weiter planen oder ohne Ausführung nach Work. Speist sich aus workflow.planReady.",
  },
  "plan.approve": {
    title: "Freigegebenen Plan ausführen",
    target: { type: "slash", name: "/plan-approve" },
    notes:
      "Ausdrückliche, an den Planhash gebundene Freigabe. Startet genau einen Work-Turn und hebt keine Berechtigungsstufe an.",
  },
  "model.open": {
    title: "Modellwahl öffnen",
    target: { type: "local" },
    menuDataOps: ["get_available_models", "get_state"],
  },
  "model.set": {
    title: "Modell setzen",
    target: { type: "rpc", op: "set_model" },
  },
  "model.cycle": {
    title: "Nächstes Modell der Rotation",
    target: { type: "rpc", op: "cycle_model" },
  },
  "thinking.open": {
    title: "Denktiefe wählen",
    target: { type: "local" },
    menuDataOps: ["get_available_thinking_levels", "get_state"],
  },
  "thinking.set": {
    title: "Denktiefe setzen",
    target: { type: "rpc", op: "set_thinking_level" },
  },
  "thinking.cycle": {
    title: "Denktiefe weiterschalten",
    target: { type: "rpc", op: "cycle_thinking_level" },
  },
  "permissions.open": {
    title: "Berechtigungsmodus wählen",
    target: { type: "slash", name: "/permission" },
  },
  "permissions.set": {
    title: "Berechtigungsmodus direkt setzen",
    target: { type: "slash", name: "/permission" },
    notes: "/permission <level> akzeptiert ein Argument.",
  },
  "yolo.toggle": {
    title: "YOLO-Modus umschalten",
    target: { type: "slash", name: "/yolo" },
  },
  "verification.run": {
    title: "Verifikation anstoßen",
    target: {
      type: "bridge",
      op: "verification.run",
      phase: 5,
      reason:
        "Checks laufen heute über das agenteninvokierte project_check-Tool; ein direkter Trigger braucht eine Bridge-Operation.",
    },
  },
  "session.create": {
    title: "Neue Sitzung",
    target: { type: "rpc", op: "new_session" },
  },
  "session.resume": {
    title: "Sitzung fortsetzen",
    target: { type: "rpc", op: "switch_session" },
    notes:
      "Die Kandidatenliste liest das Frontend aus dem Session-Verzeichnis; Ausführung über switch_session.",
  },
  "session.fork": {
    title: "Sitzung verzweigen",
    target: { type: "rpc", op: "fork" },
  },
  "session.clone": {
    title: "Sitzung klonen",
    target: { type: "rpc", op: "clone" },
  },
  "session.stats": {
    title: "Sitzungsstatistik",
    target: { type: "rpc", op: "get_session_stats" },
  },
  "inspector.open": {
    title: "Inspector öffnen",
    target: { type: "local" },
    notes:
      "Reine Präsentation über den State-Strom (workflow, verification, changes, subagents, context, lsp).",
  },
  "changes.view": {
    title: "Änderungen anzeigen",
    target: { type: "local" },
    notes: "GUI-Diff konsumiert das changes-Feld; TUI-Parität: /changes.",
  },
  "app.commandCenter": {
    title: "Command Center / Palette",
    target: { type: "local" },
    menuDataOps: ["get_commands"],
    notes: "GUI-Palette über get_commands; TUI-Parität: /commands (Super+Q).",
  },
  "subagents.rolesModel": {
    title: "Subagent-Rollenmodelle wählen",
    target: { type: "slash", name: "/subagents-set-model" },
  },
  "editor.yank": {
    title: "Editor-Yank (TUI)",
    target: {
      type: "tui",
      note: "Editornative Bindung; bewusst keine GUI-Entsprechung.",
    },
  },
} as const satisfies Record<string, ProtocolCommandDef>;

export type CommandId = keyof typeof COMMAND_REGISTRY;

/** Pflicht-IDs laut Arbeitsauftrag Phase 2 (Dokument 07). */
export const REQUIRED_COMMAND_IDS = [
  "workflow.open",
  "workflow.set",
  "plan.decide",
  "plan.approve",
  "model.open",
  "model.set",
  "thinking.open",
  "thinking.set",
  "permissions.open",
  "permissions.set",
  "verification.run",
  "session.create",
  "session.resume",
  "inspector.open",
] as const satisfies readonly CommandId[];
