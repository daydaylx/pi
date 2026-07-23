# Context Ledger — pi

<!-- Dauerhaftes Projektgedächtnis. Nur bestätigte, dauerhaft relevante
     Fakten. Keine Logs, Chats, Secrets, Rohdaten. Flüchtiger
     Arbeitszustand gehört in docs/PROJECT_STATE.md. -->

## Bestätigte Nutzerentscheidungen
- Aurora Night mit kontextueller Bewegung; reduced und off bleiben über setup.json verfügbar
- read-write als Startstufe; unbekannte Tools bleiben in Full und YOLO bestätigungspflichtig, in strengeren Stufen blockiert, in Setup gesperrt
- Frischer Subagenten-Kontext, maximale Parallelität vier
- Drei kuratierte OpenAI-Codex-Modellrollen: fast, primary, deep
- Alte UI-/Renderer-Dateien bleiben inaktiv erhalten (Rückbau ohne Datenverlust)

## Architekturentscheidungen
- setup.json ist die zentrale, validierte Konfiguration für UI, Permissions, LSP, Subagenten, Modellrollen und Verifikation
- Plan-Workflow nutzt Sidecar v2 mit stabiler planId, Revision, Lifecycle, Todo-Hash und gebundener executionId (Lock/CAS)
- Pi Core bleibt alleiniger Compaction-Eigentümer; keine zweite Compaction
- Context Ledger (docs/CONTEXT_LEDGER.md) ist das dauerhafte Projektgedächtnis, getrennt vom flüchtigen docs/PROJECT_STATE.md
- Automatische Ledger-Checkpoints laufen deterministisch ohne Modell-Turn in plan-mode

## Nicht-Ziele
- Keine externe Memory-Extension nur zum Speichern von mehr Daten
- Keine Vergrößerung des Kontextfensters als Lösung
- Kein Eingriff in Pi-Core-Compaction oder deren Werte ohne Verlustbeleg
- Kein Commit, Push oder Veröffentlichung ohne ausdrücklichen Auftrag

## Bekannte Einschränkungen
- Aktive Pi CLI ist 0.80.7, Manifest und lokales Dev-Paket sind 0.80.6 (dokumentierte Drift)
- Die verschachtelte Fake-LSP-Umgebung erzeugt in der Sandbox umgebungsbedingte Testfehler
- xhigh 100000 liegt über dem registrierten 64K-Ausgaberahmen des Standardmodells

## Offene Risiken
- Runtime-/Dev-Versionsabweichung kann interne API-Tests vom produktiven Verhalten abweichen lassen
- Session- und Subagenten-Artefakte wachsen weiter; Aufbewahrung periodisch prüfen (kein Modellmemory)

## Offene Fragen
- Angleichung von Runtime 0.80.7 und Dev-Pin 0.80.6 wartet auf ausdrückliche Freigabe für die Abhängigkeitsänderung

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

<!-- CONTEXT-LEDGER-META: {"schemaVersion":1,"lastCheckpoint":"2026-07-23T00:00:00.000Z","lastTrigger":"manual"} -->
