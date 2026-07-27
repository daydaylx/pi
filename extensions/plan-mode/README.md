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

Workflow und Berechtigungsstufe bleiben orthogonal:

- `readonly` – Projekt lesen und sichere Inspect-Shell; in `planning` darf nur
  der aktuelle Plan geschrieben werden.
- `project-write` – normale Projektänderungen; riskante, destruktive und
  externe Aktionen fragen.
- `confirm-all` – jede Mutation und externe Aktion fragt.
- `yolo` – sichtbarer temporärer Bypass; harte Secret-, System-, Symlink- und
  Trust-Grenzen bleiben aktiv und der Zustand wird nie persistiert.

Legacy-Werte werden konservativ abgebildet:
`read-only`/`read-bash` → `readonly`, `read-write` → `project-write`,
`full-access` → `confirm-all`, persistiertes `yolo` → `project-write`.

Automatische Ledger-Checkpoints, Doom-Loop-Entscheidungen und Edit-Metrik-Gates
sind kein Bestandteil des aktiven Workflows. Die manuellen Diagnose- und
Ledger-Module bleiben verfügbar.
