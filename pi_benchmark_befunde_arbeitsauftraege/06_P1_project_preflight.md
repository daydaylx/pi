# P1 – Projekt-Preflight

## Befund

Mehrere Fehler in den Real-Duel-Runs wären vor dem eigentlichen Arbeitslauf
billig erkennbar gewesen, insbesondere fehlende Dependencies und Toolchain-Zustand.

## Arbeitsauftrag

Prüfe, ob ein kleiner zentraler Preflight die häufigsten vermeidbaren
Infrastrukturfehler vor Aufgabenbeginn erkennen kann.

### Preflight soll nur vorhandene Voraussetzungen prüfen

Beispiele:
- Repo/Worktree erreichbar
- Working Tree Zustand
- Package Manager
- Dependencies vorhanden
- zentrale Test-/Verify-Kommandos auflösbar
- benötigte Runtime vorhanden
- Verifier-Tool verfügbar
- relevante Permission-Policy geladen

### Nicht-Ziel

Kein komplexer Projekt-Scanner und kein zweites Setup-Framework.

### Verhalten

- billige Checks
- strukturierte Ergebnisse
- reparierbare vs. blockierende Probleme unterscheiden
- reparierbare Probleme können an vorhandenen Bootstrap delegieren

### Abschlusskriterien

- Preflight ist schnell.
- verursacht keine doppelten Installationen.
- verhindert mindestens die bekannten Benchmark-Setupfehler oder meldet sie
  vor der eigentlichen Agentenarbeit eindeutig.
