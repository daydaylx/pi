# P3 – Kontextwachstum messen

## Befund

Run #002 zeigt stark unterschiedliche Cache-Read-Mengen:
- Pi: 3.234.816
- Codex: 6.558.464

Die Endsumme allein erklärt nicht, ob ein Harness effizient oder unterinformiert ist.

## Arbeitsauftrag

Erweitere die Telemetrie so, dass Kontext-/Input-Wachstum pro Model Call sichtbar wird.

### Pro Call erfassen, sofern direkt messbar

- fresh input
- cache read
- cache write
- output
- optional aktiver Kontextumfang
- Phase (explore/edit/verify/final), falls zuverlässig ableitbar

### Auswertung

- Verlauf pro Call
- Sprünge
- Tooloutput als Wachstumstreiber
- System-/Harness-Anteil, sofern messbar
- Compaction-Ereignisse

### Nicht-Ziel

Keine Schätzung von Tokenanteilen, wenn Provider/Parser sie nicht hergeben.

### Abschlusskriterium

Ein Benchmarkreport kann zeigen, **wann** Kontext wächst und nicht nur die
kumulierte Endsumme.
