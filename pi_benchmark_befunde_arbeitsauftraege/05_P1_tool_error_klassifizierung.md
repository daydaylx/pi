# P1 – Tool-Error-Klassifizierung

## Befund

Run #002:
- Pi: 6 Tool Errors
- Codex: 2 Tool Errors

Mindestens ein Teil der Pi-Fehler war kein Modellfehler:
- fehlende Dependencies
- ungültiger Verifier-Parameter

Quelle: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign.md

## Arbeitsauftrag

Führe eine einfache, belastbare Fehlerklassifizierung für Tool-Aufrufe ein,
damit Harness-/Environment-Probleme nicht mit Agentenfehlern vermischt werden.

### Kategorien

Mindestens:
- `environment`
- `dependency`
- `permission`
- `contract/schema`
- `tool/runtime`
- `agent/input`
- `unknown`

Keine feingranulare Taxonomie ohne Nutzen.

### Anforderungen

- Originalfehler bleibt erhalten.
- Klassifizierung ergänzt, ersetzt ihn nicht.
- Telemetrie zählt Fehler je Kategorie.
- Recovery kann Kategorie berücksichtigen.
- keine heuristische Schönfärberei.

### Tests

Je Kategorie mindestens ein kontrollierter Fehlerfall.

### Abschlusskriterien

Benchmarkreports können unterscheiden:
`6 Tool Errors` → z. B. `2 dependency`, `1 contract`, `3 agent/runtime`.
