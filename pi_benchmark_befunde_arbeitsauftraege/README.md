# Pi – Benchmark-Befunde und Arbeitsaufträge

Stand: 2026-09-05  
Basis: Real-Duel #002 `real-02-gui-ux-redesign`  
Commit: `e30c7f5335c290ec2871c8a2af186a4bb0096d98`

Quelle:
- https://github.com/daydaylx/pi/commit/e30c7f5335c290ec2871c8a2af186a4bb0096d98
- https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign.md

## Zweck

Diese Mappe trennt die im Benchmark beobachteten Probleme in einzelne, ausführbare Arbeitsaufträge.
Sie ist **kein Auftrag zum Umbau des Benchmarks**. Ziel ist zuerst, Pi als Harness technisch robuster,
effizienter und besser messbar zu machen und danach mit möglichst unveränderter Benchmarkmethodik
Real-Duel #003 durchzuführen.

## Reihenfolge

### P0 – zuerst
1. Worktree-/Dependency-Bootstrap
2. Verifier-Contract / ungültiges `timeoutMs`
3. `tool_execution_update`-Bloat

### P1 – direkt danach
4. Tool-Call-Effizienz
5. Tool-Error-Klassifizierung
6. Projekt-Preflight

### P2 – Arbeitsverhalten
7. Redundante Exploration
8. Planmodus-Effizienz
9. Subagenten-Nutzen

### P3 – Messbarkeit
10. Telemetrie normalisieren
11. Kontextwachstum messen
12. Performance-Aufschlüsselung

## Wichtige Benchmarkdaten aus Run #002

| Kennzahl | Pi | Codex |
|---|---:|---:|
| Haupt-Verifikation | PASS | PASS |
| GUI-Tests | PASS | PASS |
| GUI-Formatchecker | FAIL | FAIL |
| Laufzeit | 1809,258 s | 540,966 s |
| Fresh Input | 145.153 | 188.903 |
| Cache Read | 3.234.816 | 6.558.464 |
| Output | 25.575 | 23.488 |
| Tool Calls | 72 | 27 |
| Tool Errors | 6 | 2 |
| Blind Review | 1 Sieg | 1 Sieg |
| Gesamturteil | INCONCLUSIVE | INCONCLUSIVE |

## Nicht-Ziele

- Benchmark jetzt grundlegend neu bauen.
- Pi künstlich auf möglichst wenige Toolcalls trimmen.
- Subagenten pauschal entfernen.
- Geschwindigkeit über Korrektheit stellen.
- Neue Frameworks einführen, bevor die tatsächliche Ursache verstanden wurde.
