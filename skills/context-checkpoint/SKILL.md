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

Der Ledger wird zusätzlich **automatisch** und deterministisch (ohne Modell-Turn)
von `extensions/plan-mode` konsolidiert: bei Plan→Work, Plan-Abschluss, nach
einem Decision Brief, an der Token-Schwelle vor Compaction und beim Sessionende.
Dieser Skill ist die **manuelle, kuratierende** Ebene: er formuliert um,
verdichtet, entfernt Veraltetes und ergänzt Fakten, die die Automatik nicht aus
den strukturierten Artefakten ableiten kann.

## Ablauf

1. Ermittle das Projekt-Root über Git, falls verfügbar; andernfalls das aktuelle
   Arbeitsverzeichnis nutzen.
2. Lies `docs/PROJECT_STATE.md` und `docs/CONTEXT_LEDGER.md` nur bei Fortsetzung
   einer bestehenden Aufgabe. Prüfe jede beibehaltene Aussage gegen den aktuellen
   Auftrag, den Repository-Zustand und durchgeführte Prüfungen.
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
