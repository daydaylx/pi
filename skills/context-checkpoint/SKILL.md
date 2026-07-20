---
name: context-checkpoint
description: Erstellt oder aktualisiert einen kompakten, persistenten Projekt-Arbeitsstand-Checkpoint. Nutze dies nach einer Analyse, vor einer längeren Umsetzung, nach einer abgeschlossenen Phase, vor einem Modellwechsel, vor manueller Kompaktierung oder vor dem Wechsel in eine neue Sitzung.
---

# Context Checkpoint

Erstellt einen verifizierten Schnappschuss der aktuellen Arbeit, ohne die Unterhaltung zu kopieren.

## Ablauf

1. Ermittle das Projekt-Root über Git, falls verfügbar; andernfalls das aktuelle Arbeitsverzeichnis nutzen.
2. Lies `docs/PROJECT_STATE.md` nur bei Fortsetzung einer bestehenden Aufgabe. Prüfe jede beibehaltene Aussage gegen den aktuellen Auftrag, den Repository-Zustand und durchgeführte Prüfungen.
3. Sammle nur:
   - aktuelles Ziel und Nicht-Ziele
   - aktive Einschränkungen
   - Entscheidungen und noch relevante verworfene Optionen mit Begründung
   - gelesene und geänderte Dateien
   - bekannte Fehler und fehlgeschlagene Tests
   - erfolgreiche Verifikation
   - offene Risiken
   - exakt drei konkrete nächste Schritte
4. Aktualisiere `docs/PROJECT_STATE.md` nur, wenn der aktive Berechtigungsmodus Dokumentationsschreibzugriffe erlaubt. Andernfalls den Checkpoint in der Antwort zurückgeben, ohne zu schreiben.
5. Behalte diese Top-Level-Abschnitte bei und halte die Datei unter 250 Zeilen:
   `Aktuelles Ziel`, `Aktuelle Phase`, `Erledigt`, `Offene Aufgaben`, `Aktive Entscheidungen`, `Geänderte Dateien`, `Bekannte Fehler`, `Letzte Verifikation`, `Risiken`, `Nächste drei Schritte`, `Letzte Aktualisierung`.
6. Nicht-Ziele und Einschränkungen unter `Aktuelles Ziel` einordnen; gewählte und verworfene Optionen unter `Aktive Entscheidungen`.

## Leitplanken

- Speichere keine vollständigen Tool-Ausgaben, Logs, Chat-Auszüge, Secrets, Zugangsdaten, Umgebungswerte oder privaten Sitzungsinhalt.
- Behalte veraltete Entscheidungen nicht ohne Prüfung bei.
- Kennzeichne fehlende oder unsichere Informationen ausdrücklich; erfinde sie niemals.
- Ändere keinen Code oder Konfiguration im Rahmen des Checkpoints.
- Starte keine Kompaktierung automatisch. Melde sichtbar, dass der Checkpoint bereit ist, bevor `/compact` vorgeschlagen wird.
