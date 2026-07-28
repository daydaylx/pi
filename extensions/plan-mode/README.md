# Plan workflow v3

Der Workflow ist bewusst klein:

```text
/plan → /work → Completion → Archiv
```

`/review-plan` ist optional. `/finish` startet dieselbe Completion-Pipeline
manuell; ein fehlgeschlagener Abschluss kann ausschließlich im TUI und nur mit
einer nichtleeren Begründung übersteuert werden.

## Artefakte

- `.agent/plans/current-plan.md` ist die einzige fachliche Quelle.
- `.agent/plans/current-plan.state.json` ist die einzige Laufzeitquelle.
- `.agent/plans/current-plan.completion.json` existiert nur zwischen
  erfolgreichem Completion-Commit und Archivierung.
- `.agent/direct-task.json` beschreibt direkte Aufgaben ohne Plan.
- `.agent/plans/archive/` enthält abgeschlossene Plansnapshots samt Bericht.

Der Plan trägt Metadaten v3 (`planId`, `planRevision`, `planType`) und
unsichtbare stabile `PI-STEP-ID`s. Fortschritt, Evidence und aktiver Schritt
stehen ausschließlich im Sidecar. Während `working` ist der Markdown-Plan
unveränderlich.

## Planvertrag

Quick Plan und Architekturplan verwenden diese Abschnitte:

1. Ziel
2. Nicht-Ziele
3. Gewählte Lösung
4. Annahmen
5. Umsetzungsschritte
6. Betroffene Bereiche
7. Technischer Scope
8. Änderungsregeln
9. Risiken
10. Verifikation
11. Abschlusskriterien

Ein Architekturplan ergänzt zwei bis vier tatsächlich bewertete Optionen. Ein
Quick Plan erfindet keine Alternativen und erzeugt keinen Decision Brief.
Technischer Scope besteht ausschließlich aus sicheren projekt-relativen Pfaden
oder Globs.

## Zustände und Persistenz

Die einzigen Statuswerte sind `idle`, `planning`, `working`, `reviewing`,
`paused`, `blocked` und `done`. Sidecar-Schreibvorgänge sind atomar,
hashgebunden und verwenden CAS. `done` kann ausschließlich
`commitWorkflowDone()` setzen.

Es gibt weder Lease noch Heartbeat noch zeitgesteuerte Lock-Übernahme. Eine
unterbrochene Ausführung wird mit `/work` ausdrücklich fortgesetzt. Ein
verwaister Lock wird nur über `/recover-workflow-lock` und nach TUI-Bestätigung
entfernt.

v1/v2 werden niemals still migriert. `/migrate-plan` verlangt die Bestätigung,
dass alte Sessions geschlossen sind, blockiert bei einer noch lebenden
v2-Lease und legt vorher ein Backup unter
`.agent/plans/migration-backup/` an.

## Commands

- `/plan [quick|architecture]` oder `Super+P` – Plan erstellen/überarbeiten.
- `/review-plan` – stateless Plan-Review; Änderungen erzeugen eine neue Revision.
- `/work`, `/go` – Ausführung ausdrücklich starten oder fortsetzen.
- `/plan-todos` – Schritte mit Sidecar-Status anzeigen.
- `/done <n> [m …]` – manueller Evidence-Fallback.
- `/finish` – Completion-Pipeline starten.
- `/discard-plan` – aktiven Plan nach Bestätigung verwerfen.
- `/migrate-plan` – v1/v2 nach v3 migrieren.
- `/recover-workflow-lock` – verwaisten Lock bestätigt entfernen.
- `/task <Ziel>`, `/task-done` – direkte Aufgabe mit eigenem Scope-Vertrag.

Shift+Tab öffnet das kompakte Control Center für Schnellplan,
Architekturplan, Arbeit, Berechtigungen, Modelle, Thinking und LSP.
`Super+M`, `Super+D`, `Super+Q` und `Super+Y` behalten ihre Modell-, Thinking-,
Hauptmenü- und temporäre YOLO-Grundfunktion.

## Module

```text
index.ts                  erzeugt die Session, registriert Commands und Events
commands.ts               Command-, Tool- und Shortcut-Registrierung
events.ts                 Lifecycle-Hooks und Capability-Responder
session.ts                Sitzungszustand (WorkflowSession) und Persistenz-Adapter
planning.ts               Prompts sowie /plan und /review-plan
execution.ts              /work, /go und Schrittfortschritt
completion-commands.ts    /finish und /task-done als Orchestrierung
direct-task-commands.ts   /task: Eligibility und Erstellung
maintenance-commands.ts   /discard-plan, /migrate-plan, /recover-workflow-lock
model-menu.ts             Modellauswahl (Super+M und Hauptmenü)
plan-snapshot.ts          Planvertrag, Metadaten und stabile Step-IDs
scope.ts                  Glob-Matcher für den technischen Scope
presentation.ts           Statuszeile, Fehlermeldungen und TUI-Eingabe
reviewer-rpc.ts           unabhängiger Reviewer über die Subagent-RPC
lsp-bridge.ts             LSP-Diagnosen für die Completion

completion/               Completion-Pipeline (rein, ohne Sitzung und UI)
  index.ts                Orchestrierung und öffentliche API
  types.ts                gemeinsame Completion-Typen
  secret-boundary.ts      harte Secret-/Auth-Grenze
  diff-evidence.ts        Diff-Erfassung, Hashing und Diff-Stabilität
  verification.ts         Setup-Checks, Projektprofile, Verifikationsabdeckung
  scope-check.ts          technischer Scope (rein)
  lsp-check.ts            LSP-Diagnosen als Completion-Checks
  reviewer-check.ts       Reviewer-Input, -Aufruf und Marker-Validierung
  result-policy.ts        pass/fail/blocked und Override-Zulässigkeit (rein)
  report.ts               persistierter Completion-Bericht
  formatter.ts            Nutzerausgabe

store/                    Persistenz: paths, atomic-files, types, locks,
                          workflow-state (+ -schema, -factory, -load),
                          workflow-done, archive, migration, direct-task
```

Die Controller importieren einander nicht zyklisch; jeder persistente
Schreibvorgang läuft über `store/`.

`plan-snapshot.ts` bleibt bewusst ungeteilt: die Datei hat keinen
Dateisystemzugriff, keine UI-Formatierung, keine State-Mutation und keine
Command-Logik — sie beschreibt ausschließlich den Planvertrag und ändert sich
deshalb immer als Ganzes. `parsePlanSnapshot` verschränkt Parsing und
Validierung bewusst in einem Durchlauf über die Abschnitte.

## Completion

Die Pipeline prüft in dieser Reihenfolge:

1. Plan-/State-Hash und vollständig erledigte Schritte,
2. `git diff --check`, Diff-Stat, Dateiliste und Scope,
3. harte Secret-/Auth-Grenzen,
4. erforderliche, empfohlene und advisory Projektprofile,
5. LSP-Diagnosen für unterstützte geänderte Dateien,
6. einen unabhängigen `reviewer` über die versionierte Subagent-RPC,
7. unveränderten Diff, Plan und Sidecar nach dem Review.

Das Reviewer-Urteil ist exakt `PASS`, `REWORK` oder `UNVERIFIABLE`; der
verbindliche Marker muss die letzte nichtleere Reviewer-Zeile sein. Nur
`PASS` plus erfolgreiche erforderliche Checks führt ohne Override zu `done`.
Secret-/Auth-Befunde sind harte Grenzen und auch interaktiv nicht
übersteuerbar.

## Berechtigungen

Entry-Point bleibt `extensions/mode-permissions.ts` (Registrierung und
Verdrahtung); die Logik liegt in `extensions/permissions/`:

```text
tool-event.ts       Pfad aus einem Tool-Call lesen
workflow-policy.ts  workflow-bezogene Entscheidungen   (rein)
tool-policy.ts      Entscheidungen nach Berechtigungsstufe (rein)
session-state.ts    Modus, Workflow-Defaults, YOLO, Persistenz, Audit
thinking-control.ts Denktiefe und ihr Menü
menus.ts            Berechtigungsmenü
guards.ts           die tool_call-/user_bash-Interceptoren
```

Workflow und Berechtigungsstufe bleiben orthogonal:

- `readonly` – Projekt lesen und sichere Inspect-Shell; in `planning` darf nur
  der aktuelle Plan geschrieben werden.
- `project-write` – normale Projektänderungen; riskante, destruktive und
  externe Aktionen fragen.
- `confirm-all` – jede Mutation und externe Aktion fragt.
- `yolo` – sichtbarer temporärer Bypass; harte Secret-, System-, Symlink- und
  Trust-Grenzen bleiben aktiv und der Zustand wird nie persistiert.

Die Workflow-Entscheidung fällt vor der Berechtigungsstufe. `yolo` hebt daher
die Planungszusage nicht auf: während `planning` bleibt jeder Schreibzugriff
außerhalb des aktuellen Plans blockiert.

Legacy-Werte werden konservativ abgebildet:
`read-only`/`read-bash` → `readonly`, `read-write` → `project-write`,
`full-access` → `confirm-all`, persistiertes `yolo` → `project-write`.

Automatische Ledger-Checkpoints, Doom-Loop-Entscheidungen und Edit-Metrik-Gates
sind kein Bestandteil des aktiven Workflows; ihre Module wurden entfernt. Die
manuellen Diagnose- und Ledger-Funktionen bleiben verfügbar.
