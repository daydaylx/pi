---
name: agent-docs
description: "Prüfe oder plane Agent-Dokumentation wie AGENTS.md, CLAUDE.md, GEMINI.md und zugehörige Projektregeln. Verwende diesen Skill, um Aktualität, Widersprüche und eine sinnvolle Zielstruktur zu bewerten."
---

# Agent-Dokumente einrichten oder prüfen

Beginne mit einer Read-only-Prüfung der vorhandenen Agent-Dokumentation. Respektiere die geltende `AGENTS.md` und die aktive Permission-Policy.

- Finde relevante Anweisungen und Dokumentationen, etwa `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, projektspezifische Dateien unter `.codex`, `.claude` oder `.pi` sowie Workflow- und Verifikationsdokumente.
- Bewerte Zweck, Aktualität, Redundanz und Widersprüche jeder Datei.
- Prüfe Zahlen, Messwerte und Vergleichstabellen vor der Bewertung „veraltet“ mit `git log -S`/`git blame` auf Herkunft und Datum. Ein datierter Snapshot ist nicht veraltet; empfiehl dafür eine Kennzeichnung mit Stand statt Fortschreibung.
- Schlage eine schlanke Zielstruktur vor und kennzeichne Archiv-Kandidaten statt sie eigenständig zu entfernen.
- Prüfe Zahlen, Messwerte und Vergleichstabellen vor der Bewertung „veraltet“ mit `git log -S` oder `git blame` auf Herkunft und Datum. Ein datierter Snapshot ist nicht veraltet; empfehle dafür eine Kennzeichnung mit Stand statt Fortschreibung.
- Schlage eine schlanke Zielstruktur vor und kennzeichne Archiv-Kandidaten statt sie eigenständig zu entfernen.
- Nenne bei gleichwertigen Korrekturvarianten im Abschnitt „Konkrete nächste Schritte“ die Optionen (aktualisieren, kennzeichnen, löschen oder behalten) samt Empfehlung; die Wahl trifft der Nutzer.
- Schreibe, verschiebe oder lösche keine Dokumente ohne ausdrücklichen Nutzerauftrag.

Strukturiere das Ergebnis mit:

# Agent-Dokumente Prüfung

## Gefundene Dokumente

## Wichtige Inhalte

## Widersprüche

## Veraltete oder doppelte Dokumente

## Fehlende Dokumente

## Empfohlene Zielstruktur

## Konkrete nächste Schritte

## Änderungen mit Freigabepflicht
