# Pi Agent — Aurora Setup

Dieses Repository ist die deklarative Quelle für ein komfortorientiertes Pi
Coding Agent Setup. Plan-Workflow, Berechtigungen, LSP und Darstellung sind
separate Laufzeitmodule; nur Aurora besitzt angepasstes TUI-Chrome.

## Laufzeitarchitektur

```text
Pi Core
├── setup-core        effektive Konfiguration, /setup-doctor, allowlistetes verify-Tool
├── plan-mode         Shift+Tab Control Center, Workflow, Decision/Review/Work-Lifecycle
├── mode-permissions  Capability- und Pfad-Policy
├── lsp               lazy, trust-gesteuerte Language Server
├── pi-subagents      exakt gepinntes Orchestrierungspaket
└── aurora-ui         Editor, Footer, Activity-Oberfläche und Motion
```

`themes/aurora-night.json` definiert das einzige Farbsystem. Aurora nutzt einen
100-ms-Ticker nur, während kontextuelle Bewegung aktiv ist; `reduced` und `off`
halten niemals ein Animationsintervall vor. Die eingebauten Tools halten Pi's
Ausführungs- und Rendering-Verträge ein.

Der zentrale `setup.json` ist schema-gestützt. Die effektive Reihenfolge ist Defaults,
globales Setup, dann vertrauenswürdiges `.pi/setup.json`. Projektkonfiguration kann
globale Berechtigungen nicht lockern oder Host-Verifikationsbefehle ersetzen.

## Plan-Workflow

Die bestehende öffentliche UX bleibt verfügbar: Shift+Tab öffnet das temporäre Control
Center; `/plan`, `/decide`, `/review-plan`, `/work`, `/go`, `/done`, `/finish`
und `/plan-todos` behalten ihre bestehende Semantik. Das Control Center startet
mit Schnellplan, Architekturplan, Work-Modus und Optionen klären, und bietet
danach separate Menüs für Modell-Scopes, Thinking, Berechtigung und Ein-Datei-LSP-Diagnose.

Die TUI-Shortcuts bleiben auf das fokussierte Terminal begrenzt: `Shift+Tab`
öffnet Workflows, Review/To-dos und Skills; `Super+M` die Modell-Scopes;
`Super+D` Thinking und Status-Telemetrie; `Super+Q` das Hauptmenü. `Super+Y`
schaltet den sichtbaren YOLO-Voll-Bypass um; der Editor-Yank liegt deshalb auf
`Super+Shift+Y`. Für die Super-Kombinationen muss das Terminal das
Kitty-/CSI-u-Protokoll unterstützen.

Der Markdown-Plan bleibt `.agent/plans/current-plan.md`. Sidecar v2 speichert eine
stabile `planId`, Revision, Lifecycle, Todo-bezogenen Hash und gebundene `executionId` in
`.agent/plans/current-plan.state.json`; Lock/CAS-Schreibvorgänge und konservative
Migration schützen konkurrierenden oder älteren Zustand. CAS-Konflikte stoppen den
betreffenden Turn fail-closed und laden die gewinnende Revision für einen späteren Retry
neu. Während `/work` protokolliert das Modell Fortschritt über
`plan_progress(executionId, step, status, evidence)`; alte Fortschrittsmarker und `/done`
bleiben kompatible Fallbacks, funktionieren aber nur aus regulär mit `stopReason: stop`
beendeten Antworten und mit passendem Execution-Hash. Eine gespeicherte Ausführung wird
immer als `paused` wiederhergestellt und `/work` erfordert eine explizite Fortsetzung.
Decision Briefs werden nur eingespielt, wenn ihr gespeicherter Hash mit dem aktuellen Plan
verknüpft ist.

Plan-, Review-, Decision- und Completion-Ergebnisse werden erst bei `agent_settled`
finalisiert. Dadurch laufen Handoff-Menüs erst im Idle-Zustand, Retries zählen nur mit
ihrem letzten Ergebnis und Completion-Nachrichten erzeugen keinen unbeabsichtigten
Folgeturn. Asynchrone Workflow-Aktionen sind zusätzlich an Session-Epoch und Session-ID
gebunden; `/done` ist idle-only, `/work` serialisiert parallele Starts und setzt eine noch
aktive Execution nur nach erneuter Hash-Prüfung mit derselben ID fort. Complete-Archive
validieren Hash und Todo-Stand unter dem Workspace-Lock.

Planning, Review, Decision, Execution, Paused, Blocked und Ready sind technisch
erzwungene Capability-Phasen, keine reinen Prompt-Konventionen. Jede Phase legt nur
ihre nötige Lese-, Rückfrage-, Verifikations- oder Fortschrittsfläche offen; Ausführungs-
fortschritt ist zusätzlich an den aktiven Plan und die Ausführungsidentität gebunden.

Jede erfolgreiche Workflow-Aktivierung sowie jeder Session-Start setzt die
Permission-Stufe auf den zugehörigen Wert aus
`permissions.workflowDefaults` zurück. Die Standardkonfiguration startet alle
drei Workflow-Modi mit `read-bash`; manuelle Stufenwechsel gelten nur bis zum
nächsten Workflow-Reset.

## Installieren und verifizieren

Node `22.22.2` und npm `10.9.7` verwenden.

```bash
npm ci --prefix npm
npm run verify
npm run install:user -- --dry-run --target ~/.pi/agent
npm run install:user -- --apply --target ~/.pi/agent
```

Der Installer kopiert nur eine explizite Setup-Allowlist, einschließlich der npm-
Manifeste, TypeScript-Konfiguration und des von `verify` benötigten Test-Harness. Er kopiert
niemals Authentifizierung, Sitzungen, Caches, Backups, `.git`, Symlinks oder
installierte Abhängigkeiten. Wenn dieser Checkout bereits `~/.pi/agent` ist,
ist die Installation ein No-op.

Für ein externes leeres Ziel dort nach der Installation `npm ci --prefix ~/.pi/agent/npm`
ausführen, bevor `verify` genutzt wird. Die Abhängigkeitsinstallation ist bewusst
getrennt und erfordert die Zustimmung des Nutzers; der Installer lädt niemals
eigenständig Pakete herunter.

`/setup-doctor` nach einem Pi-Upgrade oder einer Konfigurationsänderung ausführen. Es meldet
effektive Konfiguration, Vertrauen, Modell-Scopes, LSP-Modus, aktive Extension-Anzahl
und Manifest-/Installationsversions-Drift, ohne Zugangsdaten zu lesen.

## Sicherheit und Updates

- Unbekannte Tools erfordern in Read+Write und Full eine Bestätigung und sind in
  strengeren Stufen blockiert. `Super+Y` beziehungsweise `/yolo` aktiviert dagegen
  bewusst einen vollständigen, im Footer klar markierten Anwendung-Bypass: Policy,
  Workflow-Grenzen, Secret-/Systempfadprüfungen und Bestätigungen greifen dann nicht.
  Extern erzwungene OS- oder Containergrenzen bleiben davon unberührt.
- Jeder Permission-Reset und YOLO-Wechsel wird als redigierter Session-Audit-Eintrag
  gespeichert; er enthält nur Zeit, Quelle, Workflow und Zugriffszustand, niemals
  Befehle, Pfade oder Tool-Inhalte.
- `verify` akzeptiert nur `typecheck`, `test` oder `verify`; es kann keine freie
  Shell-Eingabe ausführen und führt immer die festen Prüfungen dieses Setups aus dem Agent-
  Verzeichnis aus. Projekt-Test-Skripte durchlaufen weiterhin die normale Bash-Policy.
  Zusätzlich: advisory `/verify-gate` ([`docs/verification-gate.md`](docs/verification-gate.md)),
  vertrauensgebundene Projekt-Profile ([`docs/verify-profiles.md`](docs/verify-profiles.md))
  und Task-Contract/Scope-Kontrolle ([`docs/task-contract.md`](docs/task-contract.md)).
- Benchmark-Infrastruktur und Baseline-Methodik: [`docs/benchmark-baseline.md`](docs/benchmark-baseline.md).
- LSP-Server werden nie automatisch installiert und starten erst bei erster Nutzung.
  Projekt-lokale LSP-Konfiguration (`.pi/lsp.json`) wird nur bei vertrautem Projekt
  berücksichtigt, sonst vollständig verworfen; LSP meldet seinen Zustand an Aurora.
  Nutzer-Doku, Server-Matrix und Beispielkonfiguration: [`docs/lsp.md`](docs/lsp.md).
- Nur der Worker-Subagent besitzt rohe Bash-/Schreib-Tools. Review-Agenten sind
  technisch nur lesend; der Test Runner erhält nur das allowlistete `verify`-Tool.
- Plan-, LSP- und Aurora-Provider setzen Session-Overrides zurück und entfernen ihre
  Eventbus-Listener beim Shutdown bzw. Sessionersatz.
- Pakete bleiben exakt gepinnt. Abhängigkeiten nicht aktualisieren, committen oder
  Branches veröffentlichen ohne ausdrückliche Freigabe.

Die früheren Zentui-/Tool-Display-Dateien bleiben im Repository zum Vergleich erhalten,
sind aber keine aktiven Laufzeit-Besitzer. Ein Rollback bedeutet, die vorherigen
`settings.json`-Paket- und Extension-Allowlists wiederherzustellen; Authentifizierung und
Sitzungszustand sind davon nicht betroffen.
