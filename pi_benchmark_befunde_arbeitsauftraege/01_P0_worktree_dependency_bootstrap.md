# P0 – Worktree-/Dependency-Bootstrap

## Befund

Pi scheiterte in Real-Duel #002 erneut zweimal an `project_check(verify)` mit Exit 127,
weil der frische Worktree keine installierten Dependencies enthielt. Der gleiche
Fehlertyp war bereits in Real-Duel #001 sichtbar.

Quelle: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign.md

## Risiko

- Verifikation kann trotz korrekter Implementierung ausfallen.
- Der Agent muss während der Aufgabe improvisieren.
- Tool-Error-Rate und Laufzeit steigen.
- Benchmarkdaten vermischen Harness-Setup-Fehler mit Modell-/Agentenqualität.
- Dasselbe Problem kann reale Benutzeraufgaben in neuen Worktrees treffen.

## Arbeitsauftrag

Analysiere und behebe den Dependency-/Worktree-Bootstrap von Pi.

### Analyse

1. Verfolge den vollständigen Pfad von `project_check(verify)`:
   - Aufrufer
   - Tool/Extension
   - Verify-Profile
   - ausgeführte Befehle
   - Working Directory
   - erwartete Dependencies

2. Prüfe für Root und Subprojekte:
   - `package.json`
   - `package-lock.json`
   - pnpm/yarn
   - Python/uv/poetry, sofern bereits unterstützt
   - Monorepos
   - `gui/package.json`

3. Kläre:
   - Wer ist für Bootstrap zuständig?
   - Muss ein neuer Worktree Dependencies selbst installieren?
   - Darf `project_check` bootstrapen oder muss vorher ein Prepare-Schritt laufen?
   - Wie werden teure Installationen vermieden, wenn ein Cache/shared store existiert?
   - Wie wird Offline-/fehlende Registry-Situation behandelt?

4. Prüfe, ob ein vorhandener Setup-/Preflight-Mechanismus erweitert werden kann.
   Kein paralleles zweites Dependency-System bauen.

### Umsetzung

Bevorzuge einen zentralen, idempotenten Prepare-/Dependency-Check:
- Dependency-Zustand erkennen.
- Package Manager deterministisch ableiten.
- nur bei Bedarf bootstrapen.
- klar zwischen `missing`, `install_failed`, `ready` unterscheiden.
- anschließend Verifikation normal ausführen.

Keine stillen Fallbacks, die einen Verify-Schritt überspringen.

### Tests

Mindestens:
- frischer Worktree ohne `node_modules`
- bereits vorbereiteter Worktree
- Root + `gui/`
- fehlerhafte Installation
- fehlendes Lockfile
- wiederholter Aufruf ist idempotent
- Verify läuft nach erfolgreichem Bootstrap

### Abschlusskriterien

- `project_check(verify)` scheitert in einem frischen Benchmark-Worktree nicht mehr
  allein wegen fehlender Dependencies.
- Bootstrap-Fehler werden separat und verständlich gemeldet.
- keine doppelte Setup-Architektur.
- bestehende Verify-Profile bleiben kompatibel.
