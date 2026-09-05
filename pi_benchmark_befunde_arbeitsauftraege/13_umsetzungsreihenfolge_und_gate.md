# Umsetzungsplan und Gate für Real-Duel #003

## Phase A – P0 beheben

- [ ] Worktree-/Dependency-Bootstrap
- [ ] Verifier-Contract
- [ ] Tool-Update-Bloat

### Gate A

Real-Duel #003 erst starten, wenn:
- frischer Worktree verifiziert werden kann
- Verifier-Aufruf keinen bekannten Schemafehler mehr erzeugt
- Transcript-Bloat analysiert und mindestens die Hauptursache behoben ist

## Phase B – P1 instrumentieren/verbessern

- [ ] Tool-Call-Sequenzanalyse
- [ ] Error-Klassifizierung
- [ ] kleiner Preflight

## Phase C – P2 nur auf Basis der Messdaten

- [ ] Exploration
- [ ] Planmodus
- [ ] Subagenten

Keine Prompt-/Workflow-Großänderung ohne nachweisbares Problem.

## Phase D – P3

- [ ] Telemetrie normalisieren
- [ ] Kontextwachstum
- [ ] Performancephasen

## Real-Duel #003

Benchmarkmethodik möglichst unverändert lassen, damit Vorher/Nachher-Aussagen
nicht durch einen gleichzeitigen Benchmarkumbau entwertet werden.

Für Run #003 zusätzlich dokumentieren:
- P0-Probleme erneut aufgetreten: ja/nein
- Tool Calls
- Tool Errors nach Kategorie
- Transcript-Größe
- Wall Time
- qualitative Bewertung
