---
name: prompt-compiler
description: "Verwandle eine grobe Aufgabe in einen präzisen, prüfbaren Arbeitsauftrag für einen Coding-Agenten. Verwende diesen Skill, wenn Ziel, Scope, Schutzregeln und Verifikation klar formuliert werden sollen."
---

# Prompt-Compiler

Erstelle aus der Nutzeranfrage einen vollständigen Prompt, ohne die Aufgabe selbst umzusetzen. Wenn Angaben fehlen, markiere sie als Annahmen oder Rückfragen statt sie als Fakten auszugeben.

Verwende diese Struktur:

- **Rolle:** passende fachliche Perspektive.
- **Ziel:** überprüfbares gewünschtes Ergebnis.
- **Nicht-Ziele:** ausdrücklich ausgeschlossene Eingriffe.
- **Kontext:** relevante Dateien, Architektur und Randbedingungen.
- **Vorgehen:** konkrete, sinnvolle Arbeitsschritte.
- **Änderungsregeln:** zulässiger Scope sowie Schutzregeln, insbesondere keine Commits, Pushes, Installationen oder destruktiven Aktionen ohne direkten Auftrag.
- **Verifikation:** relevante Tests und statische Checks.
- **Ausgabeformat:** erwartete Struktur der Antwort.
- **Abschlusskriterien:** Bedingungen für „fertig“.
- **Schwierigkeit:** Skala von 1–10 und angemessene Thinking-Tiefe.

Gib ausschließlich den fertigen, kopierbaren Arbeitsauftrag aus.
