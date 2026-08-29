# Baseline-Menüs — Struktur und Bedeutung (Phase 0)

Quelle: `extensions/shared/command-catalog.ts` (kanonische Beschreibungen —
Autocomplete, Shortcut-Overlay und Command Center lesen ausschließlich von
hier, damit die drei Flächen nicht auseinanderlaufen).

## Menügruppen (COMMAND_CATEGORIES)

| ID        | Label               | Buchstabe | Umfang                                                                            |
| --------- | ------------------- | --------- | --------------------------------------------------------------------------------- |
| work      | Arbeit              | A         | laufende Facharbeit                                                               |
| plan      | Plan                | P         | Plan anzeigen/bearbeiten                                                          |
| subagents | Subagenten          | U         | Investigator/Debugger/Verifier, Status, Rollen-Modelle                            |
| models    | Modelle & Denken    | M         | Modellwahl, Rotation, Denktiefe                                                   |
| access    | Rechte & Vertrauen  | R         | Permission-Modus, YOLO, Trust, Login/Logout                                       |
| code      | Code & Diagnose     | C         | Changes/Diffs, LSP, Setup-Doctor, Inspector                                       |
| sessions  | Sitzungen & Kontext | S         | new/resume/fork/clone/tree/name/session/compact, Session-Health                   |
| resources | Vorlagen & Skills   | V         | Prompt-Templates, Skills                                                          |
| system    | System & Transfer   | T         | Settings, Hotkeys, Dashboard, Changelog, Reload, Export/Import, Share, Copy, Quit |

## Vollständige Commandliste (Katalog)

- **plan**: `view-plan`, `edit-plan`
- **subagents**: `investigator`, `debugger`, `verifier` (jeweils
  `starts-turn`, run-agent-Guide), `subagents-fleet`,
  `subagents-set-model` (Super+S)
- **models**: `model` (Super+M), `scoped-models`, `thinking` (Super+D)
- **access**: `permission`, `yolo` (Super+Y), `trust`, `login`,
  `logout` (dangerous)
- **code**: `changes`, `lsp`, `setup-doctor`, `inspect`
- **sessions**: `new`, `resume` (Super+R), `fork`, `clone`, `tree`,
  `name`, `session`, `compact` (alle replaces-session außer
  session/compact), `session-health`
- **system**: `settings`, `hotkeys`, `dashboard`, `changelog`, `reload`,
  `export`, `import`, `share`, `copy`, `quit` (dangerous),
  `commands` (Super+Q)

Dazu kommen die Pi-Built-ins (durch Runtime-Patch vollständig im Inventar:
22 Built-ins) sowie Skill-/Template-/Extension-Commands.

## Darstellungsflächen der TUI (nur Referenz, keine GUI-Vorgabe)

- Command Center (`/commands`, Super+Q) mit Bereichs-Buchstaben.
- Model-/Thinking-/Permission-/Resume-Selector als modale Overlays.
- Inspector (`inspect`): Changes, Kontext, Verification, Modelle,
  Reasoning, Diagnostics im Detail.
- Diff-Browser (`changes`): Edit-/Write-Verlauf der Session.
- Startbildschirm: Willkommens-Kachel mit Workflow/Modell/Denken/Ordner
  und Shortcut-Chips.
- Footer: eine Zeile, permanente Statusfläche (`docs/decisions/009`).
- Dashboard (`dashboard`, auto|compact|expanded|hidden; Umschaltung nur
  über `/dashboard`, kein eigener Shortcut — `docs/decisions/019`).

## Regel für Phase 4

Die Menüstruktur (Gruppen, Befehle, Bedeutungen, Effekte) ist funktional
zu erhalten. Die GUI darf alles visuell anders anordnen (Modal, Drawer,
Command Surface), aber keine Gruppe auflösen, umbenennen oder Commands
ohne dokumentierte Begründung umdeuten.
