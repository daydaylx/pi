# P3 – Telemetrie harnessübergreifend normalisieren

## Befund

Der Benchmark zeigt:
- Pi: 41 Turns
- Codex: 1 Turn

Der Report weist ausdrücklich darauf hin, dass diese Werte nicht dieselbe
Semantik haben.

Quelle: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign.md

## Arbeitsauftrag

Entferne oder entwerte keine Rohdaten, aber definiere vergleichbare Primärmetriken.

### Bevorzugte Primärmetriken

- LLM/API Calls
- Tool Calls
- Tool Errors
- Assistant Messages
- Subagent Calls
- Verification Calls
- Wall Time
- Fresh Input
- Cache Read
- Cache Write
- Output
- Reasoning, sofern verlässlich
- Kosten mit Provenienz

### Anforderungen

- harnessspezifische `turns` weiter als Rohfeld möglich
- im Vergleichsreport klar als nicht vergleichbar markieren
- jede Metrik mit Definition/Quelle
- keine Schätzung als Messwert ausgeben

### Abschlusskriterium

Ein Report kann Pi und Codex vergleichen, ohne semantisch unterschiedliche
`turn`-Zähler nebeneinander als scheinbar identische Kennzahl zu zeigen.
