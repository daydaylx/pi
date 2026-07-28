import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";

export type CommandCategoryId =
  | "work"
  | "plan"
  | "models"
  | "access"
  | "code"
  | "sessions"
  | "resources"
  | "system";

export type CommandEffect = "preserve-draft" | "starts-turn" | "replaces-session";

export interface CommandCategory {
  id: CommandCategoryId;
  label: string;
  shortcut: string;
}

export interface CommandDefinition {
  name: string;
  label: string;
  description: string;
  category: CommandCategoryId;
  aliases?: readonly string[];
  shortcut?: string;
  effect?: CommandEffect;
  dangerous?: boolean;
  guide?: "compact" | "export" | "import" | "lsp" | "name" | "route";
}

export interface AvailableCommand {
  name: string;
  description?: string;
  source: SlashCommandInfo["source"] | "builtin";
}

export const COMMAND_CATEGORIES: readonly CommandCategory[] = [
  { id: "work", label: "Arbeit", shortcut: "A" },
  { id: "plan", label: "Plan", shortcut: "P" },
  { id: "models", label: "Modelle & Denken", shortcut: "M" },
  { id: "access", label: "Rechte & Vertrauen", shortcut: "R" },
  { id: "code", label: "Code & Diagnose", shortcut: "C" },
  { id: "sessions", label: "Sitzungen & Kontext", shortcut: "S" },
  { id: "resources", label: "Vorlagen & Skills", shortcut: "V" },
  { id: "system", label: "System & Transfer", shortcut: "T" },
] as const;

const definitions = [
  ["workflow", "Workflow wechseln", "Arbeitsweg auswählen oder fortsetzen", "work"],
  ["plan", "Plan-Assistent", "Plan erstellen, prüfen oder verwalten", "work", undefined, "Super+P", "starts-turn"],
  ["work", "Plan ausführen", "Bestätigten Plan ausführen oder fortsetzen", "work", ["go"], undefined, "starts-turn"],
  ["task", "Direktauftrag", "Kompakte Aufgabe ohne Plan starten oder fortsetzen", "work", undefined, undefined, "starts-turn"],
  ["task-done", "Direktauftrag abschließen", "Direktauftrag durch die Completion-Pipeline führen", "work"],
  ["route", "Aufgaben-Routing", "Routing anzeigen oder manuell stufen", "work", undefined, undefined, undefined, undefined, "route"],

  ["review-plan", "Plan prüfen", "Aktuellen Plan vertieft prüfen", "plan", undefined, undefined, "starts-turn"],
  ["plan-todos", "Planschritte anzeigen", "Planschritte und Sidecar-Status anzeigen", "plan"],
  ["view-plan", "Plan anzeigen", "Vollständigen Markdown-Plan anzeigen", "plan", ["show-plan"]],
  ["edit-plan", "Plan bearbeiten", "Markdown-Plan bearbeiten und Sidecar synchronisieren", "plan", ["plan-edit"]],
  ["done", "Planschritte abschließen", "Einen oder mehrere Planschritte manuell abschließen", "plan"],
  ["verify-gate", "Prüfungen vorab", "Completion-Prüfungen read-only ansehen", "plan"],
  ["finish", "Plan abschließen", "Verbindliche Completion-Pipeline ausführen", "plan"],
  ["discard-plan", "Plan verwerfen", "Aktiven Plan und Sidecar nach Bestätigung entfernen", "plan", undefined, undefined, undefined, true],
  ["migrate-plan", "Legacy-Plan migrieren", "Legacy-Workflow ausdrücklich nach v3 migrieren", "plan", undefined, undefined, undefined, true],
  ["recover-workflow-lock", "Workflow-Sperre reparieren", "Verwaiste Sperre nach Bestätigung entfernen", "plan", undefined, undefined, undefined, true],

  ["model", "Modell wählen", "Modell für diese Sitzung auswählen", "models", undefined, "Super+M"],
  ["scoped-models", "Modellumfang", "Modelle für die native Modellrotation auswählen", "models"],
  ["thinking", "Denktiefe", "Automatische oder manuelle Denktiefe wählen", "models", undefined, "Super+D"],
  ["agent-models", "Agentenmodelle", "Modelle für Planner, Worker und Reviewer wählen", "models", undefined, "Super+S"],

  ["permission", "Berechtigungsmodus", "Zugriffsstufe für diese Sitzung wählen", "access"],
  ["yolo", "YOLO umschalten", "Temporären YOLO-Modus ein- oder ausschalten", "access", undefined, "Super+Y"],
  ["trust", "Projektvertrauen", "Vertrauensentscheidung für das Projekt speichern", "access"],
  ["login", "Provider anmelden", "Provider-Authentifizierung konfigurieren", "access"],
  ["logout", "Provider abmelden", "Gespeicherte Provider-Authentifizierung entfernen", "access", undefined, undefined, undefined, true],

  ["changes", "Änderungen anzeigen", "Session-Änderungen im Diff-Browser anzeigen", "code"],
  ["lsp", "LSP-Steuerung", "Status, Server und Dateidiagnose verwalten", "code", undefined, undefined, undefined, undefined, "lsp"],
  ["setup-doctor", "Setup prüfen", "Konfiguration und Runtime-Konsistenz diagnostizieren", "code"],

  ["new", "Neue Sitzung", "Eine neue Sitzung beginnen", "sessions", undefined, undefined, "replaces-session"],
  ["resume", "Sitzung fortsetzen", "Eine andere Sitzung fortsetzen", "sessions", undefined, "Super+R", "replaces-session"],
  ["fork", "Sitzung verzweigen", "Von einer früheren Nutzernachricht verzweigen", "sessions", undefined, undefined, "replaces-session"],
  ["clone", "Sitzung klonen", "Aktuelle Position in eine neue Sitzung kopieren", "sessions", undefined, undefined, "replaces-session"],
  ["tree", "Sitzungsbaum", "Im Sitzungsbaum navigieren", "sessions", undefined, undefined, "replaces-session"],
  ["name", "Sitzung benennen", "Anzeigenamen der Sitzung setzen", "sessions", undefined, undefined, undefined, undefined, "name"],
  ["session", "Sitzungsinformationen", "Statistiken der aktuellen Sitzung anzeigen", "sessions"],
  ["compact", "Kontext kompaktieren", "Sitzungskontext manuell kompaktieren", "sessions", undefined, undefined, undefined, undefined, "compact"],

  ["settings", "Einstellungen", "Pi-Einstellungen öffnen", "system"],
  ["hotkeys", "Tastenkürzel", "Alle aktiven Tastenkürzel anzeigen", "system"],
  ["changelog", "Änderungsprotokoll", "Pi-Änderungsprotokoll anzeigen", "system"],
  ["reload", "Laufzeit neu laden", "Keybindings, Extensions, Skills, Prompts und Theme neu laden", "system", undefined, undefined, "replaces-session"],
  ["export", "Sitzung exportieren", "Sitzung als HTML oder JSONL exportieren", "system", undefined, undefined, undefined, undefined, "export"],
  ["import", "Sitzung importieren", "JSONL-Sitzung importieren und öffnen", "system", undefined, undefined, "replaces-session", undefined, "import"],
  ["share", "Sitzung teilen", "Sitzung als geheimen GitHub-Gist teilen", "system"],
  ["copy", "Letzte Antwort kopieren", "Letzte Agentenantwort in die Zwischenablage kopieren", "system"],
  ["quit", "Pi beenden", "Pi geordnet beenden", "system", undefined, undefined, "replaces-session", true],

  ["commands", "Command Center", "Alle Slash-Commands nach Aufgabenbereich öffnen", "system", undefined, "Super+Q"],
] as const satisfies ReadonlyArray<
  readonly [
    name: string,
    label: string,
    description: string,
    category: CommandCategoryId,
    aliases?: readonly string[],
    shortcut?: string,
    effect?: CommandEffect,
    dangerous?: boolean,
    guide?: CommandDefinition["guide"],
  ]
>;

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = definitions.map(
  ([name, label, description, category, aliases, shortcut, effect, dangerous, guide]) => ({
    name,
    label,
    description,
    category,
    ...(aliases ? { aliases } : {}),
    ...(shortcut ? { shortcut } : {}),
    ...(effect ? { effect } : {}),
    ...(dangerous ? { dangerous } : {}),
    ...(guide ? { guide } : {}),
  }),
);

export function normalizeAvailableCommands(
  commands: readonly SlashCommandInfo[],
): AvailableCommand[] {
  return commands.map((command) => ({
    name: command.name,
    description: command.description,
    source: command.source as AvailableCommand["source"],
  }));
}
