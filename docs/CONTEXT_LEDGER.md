# Context Ledger — agent

<!-- Dauerhaftes Projektgedächtnis. Nur bestätigte, dauerhaft relevante
     Fakten. Keine Logs, Chats, Secrets, Rohdaten. Flüchtiger
     Arbeitszustand gehört in docs/PROJECT_STATE.md. -->

## Bestätigte Nutzerentscheidungen
- Aurora Night mit kontextueller Bewegung; reduced und off bleiben über setup.json verfügbar
- read-write als Startstufe; unbekannte Tools bleiben in Full und YOLO bestätigungspflichtig, in strengeren Stufen blockiert, in Setup gesperrt
- Frischer Subagenten-Kontext, maximale Parallelität drei
- Drei kuratierte OpenAI-Codex-Modellrollen: fast, primary, deep
- Alte UI-/Renderer-Dateien bleiben inaktiv erhalten (Rückbau ohne Datenverlust)
- Entscheidung: Shift+Tab öffnet das zentrale Control Center mit hierarchischen Bereichen.
- Entscheidung: Die vier vorhandenen Workflow-Modi stehen im Control Center an erster Stelle und bleiben direkt erreichbar.
- Entscheidung: Ctrl+Shift+X wird entfernt.
- Entscheidung: Das Modell-Untermenü bietet nur Fast, Primary und Deep; die Rollen wechseln sofort zum konfigurierten Modell.
- Entscheidung: Thinking zeigt sichtbar „Auto“ oder „Manuell“.
- Entscheidung: Diagnose zeigt Status und erlaubt eine Datei-Prüfung über eine kurze Dateiauswahl.
- Entscheidung: Plan & Workflow umfasst Moduswahl sowie den Einstieg in Decision Intake.

## Architekturentscheidungen
- setup.json ist die zentrale, validierte Konfiguration für UI, Permissions, LSP, Subagenten, Modellrollen und Verifikation
- Plan-Workflow nutzt Sidecar v2 mit stabiler planId, Revision, Lifecycle, Todo-Hash und gebundener executionId (Lock/CAS)
- Pi Core bleibt alleiniger Compaction-Eigentümer; keine zweite Compaction
- Context Ledger (docs/CONTEXT_LEDGER.md) ist das dauerhafte Projektgedächtnis, getrennt vom flüchtigen docs/PROJECT_STATE.md
- Automatische Ledger-Checkpoints laufen deterministisch ohne Modell-Turn in plan-mode
- Subagenten von 10 auf 6 konsolidiert: architect → planner; security-auditor, ui-reviewer, docs-auditor → reviewer (Fokus-System). Weniger Rollenüberschneidungen, klarere Delegationskriterien.

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
- Keine Änderung der grundlegenden Permission-Architektur.
- Keine Erweiterung der Agentenanzahl.
- Keine allgemeinen Refactorings außerhalb der Subagenten-, Dokumentations- und Konfigurationsbereiche.
- Keine automatische Veröffentlichung, kein Commit und kein Push.
- Keine Änderungen an der `verify`-Konfiguration in `setup.json`.
- Keine Änderung des Ergebnisvertrag-Schemas (Abschnittsüberschriften bleiben stabil).

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

## Wichtige Projektregeln
- Commits, Pushes und Branch-Veröffentlichungen nur auf ausdrücklichen Auftrag
- Änderungen auf den konkreten Auftrag begrenzen; nicht zum Auftrag gehörende Nutzeränderungen erhalten
- Secrets, Zugangsdaten, Auth-Dateien und Umgebungsvariablen weder offenlegen noch committen
- Änderungen mit Tests und statischen Prüfungen verifizieren; Fehler ausdrücklich nennen

## Aktuelle Prioritäten
- (keine Einträge)

## Verworfene Optionen
- Externe Memory-/Smart-Compaction-/Context-Extension — kein verbleibender Nutzen, der Komplexität und Überschneidung rechtfertigt
- Externe Full-UI-Pakete (Pi Droid, Vera) — verletzen die Presentation-only-/Trust-Grenze
- Option: Kompakte Gesamtliste ohne Untermenüs.
- Option: Dashboard mit Schnellaktionen und Bereich „Weitere Einstellungen“.
- Option: Ctrl+Shift+X als Alias oder Übergangslösung.
- Option: Modellrollen mit integrierten langen Modelllisten.
- Option: Dynamisches Thinking pro Anfrage.
- Option: Vollständiger Diagnose-Browser.

<!-- CONTEXT-LEDGER-META: {"schemaVersion":1,"lastCheckpoint":"2026-07-25T10:42:15.941Z","lastTrigger":"session-shutdown","briefHash":"5d5f5bce0d3bceb08e04da73ba0fad2ebfb1a9049354f8c7a8b2ed3097cfc74f","planHash":"3188be1f0327d64821243ea7a0ac15517cd624f764171911d7b229fcd1a8645a"} -->
