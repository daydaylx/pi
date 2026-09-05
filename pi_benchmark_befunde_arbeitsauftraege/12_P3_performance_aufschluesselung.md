# P3 – Performance-Aufschlüsselung

## Befund

Run #002:
- Pi ca. 30 Minuten
- Codex ca. 9 Minuten

Ohne Phasenaufschlüsselung ist unklar, ob die Differenz hauptsächlich durch
LLM-Latenz, Tools, Setup, Verifikation, Fehler-Recovery oder Subagenten entsteht.

Quelle: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign/run.log

## Arbeitsauftrag

Erfasse grobe, direkte Zeitanteile ohne komplexes Profiling-System.

### Sinnvolle Buckets

- setup/preflight
- LLM waiting
- tools
- verification
- subagents
- recovery nach Fehler
- final response

Nur erfassen, wenn Start/Ende zuverlässig vorhanden sind.

### Ergebnis

Für jeden Real-Duel-Lauf z. B.:

| Phase | Zeit | Anteil |
|---|---:|---:|
| Setup | ... | ... |
| LLM | ... | ... |
| Tools | ... | ... |
| Verify | ... | ... |
| Subagents | ... | ... |

### Abschlusskriterium

Die nächste Performanceentscheidung kann auf Messwerten beruhen und muss nicht
aus der Gesamt-Wall-Time geraten werden.
