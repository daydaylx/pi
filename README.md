# Pi Agent — Aurora Setup

Dieses Repository ist die deklarative Quelle für ein kompaktes Pi-Coding-Agent-
Setup. Workflow, Berechtigungen, LSP, Subagenten und Darstellung bleiben
getrennte Laufzeitmodule.

## Laufzeitarchitektur

```text
Pi Core
├── setup-core        Konfiguration, /setup-doctor, allowlistetes verify
├── plan-mode         PlanSnapshot v3, Sidecar, Completion, Control Center
├── mode-permissions  vier Berechtigungsmodi und harte Projektgrenzen
├── lsp               lazy, trust-gesteuerte Language Server
├── pi-subagents      gepinnte Orchestrierung; lokale Kernrollen
└── aurora-ui         Editor, Footer, Activity und Motion
```

`themes/aurora-night.json` definiert das Farbsystem. Der zentrale
`setup.json` ist schema-gestützt; vertrauenswürdige Projektkonfiguration darf
globale Berechtigungen nicht lockern oder Host-Verifikationsbefehle ersetzen.

## Plan-Workflow

Der öffentliche Kern bleibt `/plan → /work`. Der Plan unter
`.agent/plans/current-plan.md` ist der unveränderliche fachliche Snapshot; der
v3-Sidecar hält ausschließlich Laufzeitstatus und Evidence. Stabile
`PI-STEP-ID`s verbinden beide Artefakte.

Die Statuswerte sind exakt `idle`, `planning`, `working`, `reviewing`,
`paused`, `blocked` und `done`. Atomare CAS-Schreibvorgänge schützen
konkurrierenden Zustand. Es gibt keine Lease, keinen Heartbeat und keine
zeitgesteuerte Übernahme. v1/v2-Migration erfordert `/migrate-plan`, eine
Bestätigung geschlossener Alt-Sessions und ein vorheriges Backup.

Completion prüft Diff, Scope, klassifizierte Verifikationsprofile, LSP und
einen unabhängigen Reviewer. Erst ein exakter
`[COMPLETION-REVIEW:PASS]`-Marker plus erfolgreiche erforderliche Checks
erlaubt den normalen Abschluss. `/finish` (Plan) und `/task-done` (Direktauftrag)
rufen denselben internen Handler; Befunde lassen sich nur interaktiv und mit
Begründung übersteuern. `/verify-gate` zeigt dieselben Prüfungen vorab an,
entscheidet aber nichts und schließt nichts ab.

Details: [`extensions/plan-mode/README.md`](extensions/plan-mode/README.md).

## Berechtigungen

Die vier Modi sind:

- `readonly`: Reads und sichere Inspect-Shell.
- `project-write`: normale Projektänderungen, Rückfrage bei Risiko oder
  externen Aktionen.
- `confirm-all`: Rückfrage bei jeder Mutation und externen Aktion.
- `yolo`: temporärer sichtbarer Bypass; harte Secret-, System-, Symlink- und
  Trust-Grenzen bleiben aktiv.

Work startet standardmäßig mit `project-write`, beide Planvarianten mit
`readonly`. YOLO wird nie persistiert. Alte fünfstufige Werte werden beim
Einlesen konservativ auf die vier Modi abgebildet.

## Subagenten

Lokale Kernrollen sind ausschließlich `planner`, `worker` und `reviewer`.
Paket-Builtins sind über `subagents.disableBuiltins` deaktiviert. Der
Completion-Reviewer wird über die versionierte In-Process-RPC von
`pi-subagents` gestartet; ein Web-Researcher ist mangels Web-Toolchain nicht
installiert.

Details: [`docs/subagents.md`](docs/subagents.md).

## UI und Shortcuts

`/plan` öffnet einen zustandsabhängigen Assistenten; `/plan quick`,
`/plan architecture` und `Super+P` starten die Planung bewusst sofort.
`Super+Q` oder `/commands` öffnet das vollständige, deutsch beschriftete
Command Center. Seine acht Bereiche lassen sich im Menü direkt mit
`A/P/M/R/C/S/V/T` öffnen: Arbeit, Plan, Modelle, Rechte, Code, Sitzungen,
Vorlagen und System. Jeder Eintrag zeigt seinen kanonischen Slash-Command;
Aliase stehen nur als Hinweis am Original. Geladene Prompt- und Skill-Commands
werden aus der Runtime ergänzt.

Alle globalen Shortcuts sprechen dieselbe Slash-Sprache: `Shift+Tab` sendet
`/workflow`, `Super+P` `/plan`, `Super+M` `/model`, `Super+D` `/thinking`,
`Super+Y` `/yolo`, `Super+S` `/agent-models` und `Super+Q` `/commands`.
Der Workflow-Wechsel trennt Schnellplan, Architekturplan,
**Plan ausführen / fortsetzen** und **Direktauftrag starten / fortsetzen**.
Planarbeit startet nur mit einem vorhandenen Plan; ein Direktauftrag erfasst
Ziel, Scope, Verifikation und Abschlusskriterien ohne PlanSnapshot. `/work` und
`/task` bleiben die expliziten Kommando-Einstiege. Menü- und Shortcut-Aktionen
laufen durch denselben Slash-Dispatcher wie manuelle Eingaben; vorhandener
Editor-Text bleibt erhalten oder wird vor Turn-/Sitzungswechseln bestätigt.
Die Super-Kombinationen benötigen Kitty-/CSI-u-Unterstützung.

Aurora besitzt Editor, Fußzeile, Widget, Aktivität und Motion. Die Fußzeile ist
die einzige Statusfläche: Modell, Denktiefe, Projekt, Berechtigung, LSP und
Kontext stehen dort und nirgends sonst; der Editorrahmen trägt nur Arbeitsablauf
und Schritt. Die Statuswerte `workflow`, `permissions` und `lsp` liefern
`plan-mode`, `mode-permissions` und `lsp`.

`Super+M` listet die verfügbaren Modelle der Registry; während eines laufenden
Turns ist der Wechsel gesperrt. Die frühere Scoped-Model-Übersicht entfällt.
Im Auto-Modus folgt die Denktiefe dem Workflow: ein Wechsel der Planart passt
sie sofort an, eine manuell gewählte Stufe bleibt unangetastet.

Ledger-Checkpoints, Doom-Loop-Entscheidungen und Edit-Metrik-Gates sind samt
Modulen entfernt. `docs/CONTEXT_LEDGER.md` bleibt als handgepflegte
Dokumentation und wird von keinem Laufzeitcode geschrieben. Eine unterbrochene
Ausführung meldet `plan-mode` beim Sitzungsstart und verweist auf `/work` —
einen separaten Recovery-Dialog gibt es nicht mehr.

Begründete Architekturentscheidungen: [`docs/decisions/`](docs/decisions/).

## Installieren und verifizieren

Node `22.22.2` und npm `10.9.7` verwenden. Abhängigkeiten werden nie
automatisch installiert.

```bash
npm ci --prefix npm
npm --prefix npm run verify
npm run install:user -- --dry-run --target ~/.pi/agent
```

Die lokal gepatchte Pi-Runtime liegt außerhalb dieses Arbeitsbaums und verliert
ihre Patches bei jedem Runtime-Update.
`node scripts/apply-runtime-patches.mjs --apply` stellt sie idempotent wieder
her, `node tests/p1-runtime.mjs` verifiziert sie;
Einzelheiten in [`docs/RUNTIME_PATCHES.md`](docs/RUNTIME_PATCHES.md).

`/setup-doctor` meldet effektive Konfiguration, Vertrauen, Modell-Scopes,
LSP-Modus, Extension-Anzahl und Runtime-/Manifest-Drift, ohne Zugangsdaten zu
lesen. LSP-Server werden nicht automatisch installiert. Pakete bleiben exakt
gepinnt; Commit, Push, Veröffentlichung oder Dependency-Änderung erfolgen nur
auf ausdrücklichen Auftrag.
