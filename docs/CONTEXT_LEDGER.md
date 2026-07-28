# Context Ledger — agent

<!-- Dauerhaftes Projektgedächtnis. Nur bestätigte, dauerhaft relevante
     Fakten. Keine Logs, Chats, Secrets, Rohdaten. Flüchtiger
     Arbeitszustand gehört in docs/PROJECT_STATE.md. -->

## Bestätigte Nutzerentscheidungen

- Aurora Night mit kontextueller Bewegung; reduced und off bleiben über setup.json verfügbar
- Berechtigungsmodell: `readonly`, `project-write`, `confirm-all`, temporäres `yolo`; Work startet mit `project-write`, beide Planvarianten mit `readonly`
- Frischer Subagenten-Kontext, maximale Parallelität drei
- Modellwahl und Cycling folgen Pi-native `/scoped-models` und `settings.enabledModels`
- Alte UI-/Renderer-Dateien bleiben inaktiv erhalten (Rückbau ohne Datenverlust)
- Entscheidung: Shift+Tab öffnet das zentrale Control Center mit hierarchischen Bereichen.
- Entscheidung: Die vier vorhandenen Workflow-Modi stehen im Control Center an erster Stelle und bleiben direkt erreichbar.
- Entscheidung: Ctrl+Shift+X wird entfernt.
- Entscheidung: Das Modell-Untermenü zeigt Registry-Modelle und Pi-native Scoped Models; die Auswahl wechselt sofort zum gewählten Modell.
- Entscheidung: Thinking zeigt sichtbar „Auto“ oder „Manuell“.
- Entscheidung: Diagnose zeigt Status und erlaubt eine Datei-Prüfung über eine kurze Dateiauswahl.
- Entscheidung: Plan & Workflow umfasst Moduswahl sowie den Einstieg in Decision Intake.
- Entscheidung: Das Modell-Untermenü bietet nur Fast, Primary und Deep; die Rollen wechseln sofort zum konfigurierten Modell.

## Architekturentscheidungen

- setup.json ist die zentrale, validierte Konfiguration für UI, Permissions, LSP, Subagenten und Verifikation
- `permissions.workflowDefaults` ist die deklarative Zuordnung von Workflow zu Normalstufe; vertrauenswürdige Projekte dürfen sie nur weiter einschränken
- Plan-Workflow nutzt PlanSnapshot und Sidecar v3 mit stabiler planId, Planrevision, Plan-Hash, stabilen Step-IDs und CAS; keine Lease und kein Heartbeat
- Pi Core bleibt alleiniger Compaction-Eigentümer; keine zweite Compaction
- Context Ledger (docs/CONTEXT_LEDGER.md) ist das dauerhafte Projektgedächtnis, getrennt vom flüchtigen docs/PROJECT_STATE.md
- Ledger bleibt manuell nutzbar; plan-mode löst keine automatischen Checkpoints mehr aus
- Lokale Kernrollen sind Planner, Worker und Reviewer; Paket-Builtins sind deaktiviert, ein Researcher ist ohne Web-Toolchain nicht installiert
- `plan-mode/index.ts` enthält ausschließlich Registrierung und Event-Verdrahtung (Umbauvertrag §13.3/§13.12); der Sitzungszustand liegt explizit in `session.ts` (`WorkflowSession`) statt in Closure-Variablen, die Handler bei ihrer Fachlichkeit. `completion/` bleibt die reine Pipeline, `completion-commands.ts` orchestriert /finish und /task-done
- Workflow-Persistenz liegt in `plan-mode/store/` mit getrennten Modulen (paths, atomic-files, types, locks, workflow-state, archive, migration, direct-task) und `store/index.ts` als Barrel; `assertSafePath` bleibt die einzige Quelle für Pfad- und Symlink-Regeln
- Es gibt genau einen kanonischen Workflow-Status: `WorkflowStatus` in `plan-mode/store/types.ts` (`idle`, `planning`, `working`, `reviewing`, `paused`, `blocked`, `done`). `WorkflowPhase` und `WorkflowLifecycle` sind entfernt; Legacy-Werte erscheinen nur noch in `legacyStatus()` der v1/v2-Migration. `WorkflowMode` beschreibt ausschließlich die Planart, keinen zweiten Lebenszyklus
- Eine unterbrochene Ausführung meldet plan-mode beim Sitzungsstart und verweist auf `/work`; ein separates Recovery-Modul mit eigenem Dialog wird bewusst nicht geführt (Auftrag: keine zusätzliche komplexe Recovery-Logik)
- Doom-Loop- und Edit-Fallback-Erkennung sind ersatzlos entfernt: ihre Module waren von keiner Extension mehr geladen. Die Schutzwirkung entfällt bewusst zugunsten geringerer Komplexität
- Die früheren `PI_CONTEXT_*.md` im Wurzelverzeichnis sind entfernt; `docs/CONTEXT_LEDGER.md` und `docs/PROJECT_STATE.md` sind die einzigen laufend gepflegten Kontextdokumente. Ältere Einträge unten verweisen noch auf die entfernten Dateien und sind rein historisch zu lesen

## Nicht-Ziele

- Keine externe Memory-Extension nur zum Speichern von mehr Daten
- Keine Vergrößerung des Kontextfensters als Lösung
- Kein Eingriff in Pi-Core-Compaction oder deren Werte ohne Verlustbeleg
- Kein Commit, Push oder Veröffentlichung ohne ausdrücklichen Auftrag
- Keine permanente UI-Chrome oder Sidebar.
- Keine langen Modelllisten im Alltagsmenü.
- Kein vollständiger Diagnose-Browser.
- Keine neue Ablaufzentrale für Plan/Work/Review.
- Keine inhaltliche Überarbeitung, Neufassung oder Zusammenfassung der Aufträge/Berichte.
- Keine Verschmelzung mit bestehender Doku.
- Keine Lösung der inhaltlichen Widersprüche (Benchmark-Umfang 3 vs. ≥10; hartcodierte Daten) – nur Hinweis.
- Keine Berührung der legacy-Pläne unter `docs/plans/` und `docs/skills/` (fremde Dateien,.Scope-Grenze).
- Keine Berührung der 24 anderen uncommittierten Änderungen auf `main`.
- Keine Commits/Pushes (nur auf ausdrücklichen Auftrag).
- Kein Eintrag in `PI_CONTEXT_CHANGELOG.md` (audit-spezifisches Änderungsprotokoll, thematisch falsch).
- Keine vollständige Neuentwicklung der Subagent-Extension.
- Kein Austausch von `pi-subagents`.
- Keine Änderungen am gepinnten Drittanbieter-Fork.
- Keine neuen Abhängigkeiten.
- Keine Erweiterung der Agentenanzahl.
- Keine allgemeinen Refactorings außerhalb der Subagenten-, Dokumentations- und Konfigurationsbereiche.
- Keine automatische Veröffentlichung, kein Commit und kein Push.
- Keine Änderungen an der `verify`-Konfiguration in `setup.json`.
- Keine Änderung des Ergebnisvertrag-Schemas (Abschnittsüberschriften bleiben stabil).
- Keine Änderung der grundlegenden Permission-Architektur.

## Bekannte Einschränkungen

- Aktive Pi CLI ist 0.80.7, Manifest und lokales Dev-Paket sind 0.80.6 (dokumentierte Drift)
- Die verschachtelte Fake-LSP-Umgebung erzeugt in der Sandbox umgebungsbedingte Testfehler
- xhigh 100000 liegt über dem registrierten 64K-Ausgaberahmen des Standardmodells

## Offene Risiken

- Runtime-/Dev-Versionsabweichung kann interne API-Tests vom produktiven Verhalten abweichen lassen
- Session- und Subagenten-Artefakte wachsen weiter; Aufbewahrung periodisch prüfen (kein Modellmemory)
- Modellrollen sind konfiguriert, benötigen aber eine zuverlässige Anbindung an Pis Modellwechsel.
- „Auto Thinking“ benötigt gespeicherten Modus zwischen automatischer und manueller Wahl.
- Menüs müssen temporäre Overlays bleiben; permanente UI gehört Zentui.
- Ctrl+Shift+X-Entfernung verändert bestehende Muskelgedächtnisse.
- LSP-Diagnosen müssen fehlende Server oder nicht unterstützte Dateien verständlich behandeln.
- **Ort aktiver Aufträge:** `docs/plans/` enthält de facto nur legacy/abgelöste Pläne → eigener Ordner `docs/auftraege/` (Nutzerentscheidung). `docs/plans/` und `docs/skills/` bleiben unangetastet (Scope-Grenze, Schutzregel für fremde Dateien).
- **Naming:** `docs/` ist gemischt (UPPER_SNAKE wie `PROJECT_STATE.md`, lowercase-kebab wie `subagents.md`, `uebersetzungsbericht.md`). Entscheidung: **lowercase ohne Umlaute**, begründet durch Konsistenz mit dem deutschen `docs/uebersetzungsbericht.md` und `docs/subagents.md` (nicht durch `PI_CONTEXT_*`, da der Empfehlungsbericht kein Kontext-Audit-Bericht ist und das `PI_CONTEXT_`-Präfix inhaltlich nicht passt). Sprechende Alternativen (z.B. `benchmark-auftrag.md`) möglich, nicht erzwungen.
- **Kein CHANGELOG-Eintrag:** `PI_CONTEXT_CHANGELOG.md` ist das „dateiweise Änderungs- und Rückbauprotokoll des Context-Audits" – audit-spezifisch. Ein Doku-Neuzugang gehört dort nicht hin. Erwähnung stattdessen via `docs/PROJECT_STATE.md` (Status) + `PI_CONTEXT_AUDIT.md` (Inventar).
- **Widerspruch Benchmark-Umfang:** `Auftrag.md` fordert 3 Pilotfälle, `Arbeitsauftraege.md` A1 fordert „mindestens 10". Entscheidung: in `docs/auftraege/auftrag.md` als „Beziehungs"-Notiz dokumentieren (Pilot ⊂ Vollversion), **nicht** harmonisieren. Als offener Punkt markieren, damit der Eigentümer später entscheiden kann.
- **Hartcodierte Daten** (`Empfehlungsbericht` Stand 20.07.2026, `Auftrag` runId `2026-07-20-001`): belassen; als Verfallsrisiko in der Beziehungs-Notiz erwähnt.
- **git mv vs. cp+rm:** `git mv` → Rename-Erkennung, History erhalten. Verwenden.
- **Verify-Baseline unbekannt:** `npm run verify` wurde in dieser Session nie ausgeführt. Vorab Baseline erfassen, um „neue Fehler" beurteilen zu können.
- **Querverweis-Format:** als Verweiszeile direkt unter der Titel-Überschrift, konsistent mit dem Format des jeweiligen Quelldokuments (Rollenprompt-Struktur von `Auftrag.md` beachten).

## Offene Fragen

- Angleichung von Runtime 0.80.7 und Dev-Pin 0.80.6 wartet auf ausdrückliche Freigabe für die Abhängigkeitsänderung
- Keine umsetzungsblockierenden Fragen.

## Vertragsabweichungen (Umbauvertrag §13.14)

> Der Umbauvertrag verlangt, jede Abweichung **vor** der Umsetzung zu
> dokumentieren. Die folgenden Einträge wurden **nachgezogen**: die Änderungen
> waren zum Zeitpunkt der Protokollierung bereits umgesetzt. Das ist selbst
> eine Abweichung von §13.14 und hier ausdrücklich als solche vermerkt.

### V-1 — Doom-Loop- und Edit-Fallback-Erkennung ersatzlos entfernt

- **Vertragsregel:** §13.14 („Entfernung eines Schutzmechanismus ohne benannten
  Ersatz" ist unzulässig). §8 führt beide unter „Entfernen oder nur im
  Debug-Modus behalten", was die Entfernung deckt, den Ersatzanspruch aus
  §13.14 aber nicht aufhebt.
- **Grund:** Ausdrückliche Nutzerentscheidung. Beide Module waren seit `4c7a201`
  von keiner Extension mehr geladen (`setup-core/index.ts` importierte sie
  nicht); `mode-permissions.ts` fragte die zugehörigen Capability-Busse nicht
  mehr ab. Die Schutzwirkung war damit bereits vor der Entfernung wirkungslos.
- **Betroffene Module:** `setup-core/doom-loop.ts`, `setup-core/edit-fallback.ts`,
  `setup-core/edit-metrics.ts`, `shared/doom-loop-capabilities.ts`,
  `shared/edit-fallback-capabilities.ts` (~700 Zeilen) und ihre Testsektionen.
- **Risiko:** Wiederholt scheiternde Edits und Endlosschleifen werden nicht mehr
  erkannt. **Kein Ersatz vorhanden** — bewusst in Kauf genommen.
- **Schutzmaßnahme:** Keine. Die verbleibenden Qualitätsprüfungen (Diff, Scope,
  Typecheck, Tests, LSP, unabhängiger Reviewer) aus §13.2 sind unberührt.
- **Zusätzliche Verifikation:** Volle Suite, Typecheck, Coverage-Gate, Runtime-
  Reload und Installer-Dry-Run nach der Entfernung grün.
- **Entscheidung:** dauerhaft.

### V-2 — `recovery-check.ts` entfernt

- **Vertragsregel:** §13.1 Rang 4 („Einfache Wiederaufnahme nach Pause, Absturz
  oder Neustart"), §11 Abschlusskriterium „Abgebrochene Aufgaben lassen sich
  einfach wieder aufnehmen".
- **Grund:** Das Modul war von keiner Extension importiert und damit wirkungslos.
  Es las zudem den v2-Sidecar, während v3 in dieselbe Datei schreibt, sodass es
  auch bei Anbindung nie eine unterbrochene Arbeit erkannt hätte. §8 verlangt für
  Recovery ausdrücklich „keine zusätzliche komplexe Recovery-Logik".
- **Betroffene Module:** `setup-core/recovery-check.ts` (290 Zeilen), die
  zugehörigen Testsektionen und `store.discardWorkflowStateOnly()`.
- **Risiko:** Der interaktive Dialog mit Diff-Ansicht und Re-Verifikation entfällt.
- **Benannter Ersatz:** `plan-mode/index.ts` meldet beim `session_start` eine
  unterbrochene Ausführung (`status === "working"`) und verweist auf `/work`;
  `/work` verlangt eine ausdrückliche Bestätigung. Die Invariante aus §13.6
  („Recovery darf keine nicht bestätigte oder fremde Ausführung automatisch
  fortsetzen") bleibt damit erfüllt.
- **Entscheidung:** dauerhaft.

### V-3 — Abgehängte UI-Module entfernt

- **Vertragsregel:** §13.2 („Aurora UI und die festgelegten Shortcuts behalten
  ihre Grundfunktion").
- **Grund:** `plan-menu.ts`, `post-plan-card.ts`, `workflow-presentation.ts`,
  `workflow-hooks.ts`, `workflow-commands.ts`, `workflow-settlement.ts`,
  `ledger-checkpoint.ts` und `plan-mode/state.ts` hatten null Importe. Der
  UX-Verlust war bereits mit `4c7a201` eingetreten, nicht durch die Entfernung.
- **Risiko:** Die Post-Plan-Karte und das zustandsabhängige Plan-Menü sind
  endgültig weg.
- **Benannter Ersatz:** Das Shift+Tab-Control-Center in `plan-mode/index.ts`
  deckt Schnellplan, Architekturplan, Arbeit, Berechtigungen, Modelle, Thinking
  und LSP ab. Bei der Gelegenheit wurde die verletzte Garantie repariert:
  `Super+M` war von keiner Extension registriert und `openModels` hatte keinen
  Listener — beides wiederhergestellt.
- **Entscheidung:** dauerhaft.

## Wichtige Projektregeln

- Commits, Pushes und Branch-Veröffentlichungen nur auf ausdrücklichen Auftrag
- Änderungen auf den konkreten Auftrag begrenzen; nicht zum Auftrag gehörende Nutzeränderungen erhalten
- Secrets, Zugangsdaten, Auth-Dateien und Umgebungsvariablen weder offenlegen noch committen
- Änderungen mit Tests und statischen Prüfungen verifizieren; Fehler ausdrücklich nennen

## Aktuelle Prioritäten

- T1: agents/architect.md löschen
- T2: agents/security-auditor.md löschen
- T3: agents/ui-reviewer.md löschen
- T4: agents/docs-auditor.md löschen
- T5: agents/planner.md — Frontmatter-Description und Prompt um vollständige Ar...

## Verworfene Optionen

- Externe Memory-/Smart-Compaction-/Context-Extension — kein verbleibender Nutzen, der Komplexität und Überschneidung rechtfertigt
- Externe Full-UI-Pakete (Pi Droid, Vera) — verletzen die Presentation-only-/Trust-Grenze
- Option: Kompakte Gesamtliste ohne Untermenüs.
- Option: Dashboard mit Schnellaktionen und Bereich „Weitere Einstellungen“.
- Option: Ctrl+Shift+X als Alias oder Übergangslösung.
- Option: Modellrollen mit integrierten langen Modelllisten.
- Option: Dynamisches Thinking pro Anfrage.
- Option: Vollständiger Diagnose-Browser.

<!-- CONTEXT-LEDGER-META: {"schemaVersion":1,"lastCheckpoint":"2026-07-26T07:52:26.834Z","lastTrigger":"session-shutdown","briefHash":"5d5f5bce0d3bceb08e04da73ba0fad2ebfb1a9049354f8c7a8b2ed3097cfc74f","planHash":"3188be1f0327d64821243ea7a0ac15517cd624f764171911d7b229fcd1a8645a"} -->
