---
name: security-audit
description: "Prüfe ein Projekt defensiv auf Dependency-Risiken, versehentlich eingecheckte Secrets, Berechtigungsprobleme sowie Netzwerk- und API-Schwachstellen. Verwende diesen Skill für ein sicheres, nicht-invasives Security-Review."
---

# Security / Dependency Audit

Führe eine defensive Prüfung nur innerhalb des vom Nutzer bereitgestellten Projekts aus. Respektiere `AGENTS.md`, die aktive Permission-Policy und den Schutz sensibler Daten.

- Prüfe Abhängigkeiten auf offensichtliche Aktualitäts- und Risikosignale, ohne neue Pakete zu installieren.
- Suche nach potentiellen Secrets, Tokens und privaten Schlüsseln, ohne ihre Werte auszugeben oder zu protokollieren.
- Bewerte Berechtigungen, Scope-Creep, Netzwerkzugriffe, API-Validierung und mögliche unsichere Endpunkte.
- Führe keine Exploits, Angriffe, externen Scans oder Änderungen ohne ausdrücklichen Nutzerauftrag aus.

Strukturiere das Ergebnis mit:

## Dependency-Risiken
## Secrets / Tokens
## Berechtigungen
## Netzwerk / API
## Kritische Findings
## Empfohlene Maßnahmen
