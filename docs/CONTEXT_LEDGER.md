# Context Ledger — agent

<!-- Dauerhaftes Projektgedächtnis. Nur bestätigte, dauerhaft relevante
     Fakten. Keine Logs, Chats, Secrets, Rohdaten. Flüchtiger
     Arbeitszustand gehört in docs/PROJECT_STATE.md.
     Ausführlich begründete Architekturentscheidungen: docs/decisions/.
     Gepflegt ausschließlich über den Skill `context-checkpoint`; es gibt
     keinen Laufzeitcode, der diese Datei schreibt. -->

## Bestätigte Nutzerentscheidungen

- Aurora Night mit kontextueller Bewegung; `reduced` und `off` bleiben über `setup.json` verfügbar
- Berechtigungsmodell: `readonly`, `project-write`, `confirm-all`, temporäres `yolo`. Work startet mit `project-write`, beide Planvarianten mit `readonly`. YOLO wird nie persistiert
- Frischer Subagenten-Kontext, maximale Parallelität drei
- Modellwahl folgt Pi-nativ `settings.enabledModels`; die Auswahl wechselt sofort zum gewählten Modell und ist während eines laufenden Turns gesperrt
- **Shift+Tab ist der Workflow-Wechsel** (Schnellplan, Architekturplan, Plan ausführen/fortsetzen, Direktauftrag starten/fortsetzen). Super+Q öffnet das vollständige Control Center, dessen erster Reiter genau dieser Workflow-Wechsel ist
- Thinking zeigt sichtbar „Auto" oder „Manuell"; im Auto-Modus folgt die Denktiefe dem Workflow, eine manuell gewählte Stufe bleibt unangetastet
- Diagnose zeigt Status und erlaubt eine Dateiprüfung über eine kurze Dateiauswahl
- Ctrl+Shift+X ist entfernt
- Alte UI-/Renderer-Dateien werden **nicht** inaktiv aufbewahrt, sondern gelöscht; die Git-Historie ist die Rückfallebene (ersetzt die frühere gegenteilige Entscheidung, siehe [007](decisions/007-aurora-single-ui-owner.md))
- YOLO-Autostart und Prompt-only-Planmodi sind bewusst akzeptierte Restrisiken

## Architekturentscheidungen

Ausführlich unter [`docs/decisions/`](decisions/):

| Nr.                                                     | Entscheidung                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| [001](decisions/001-workflow-v3.md)                     | Workflow v3 als einziger Workflow; ein kanonischer `WorkflowStatus` |
| [002](decisions/002-remove-execution-lease.md)          | Keine Execution Lease, kein Heartbeat                               |
| [003](decisions/003-keep-cas.md)                        | CAS und atomare Schreibvorgänge bleiben                             |
| [004](decisions/004-remove-task-contract.md)            | Kein Task Contract, kein Decision Brief                             |
| [005](decisions/005-three-agent-model.md)               | Drei lokale Rollen: Planner, Worker, Reviewer                       |
| [006](decisions/006-single-completion-pipeline.md)      | Genau eine Completion-Pipeline                                      |
| [007](decisions/007-aurora-single-ui-owner.md)          | Aurora ist einziger aktiver UI-Besitzer                             |
| [008](decisions/008-context-ledger-is-documentation.md) | Das Context Ledger ist Dokumentation, keine Laufzeitkomponente      |

Zusätzlich dauerhaft:

- `setup.json` ist die zentrale, validierte Konfiguration für UI, Permissions, LSP, Subagenten und Verifikation
- `permissions.workflowDefaults` ordnet Workflow zu Normalstufe zu; vertrauenswürdige Projekte dürfen sie nur weiter **einschränken**, nie lockern
- Pi Core bleibt alleiniger Compaction-Eigentümer; keine zweite Compaction
- `plan-mode/index.ts` enthält ausschließlich Registrierung und Event-Verdrahtung; der Sitzungszustand liegt in `session.ts` (`WorkflowSession`), die Handler bei ihrer Fachlichkeit. `completion/` ist die reine Pipeline, `completion-commands.ts` orchestriert `/finish` und `/task-done`
- Workflow-Persistenz liegt in `plan-mode/store/` (paths, atomic-files, types, locks, workflow-state, archive, migration, direct-task) mit `store/index.ts` als Barrel
- Legacy-Migration ist auf `store/migration.ts` und `/migrate-plan` isoliert. Letzte unterstützte Legacy-Version: **v2**
- Benchmarks sind Entwicklungswerkzeug: keine Runtime-Kopplung, kein Completion-Gate, separat startbar

## Nicht-Ziele

- Keine externe Memory-, Smart-Compaction- oder Context-Extension
- Kein Eingriff in Pi-Core-Compaction ohne Verlustbeleg
- Keine permanente UI-Chrome oder Sidebar; Menüs bleiben temporäre Overlays
- Keine langen Modelllisten im Alltagsmenü
- Kein vollständiger Diagnose-Browser
- Keine zweite Ablaufzentrale für Plan/Work/Review
- Kein Austausch von `pi-subagents`, keine Änderung am gepinnten Drittanbieter-Fork
- Keine neuen Abhängigkeiten, keine Erweiterung der Agentenanzahl
- Keine Änderung an der `verify`-Konfiguration in `setup.json`
- Keine Änderung der grundlegenden Permission-Architektur
- Kein Commit, Push oder Veröffentlichung ohne ausdrücklichen Auftrag

## Bekannte Einschränkungen

- Runtime-/Manifest-Versionsdrift ist dokumentiert, siehe `docs/runtime-matrix.md`
- Die verschachtelte Fake-LSP-Umgebung erzeugt in der Sandbox umgebungsbedingte Testfehler
- `xhigh` 100000 liegt über dem registrierten 64K-Ausgaberahmen des Standardmodells
- Wiederholt scheiternde Edits und Endlosschleifen werden nicht mehr erkannt: Doom-Loop- und Edit-Fallback-Module sind ersatzlos entfernt (siehe Schutzrückbau V-1)

## Offene Risiken

- Runtime-/Dev-Versionsabweichung kann interne API-Tests vom produktiven Verhalten abweichen lassen
- Session- und Subagenten-Artefakte wachsen weiter; Aufbewahrung periodisch prüfen
- LSP-Diagnosen müssen fehlende Server oder nicht unterstützte Dateien verständlich behandeln

## Offene Fragen

- Angleichung von Pi-Runtime und Dev-Pin wartet auf ausdrückliche Freigabe für die Abhängigkeitsänderung

## Schutzrückbau (protokollpflichtig)

Entfernungen von Schutzmechanismen, jeweils mit benanntem Ersatz oder
ausdrücklich ohne.

### V-1 — Doom-Loop- und Edit-Fallback-Erkennung, ersatzlos

- **Grund:** Ausdrückliche Nutzerentscheidung. Beide Module waren seit `4c7a201`
  von keiner Extension mehr geladen; die Schutzwirkung war vor der Entfernung
  bereits wirkungslos.
- **Risiko:** Wiederholt scheiternde Edits und Endlosschleifen werden nicht
  erkannt. **Kein Ersatz** — bewusst in Kauf genommen.
- **Unberührt:** Diff, Scope, Typecheck, Tests, LSP, unabhängiger Reviewer.

### V-2 — `recovery-check.ts` entfernt

- **Grund:** Von keiner Extension importiert und damit wirkungslos; es las zudem
  den v2-Sidecar, während v3 in dieselbe Datei schreibt.
- **Ersatz:** `plan-mode` meldet beim `session_start` eine unterbrochene
  Ausführung (`status === "working"`) und verweist auf `/work`, das eine
  ausdrückliche Bestätigung verlangt. Keine automatische Fortsetzung.

### V-3 — Abgehängte UI-Module entfernt

- **Grund:** `plan-menu.ts`, `post-plan-card.ts`, `workflow-presentation.ts`,
  `workflow-hooks.ts`, `workflow-commands.ts`, `workflow-settlement.ts`,
  `ledger-checkpoint.ts`, `plan-mode/state.ts` sowie später `git-header.ts`,
  `activity-status.ts`, `thinking-view.ts`, `thinking-view-config.ts` und
  `context-menu.ts` hatten null Importe.
- **Risiko:** Post-Plan-Karte und zustandsabhängiges Plan-Menü sind endgültig weg.
- **Ersatz:** Shift+Tab (Workflow-Wechsel) und Super+Q (vollständiges Control
  Center) aus einer gemeinsamen Definition, siehe [007](decisions/007-aurora-single-ui-owner.md).

### V-4 — Zweites Verifikations-Gate entfernt

- **Grund:** `setup-core/verification-gate.ts` besaß eine eigene Aggregation,
  Typfamilie, Git-Parsing und Abschlussempfehlung neben der verbindlichen
  Completion-Pipeline.
- **Ersatz:** `/verify-gate` nutzt dieselben Prüffunktionen und dieselbe
  Klassifikation als reine Diagnose, siehe
  [006](decisions/006-single-completion-pipeline.md).

## Wichtige Projektregeln

- Commits, Pushes und Branch-Veröffentlichungen nur auf ausdrücklichen Auftrag
- Änderungen auf den konkreten Auftrag begrenzen; nicht zum Auftrag gehörende Nutzeränderungen erhalten
- Secrets, Zugangsdaten, Auth-Dateien und Umgebungsvariablen weder offenlegen noch committen
- Änderungen mit Tests und statischen Prüfungen verifizieren; Fehler ausdrücklich nennen
- Testzahlen nur nennen, wenn der Lauf tatsächlich stattfand

## Verworfene Optionen

- Externe Memory-/Smart-Compaction-/Context-Extension — kein Nutzen, der Komplexität und Überschneidung rechtfertigt
- Externe Full-UI-Pakete (Pi Droid, Vera) — verletzen die Presentation-only-/Trust-Grenze
- Ctrl+Shift+X als Alias oder Übergangslösung
- Dynamisches Thinking pro Anfrage
- Vollständiger Diagnose-Browser
- Eigenbau `extensions/skill-mode` — Pi nutzt native Skills unter `skills/<name>/SKILL.md`
