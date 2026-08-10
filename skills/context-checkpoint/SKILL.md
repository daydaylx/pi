---
name: context-checkpoint
description: Erstellt oder aktualisiert einen kompakten, persistenten Projekt-Arbeitsstand-Checkpoint und kuratiert den dauerhaften Context Ledger. Nutze dies nach einer Analyse, vor einer längeren Umsetzung, nach einer abgeschlossenen Phase, vor einem Modellwechsel, vor manueller Kompaktierung oder vor dem Wechsel in eine neue Sitzung.
---

# Context Checkpoint

Erstellt einen verifizierten Schnappschuss der aktuellen Arbeit, ohne die
Unterhaltung zu kopieren. Trennt bewusst zwei Ebenen:

- **Flüchtiger Arbeitszustand** → `docs/PROJECT_STATE.md` (aktuelle Phase,
  letzte Verifikation, nächste Schritte).
- **Dauerhaftes Projektgedächtnis** → `docs/CONTEXT_LEDGER.md` (bestätigte
  Entscheidungen, Architekturentscheidungen, Nicht-Ziele, Einschränkungen,
  offene Risiken/Fragen, Projektregeln, aktuelle Prioritäten).

Der Ledger wird **ausschließlich hier** gepflegt. Es gibt keine automatische
Konsolidierung: die Laufzeit besitzt keinen Ledger-Code und löst weder bei
Plan→Work noch bei Completion, Token-Schwelle oder Sessionende einen Checkpoint
aus. Beide Dateien sind gewöhnliche Markdown-Dokumente, die dieser Skill liest,
umformuliert, verdichtet und schreibt.

## Ablauf

1. Ermittle das Projekt-Root über Git, falls verfügbar; andernfalls das aktuelle
   Arbeitsverzeichnis nutzen.
2. Lies `docs/PROJECT_STATE.md` und `docs/CONTEXT_LEDGER.md` nur bei Fortsetzung
   einer bestehenden Aufgabe. Prüfe jede beibehaltene Aussage gegen den aktuellen
   Auftrag, den Repository-Zustand und durchgeführte Prüfungen. Konkret: führe
   `git log --oneline -1 -- docs/PROJECT_STATE.md` und dasselbe für
   `docs/CONTEXT_LEDGER.md` aus, dann `git log --oneline <letzter-Touch-Commit>..HEAD`
   für jede Datei. Prüfe jeden gefundenen Commit gegen die Bereiche, die die
   jeweilige Datei beschreibt (Dateipfade/Module im Diff vs. im Dokument
   genannte Komponenten), und kennzeichne widersprechende oder überholte
   Aussagen ausdrücklich, statt sie stillschweigend beizubehalten.
3. Ordne die gesammelten Informationen der richtigen Ebene zu:
   - **Ledger (dauerhaft):** bestätigte Nutzerentscheidungen, Architektur­ent­schei­dungen,
     Nicht-Ziele, bekannte Einschränkungen, offene Risiken, offene Fragen,
     wichtige Projektregeln, aktuelle Prioritäten, verworfene Optionen mit Grund.
   - **PROJECT_STATE (flüchtig):** aktuelle Phase, umgesetzte Punkte dieser
     Sitzung, gelesene/geänderte Dateien, letzte Verifikation, genau drei
     nächste Schritte.
4. Aktualisiere die Dateien nur, wenn der aktive Berechtigungsmodus
   Dokumentationsschreibzugriffe erlaubt. Andernfalls den Checkpoint in der
   Antwort zurückgeben, ohne zu schreiben.
5. Halte den Ledger unter 200 Zeilen und diese Abschnitte ein:
   `Bestätigte Nutzerentscheidungen`, `Architekturentscheidungen`, `Nicht-Ziele`,
   `Bekannte Einschränkungen`, `Offene Risiken`, `Offene Fragen`,
   `Wichtige Projektregeln`, `Aktuelle Prioritäten`, `Verworfene Optionen`.
6. Halte `docs/PROJECT_STATE.md` unter 250 Zeilen und dupliziere keine
   dauerhaften Fakten, die bereits im Ledger stehen — dort referenzieren.

## Wann ein Checkpoint fällig ist

Diese Ablaufregeln greifen nur in längeren oder gestörten Sitzungen und stehen
deshalb hier statt in `AGENTS.md`:

- Bei langen zusammenhängenden Aufgaben vor Compaction, Modellwechsel oder
  Sessionwechsel einen kompakten Checkpoint erstellen.
- Vor umfangreicher Log-Recherche oder einem großen Kontextwechsel den
  Checkpoint **vorher** erstellen, statt den vollständigen Verlauf erneut in
  den Kontext zu laden.
- Nach zwei aufeinanderfolgenden Provider- oder Transportfehlern keinen großen
  Kontext erneut aufbauen: Checkpoint erstellen und in einer frischen Session
  fortsetzen. Die frische Session startet aus `docs/PROJECT_STATE.md` und
  `docs/CONTEXT_LEDGER.md`, nicht aus dem alten Verlauf.
- Bei Wechsel des Hauptziels oder Projekts eine neue Session verwenden.
- Sitzungs-JSONLs nur nach Zeitfenster, Eventtyp oder konkretem Suchbegriff
  auswerten und die Ausgabe auf den notwendigen Ausschnitt (in der Regel
  höchstens 100 Zeilen) begrenzen. Vollständige Sitzungslogs nicht in den
  Kontext laden.
- `/fork` für Alternativen, `/clone` für eine separate Zweigkopie, `/tree` für
  Navigation innerhalb einer Session und `/compact` für lange, weiterhin
  zusammenhängende Aufgaben verwenden.

## Leitplanken

- Speichere keine vollständigen Tool-Ausgaben, Logs, Chat-Auszüge, Secrets,
  Zugangsdaten, Umgebungswerte oder privaten Sitzungsinhalt.
- Behalte veraltete Entscheidungen nicht ohne Prüfung bei; verschiebe überholte,
  aber noch erklärende Optionen unter `Verworfene Optionen`.
- Kennzeichne fehlende oder unsichere Informationen ausdrücklich; erfinde sie
  niemals.
- Ändere keinen Code oder Konfiguration im Rahmen des Checkpoints.
- Starte keine Kompaktierung automatisch. Melde sichtbar, dass der Checkpoint
  bereit ist, bevor `/compact` vorgeschlagen wird.
