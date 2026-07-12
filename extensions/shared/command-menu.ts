import type { MenuEntry } from "./menu-ui.ts";
import type { PermissionLevel } from "./workflow-status.ts";

export type CommandMenuTarget =
  | { kind: "open-plan-picker" } // /plan
  | { kind: "decide" } // /decide
  | { kind: "plan-action"; action: "work" | "review" | "finish" } // /work /review-plan /finish
  | { kind: "open-permission-menu" } // /permission
  | { kind: "open-write-menu" } // /write
  | { kind: "toggle-yolo" } // /yolo
  | { kind: "open-thinking-menu" }; // /thinking

export interface CommandMenuState {
  permissionLevel: PermissionLevel;
}

export function buildCommandMenu(
  state: CommandMenuState,
): MenuEntry<CommandMenuTarget>[] {
  return [
    {
      id: "cmd-plan",
      section: "Plan",
      label: "/plan",
      description: "Plan-Assistent öffnen (zustandsabhängige Aktionen)",
      value: { kind: "open-plan-picker" },
    },
    {
      id: "cmd-decide",
      section: "Plan",
      label: "/decide",
      description: "Entscheidungsdialog starten (Optionen klären → Entscheidungsnotiz)",
      value: { kind: "decide" },
    },
    {
      id: "cmd-work",
      section: "Plan",
      label: "/work",
      description: "Aktuelle Plan-Datei ausführen",
      value: { kind: "plan-action", action: "work" },
    },
    {
      id: "cmd-review-plan",
      section: "Plan",
      label: "/review-plan",
      description: "Aktuelle Plan-Datei bei Bedarf vertieft prüfen",
      value: { kind: "plan-action", action: "review" },
    },
    {
      id: "cmd-finish",
      section: "Plan",
      label: "/finish",
      description: "Plan abschließen und sicher archivieren",
      value: { kind: "plan-action", action: "finish" },
    },
    {
      id: "cmd-permission",
      section: "Berechtigungen",
      label: "/permission",
      description: "Zugriffsstufe wählen: nur lesen bis YOLO",
      value: { kind: "open-permission-menu" },
    },
    {
      id: "cmd-write",
      section: "Berechtigungen",
      label: "/write",
      description: "Schreibrechte festlegen: erlauben | sperren | nur Plan-Datei",
      value: { kind: "open-write-menu" },
    },
    {
      id: "cmd-yolo",
      section: "Berechtigungen",
      label: "/yolo",
      description: "YOLO-Modus für diese Sitzung ein- oder ausschalten",
      value: { kind: "toggle-yolo" },
      current: state.permissionLevel === "yolo",
    },
    {
      id: "cmd-thinking",
      section: "Denken",
      label: "/thinking",
      description: "Denkstufe wählen: Minimal bis XHigh",
      value: { kind: "open-thinking-menu" },
    },
  ];
}
