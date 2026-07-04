import type { MenuEntry } from "./menu-ui.ts";
import type { PermissionLevel } from "./workflow-status.ts";

export type CommandMenuTarget =
  | { kind: "open-plan-picker" } // /plan
  | { kind: "decide" } // /decide
  | { kind: "plan-action"; action: "work" | "review" | "finish" } // /work /review-plan /finish
  | { kind: "open-permission-menu" } // /permission
  | { kind: "open-write-menu" } // /write
  | { kind: "toggle-yolo" } // /yolo
  | { kind: "tools-action"; action: "open" | "enable-all" | "disable-all" } // /tools /tools-all /tools-none
  | { kind: "status" } // /status, /home
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
      description: "Decision-Intake starten (Optionen klären → Decision Brief)",
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
      description: "Aktuelle Plan-Datei optional vertieft prüfen",
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
      section: "Permissions",
      label: "/permission",
      description: "Zugriffsstufe wählen: Read only bis YOLO",
      value: { kind: "open-permission-menu" },
    },
    {
      id: "cmd-write",
      section: "Permissions",
      label: "/write",
      description: "Schreibrechte setzen: allow | block | plan-only",
      value: { kind: "open-write-menu" },
    },
    {
      id: "cmd-yolo",
      section: "Permissions",
      label: "/yolo",
      description: "Session-weiten YOLO Mode ein-/ausschalten",
      value: { kind: "toggle-yolo" },
      current: state.permissionLevel === "yolo",
    },
    {
      id: "cmd-tools",
      section: "Tools",
      label: "/tools",
      description: "Tools einzeln aktivieren/deaktivieren",
      value: { kind: "tools-action", action: "open" },
    },
    {
      id: "cmd-tools-all",
      section: "Tools",
      label: "/tools-all",
      description: "Alle Tools aktivieren",
      value: { kind: "tools-action", action: "enable-all" },
    },
    {
      id: "cmd-tools-none",
      section: "Tools",
      label: "/tools-none",
      description: "Alle Tools deaktivieren",
      value: { kind: "tools-action", action: "disable-all" },
    },
    {
      id: "cmd-status",
      section: "Status",
      label: "/status",
      description: "Kompakten Workflow-Status anzeigen",
      value: { kind: "status" },
    },
    {
      id: "cmd-home",
      section: "Status",
      label: "/home",
      description: "Alias für /status",
      value: { kind: "status" },
    },
    {
      id: "cmd-thinking",
      section: "Thinking",
      label: "/thinking",
      description: "Thinking-Level wählen: Minimal bis XHigh",
      value: { kind: "open-thinking-menu" },
    },
  ];
}
