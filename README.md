# Pi Agent — Aurora Setup

Dieses Repository ist die deklarative Quelle für ein kompaktes Pi-Coding-Agent-
Setup. Workflow, Berechtigungen, LSP, Subagenten und Darstellung bleiben
getrennte Laufzeitmodule.

## Laufzeitarchitektur

```text
Pi Core
├── setup-core        Konfiguration, /setup-doctor, allowlistetes verify
├── plan-mode         PlanSnapshot v3, Sidecar, Completion und Control Center
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
erlaubt den normalen Abschluss. `/finish` kann Befunde nur interaktiv und mit
Begründung übersteuern.

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

Shift+Tab öffnet das temporäre Control Center. `Super+P` öffnet die Planwahl,
`Super+M` Modell-Scopes, `Super+D` Thinking, `Super+Q` das Hauptmenü und
`Super+Y` den temporären YOLO-Modus. Die Super-Kombinationen benötigen
Kitty-/CSI-u-Unterstützung.

Automatische Ledger-Checkpoints, Doom-Loop-Entscheidungen und Edit-Metrik-Gates
wurden aus dem aktiven Workflow entfernt. Manuelle Ledger-, Diagnose- und
Verifikationsfunktionen bleiben bestehen.

## Installieren und verifizieren

Node `22.22.2` und npm `10.9.7` verwenden. Abhängigkeiten werden nie
automatisch installiert.

```bash
npm ci --prefix npm
npm --prefix npm run verify
npm run install:user -- --dry-run --target ~/.pi/agent
```

`/setup-doctor` meldet effektive Konfiguration, Vertrauen, Modell-Scopes,
LSP-Modus, Extension-Anzahl und Runtime-/Manifest-Drift, ohne Zugangsdaten zu
lesen. LSP-Server werden nicht automatisch installiert. Pakete bleiben exakt
gepinnt; Commit, Push, Veröffentlichung oder Dependency-Änderung erfolgen nur
auf ausdrücklichen Auftrag.
