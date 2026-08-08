import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";

export type CommandCategoryId =
  | "work"
  | "plan"
  | "subagents"
  | "models"
  | "access"
  | "code"
  | "sessions"
  | "resources"
  | "system";

export type CommandEffect =
  "preserve-draft" | "starts-turn" | "replaces-session";

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
  guide?:
    "compact" | "export" | "import" | "lsp" | "name" | "route" | "run-agent";
}

export interface AvailableCommand {
  name: string;
  description?: string;
  source: SlashCommandInfo["source"] | "builtin";
}

export const COMMAND_CATEGORIES: readonly CommandCategory[] = [
  { id: "work", label: "Arbeit", shortcut: "A" },
  { id: "plan", label: "Plan", shortcut: "P" },
  { id: "subagents", label: "Subagenten", shortcut: "U" },
  { id: "models", label: "Modelle & Denken", shortcut: "M" },
  { id: "access", label: "Rechte & Vertrauen", shortcut: "R" },
  { id: "code", label: "Code & Diagnose", shortcut: "C" },
  { id: "sessions", label: "Sitzungen & Kontext", shortcut: "S" },
  { id: "resources", label: "Vorlagen & Skills", shortcut: "V" },
  { id: "system", label: "System & Transfer", shortcut: "T" },
] as const;

const definitions = [
  [
    "workflow",
    "Workflow wechseln",
    "Work, Schnellplan oder Architekturplan auswählen",
    "work",
  ],
  [
    "plan",
    "Planmodus",
    "Schnellplan oder Architekturplan auswählen",
    "work",
    undefined,
    "Super+P",
  ],
  [
    "work",
    "Work-Modus",
    "Normale Projektarbeit ohne Planpflicht aktivieren",
    "work",
  ],
  [
    "go",
    "Plan umsetzen",
    "Aktuellen Plan einmalig als Kontext übernehmen und Work-Turn starten",
    "work",
  ],

  [
    "view-plan",
    "Plan anzeigen",
    "Vollständigen Markdown-Plan im Terminal anzeigen",
    "plan",
    ["show-plan"],
  ],
  [
    "edit-plan",
    "Plan bearbeiten",
    "current-plan.md im aktiven Planmodus bearbeiten",
    "plan",
    ["plan-edit"],
  ],

  [
    "investigator",
    "Investigator",
    "Repository untersuchen / Änderungssurface finden",
    "subagents",
    undefined,
    undefined,
    "starts-turn",
    undefined,
    "run-agent",
  ],
  [
    "debugger",
    "Debugger",
    "Fehler reproduzieren / Ursache eingrenzen",
    "subagents",
    undefined,
    undefined,
    "starts-turn",
    undefined,
    "run-agent",
  ],
  [
    "verifier",
    "Verifier",
    "Umsetzung unabhängig prüfen",
    "subagents",
    undefined,
    undefined,
    "starts-turn",
    undefined,
    "run-agent",
  ],
  [
    "subagents-fleet",
    "Status",
    "Aktive/laufende Subagenten anzeigen",
    "subagents",
  ],

  [
    "model",
    "Modell wählen",
    "Modell für diese Sitzung auswählen",
    "models",
    undefined,
    "Super+M",
  ],
  [
    "scoped-models",
    "Modellumfang",
    "Modelle für die native Modellrotation auswählen",
    "models",
  ],
  [
    "thinking",
    "Denktiefe",
    "Automatische oder manuelle Denktiefe wählen",
    "models",
    undefined,
    "Super+D",
  ],

  [
    "permission",
    "Berechtigungsmodus",
    "Zugriffsstufe für diese Sitzung wählen",
    "access",
  ],
  [
    "yolo",
    "YOLO umschalten",
    "Temporären YOLO-Modus ein- oder ausschalten",
    "access",
    undefined,
    "Super+Y",
  ],
  [
    "trust",
    "Projektvertrauen",
    "Vertrauensentscheidung für das Projekt speichern",
    "access",
  ],
  [
    "login",
    "Provider anmelden",
    "Provider-Authentifizierung konfigurieren",
    "access",
  ],
  [
    "logout",
    "Provider abmelden",
    "Gespeicherte Provider-Authentifizierung entfernen",
    "access",
    undefined,
    undefined,
    undefined,
    true,
  ],

  [
    "changes",
    "Änderungen anzeigen",
    "Session-Änderungen im Diff-Browser anzeigen",
    "code",
  ],
  [
    "lsp",
    "LSP-Steuerung",
    "Status, Server und Dateidiagnose verwalten",
    "code",
    undefined,
    undefined,
    undefined,
    undefined,
    "lsp",
  ],
  [
    "setup-doctor",
    "Setup prüfen",
    "Konfiguration und Runtime-Konsistenz diagnostizieren",
    "code",
  ],

  [
    "new",
    "Neue Sitzung",
    "Eine neue Sitzung beginnen",
    "sessions",
    undefined,
    undefined,
    "replaces-session",
  ],
  [
    "resume",
    "Sitzung fortsetzen",
    "Eine andere Sitzung fortsetzen",
    "sessions",
    undefined,
    "Super+R",
    "replaces-session",
  ],
  [
    "fork",
    "Sitzung verzweigen",
    "Von einer früheren Nutzernachricht verzweigen",
    "sessions",
    undefined,
    undefined,
    "replaces-session",
  ],
  [
    "clone",
    "Sitzung klonen",
    "Aktuelle Position in eine neue Sitzung kopieren",
    "sessions",
    undefined,
    undefined,
    "replaces-session",
  ],
  [
    "tree",
    "Sitzungsbaum",
    "Im Sitzungsbaum navigieren",
    "sessions",
    undefined,
    undefined,
    "replaces-session",
  ],
  [
    "name",
    "Sitzung benennen",
    "Anzeigenamen der Sitzung setzen",
    "sessions",
    undefined,
    undefined,
    undefined,
    undefined,
    "name",
  ],
  [
    "session",
    "Sitzungsinformationen",
    "Statistiken der aktuellen Sitzung anzeigen",
    "sessions",
  ],
  [
    "compact",
    "Kontext kompaktieren",
    "Sitzungskontext manuell kompaktieren",
    "sessions",
    undefined,
    undefined,
    undefined,
    undefined,
    "compact",
  ],

  ["settings", "Einstellungen", "Pi-Einstellungen öffnen", "system"],
  ["hotkeys", "Tastenkürzel", "Alle aktiven Tastenkürzel anzeigen", "system"],
  [
    "changelog",
    "Änderungsprotokoll",
    "Pi-Änderungsprotokoll anzeigen",
    "system",
  ],
  [
    "reload",
    "Laufzeit neu laden",
    "Keybindings, Extensions, Skills, Prompts und Theme neu laden",
    "system",
    undefined,
    undefined,
    "replaces-session",
  ],
  [
    "export",
    "Sitzung exportieren",
    "Sitzung als HTML oder JSONL exportieren",
    "system",
    undefined,
    undefined,
    undefined,
    undefined,
    "export",
  ],
  [
    "import",
    "Sitzung importieren",
    "JSONL-Sitzung importieren und öffnen",
    "system",
    undefined,
    undefined,
    "replaces-session",
    undefined,
    "import",
  ],
  [
    "share",
    "Sitzung teilen",
    "Sitzung als geheimen GitHub-Gist teilen",
    "system",
  ],
  [
    "copy",
    "Letzte Antwort kopieren",
    "Letzte Agentenantwort in die Zwischenablage kopieren",
    "system",
  ],
  [
    "quit",
    "Pi beenden",
    "Pi geordnet beenden",
    "system",
    undefined,
    undefined,
    "replaces-session",
    true,
  ],

  [
    "commands",
    "Command Center",
    "Alle Slash-Commands nach Aufgabenbereich öffnen",
    "system",
    undefined,
    "Super+Q",
  ],
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

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] =
  definitions.map(
    ([
      name,
      label,
      description,
      category,
      aliases,
      shortcut,
      effect,
      dangerous,
      guide,
    ]) => ({
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

const definitionByName = new Map(
  COMMAND_DEFINITIONS.map((definition) => [definition.name, definition]),
);

/**
 * The one canonical description per command. Autocomplete, the shortcut
 * overlay and the Command Center menu all read from here instead of keeping
 * their own copy, so the three surfaces cannot drift back into three
 * different explanations of the same command.
 */
export function catalogDescription(name: string): string {
  const definition = definitionByName.get(name);
  if (!definition) throw new Error(`Kein Katalogeintrag für /${name}`);
  return definition.description;
}

export function catalogLabel(name: string): string {
  const definition = definitionByName.get(name);
  if (!definition) throw new Error(`Kein Katalogeintrag für /${name}`);
  return definition.label;
}

export function normalizeAvailableCommands(
  commands: readonly SlashCommandInfo[],
): AvailableCommand[] {
  return commands.map((command) => ({
    name: command.name,
    description: command.description,
    source: command.source as AvailableCommand["source"],
  }));
}
