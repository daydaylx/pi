# Stufe-2 Base-SHA-Freeze

`STAGE2_BASE_SHA=<wird nach erfolgreichem Dual-Smoke eingetragen>`

Optionaler Git-Tag: `real-duel-stage2-base` (Befehl zur Referenz, hier nicht
automatisch ausgeführt):

```
git tag real-duel-stage2-base <STAGE2_BASE_SHA>
```

## Geltungsbereich des Freeze

Ab Festlegung des Base-SHA bis zum Ende der 36-Läufe-Serie werden **nicht**
geändert:

- Pi Instructions (`AGENTS.md`, `APPEND_SYSTEM.md`, `settings.json`)
- Permissions-/Tool-Policy (`extensions/permissions/`)
- Tool-Trace-Logik (`benchmarks/real-duel/scripts/tool_trace.py`)
- Verifier-Policy
- Plan-Quality-Bewertung (`extensions/plan-mode/plan-quality.ts`)
- Benchmark-Skripte (`benchmarks/real-duel/scripts/*`)
- Candidate-Konfiguration (`benchmarks/real-duel/candidates/*.toml`)
- Modell, Reasoning-Level
- Task-Checker (`benchmarks/real-duel/tasks/*/checker.sh`)

## Vorgehen bei einem echten P0-Benchmarkfehler während der Serie

1. Serie stoppen.
2. Problem beheben.
3. Neue Base-SHA erzeugen, dieses Dokument aktualisieren.
4. Bereits gelaufene Trials dieser Serie verwerfen bzw. klar als ungültig
   markieren (nicht mit Trials der neuen Serie vermischen — siehe
   `comparable-false-process.md` für das analoge Prinzip auf Zeilenebene).
5. Serie konsistent neu beginnen.

Trial 1 einer Serie wird nie mit Trial 3 einer anderen Harness-Version
verglichen.
