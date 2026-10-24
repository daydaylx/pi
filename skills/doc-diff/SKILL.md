---
name: doc-diff
description: "Vergleiche Projektdokumente auf Unterschiede, Widersprüche, Dopplungen, veraltete Verweise und fehlende Querverweise. Verwende diesen Skill für einen dokumentationsorientierten Read-only-Abgleich."
---

# Dokumenten-Diff prüfen

Vergleiche die vom Nutzer benannten oder für die Aufgabe relevanten Dokumente. Respektiere `AGENTS.md` und die aktive Permission-Policy.

- Nenne die Vergleichsbasis (Commit, Datum oder Dateistand). Hat der Nutzer keine genannt, nimm die letzten Commits der betroffenen Dateien (`git log`, `git diff`) und schreibe sie in den Abschnitt „Vergleich“. „Nicht feststellbar“ gilt nur, wenn keine Basis existiert.
- Stelle neue, entfernte und abweichende Aussagen nachvollziehbar gegenüber. Fülle „Neue“ und „Entfernte Inhalte“ aus dieser Basis aus; antworte nicht mit „nicht feststellbar“, wenn die Inhalte aus der Basis hervorgehen.
- Suche nach Widersprüchen, Doppelungen, veralteten Pfaden, Befehlen und Referenzen sowie fehlenden Querverweisen.
- Unterscheide gesicherte Befunde von Interpretationen und nenne Fundstellen.
- Führe keine automatische Zusammenführung, Löschung oder Textänderung aus. Lege Korrekturen nur als Vorschlag vor, bis eine ausdrückliche Freigabe besteht.

Strukturiere das Ergebnis mit:

## Vergleich

## Neue Inhalte

## Entfernte Inhalte

## Widersprüche

## Veraltete Inhalte

## Empfohlene Korrekturen

## Nicht automatisch entscheiden
