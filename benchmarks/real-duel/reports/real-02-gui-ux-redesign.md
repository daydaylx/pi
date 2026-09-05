# REAL DUEL #002 — GUI UI/UX-Audit und Redesign

```
Base:
268e6ced080d6c0bf656f0af0632b3094cd943c0

Task:
benchmarks/real-duel/tasks/real-02-gui-ux-redesign/instruction.md
(vollständiger, wortgleicher Nutzerauftrag: UI/UX-Audit + Redesign der
Electron-GUI unter gui/, kein Benchmark-Vokabular)

Main model:
gpt-5.6-terra (beide Arme, Reasoning: high)
```

|                                                                         | PI                                                                      | CODEX                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Functional (format:check/typecheck/deadcode/test:coverage/test:patches) | PASS                                                                    | PASS                                                                |
| Functional (`npm --prefix gui test`, inkl. eigener neuer Tests)         | PASS                                                                    | PASS                                                                |
| Functional (gui-eigener Format-Checker)                                 | FAIL — Drift in 2 selbst hinzugefügten Testdateien + vorbestehendem Gap | FAIL — Drift in stark umgebautem `renderer.js` + vorbestehendem Gap |
| Requirements (Nicht-Ziele eingehalten)                                  | PASS                                                                    | PASS                                                                |
| Blind Review (2x, Reihenfolge vertauscht)                               | WIN (Runde 1)                                                           | WIN (Runde 2)                                                       |
| **Blind Review Gesamturteil**                                           | **INCONCLUSIVE — nicht robust gegen Positionsbias**                     |                                                                     |
| Rückfragen                                                              | 0                                                                       | 0                                                                   |
| Runtime                                                                 | 1809,3 s (~30 min)                                                      | 541,0 s (~9 min)                                                    |
| Model Calls (Turns)                                                     | 41                                                                      | 1 (\*)                                                              |
| Fresh Input                                                             | 145.153                                                                 | 188.903                                                             |
| Cache Read                                                              | 3.234.816                                                               | 6.558.464                                                           |
| Output                                                                  | 25.575                                                                  | 23.488                                                              |
| Reasoning                                                               | 5.542                                                                   | 7.880                                                               |
| Tool Calls                                                              | 72                                                                      | 27                                                                  |
| Tool Errors                                                             | 6                                                                       | 2                                                                   |
| Cost                                                                    | $1,24 (`pi_usage_cost_field`)                                           | unavailable                                                         |

(\*) Siehe Report #001 — Codex' `turns` zählt `turn.completed`-Events und ist
hier kein direktes Äquivalent zu Pis 41 `turn_end`-Events.

## Funktionale Bewertung im Detail

Beide Agenten blieben strikt im erlaubten Scope (`gui/renderer/`,
`gui/test/`) — keiner hat `gui/main/` (Electron-/IPC-Backend), Agenten-
oder Harness-Logik angefasst.

**Bemerkenswert: Beide fanden und behoben unabhängig voneinander dieselben
zwei echten, vorbestehenden P0-Bugs** — ein starkes Signal für echte
Code-Audit-Tiefe statt oberflächlicher Optik-Änderung:

1. Ein Subagent-„Stopp"-Button ohne jede Wirkung (keine RPC-Fähigkeit für
   gezielten Subagent-Abbruch vorhanden).
2. Main-Agent-Tools wurden fälschlich dem gerade geöffneten Subagent-Tab
   zugeschrieben.

Beide Patches sind **funktional vollständig grün** (anders als Report
\#001 — diesmal keine Testregression bei Pi). Beide haben eine kleine,
aber echte Formatierungsabweichung im GUI-eigenen Prettier-Checker
(`node gui/test/format-check.mjs`, ein separater Checker nur für `gui/`,
den der projektweite `format:check` nicht abdeckt) — jeweils in
unterschiedlichen, selbst erzeugten/geänderten Dateien: Pi in seinen zwei
neuen Testdateien, Codex im stark umgebauten `renderer.js`. Symmetrisch,
keine Seite eindeutig besser.

**Wiederholtes Muster aus Report #001:** Pi scheiterte erneut zweifach mit
Exit-Code 127 an seinem eigenen `project_check(verify)`-Tool, weil die
frische Worktree keine `node_modules` enthielt — identisch zum ersten
Real-Duel-Lauf. Zusätzlich schlug ein Versuch, die Verifikation an den
Verifier-Subagenten zu delegieren, an einem verbotenen `timeoutMs`-Parameter
fehl. Codex traf einen anderen, kleineren Infrastruktur-Fehler (fehlendes
`prettier`-Modul beim direkten Aufruf des gui-eigenen Format-Checkers),
konnte aber seine Haupt-Verifikation durchziehen. **Über zwei von zwei
Läufen ist das jetzt ein reproduzierbares, nicht zufälliges Muster**: Pis
headless-Selbstverifikation scheitert konsistent an fehlenden Dependencies
in frischen Worktrees, während Codex proaktiv bootstrapped.

## Blind-Patch-Review (2x, Positionsbias-Kontrolle) — INCONCLUSIVE

- **Runde 1** (A=Pi, B=Codex): WINNER A (Pi) — Begründung: saubere,
  testbare Pure-Functions statt DOM-verzahnter Logik; zwei konkrete, im
  Code verifizierte Bugs bei Codex (eine `aria-live="polite"
aria-atomic="true"`-Region, die bei jedem Streaming-Delta neu feuert —
  Accessibility-Regression bei langen Läufen; eine Elapsed-Time-Anzeige,
  die durch Zurücksetzen von `startedAt` bei jedem Delta faktisch nie
  einen sinnvollen Wert zeigt).
- **Runde 2** (A=Codex, B=Pi): WINNER A (Codex) — Begründung: Codex deckt
  den im Auftrag als wichtigsten Fall benannten Zustand „wartet Pi auf
  mich?" (offene `select`/`confirm`/`input`-Dialoge) korrekt ab, Pi nur
  den selteneren Subagent-Fall; Codex entfernte den toten Stop-Button,
  nutzt `planReady.qualityOk` korrekt. Gegenbefund: Pi führt eine saubere
  Modultrennung, Codex eine doppelte, sich leicht widersprechende
  Label-Taxonomie (`ACTIVITY_PRESENTATION` vs. bestehendes
  `ACTIVITY_PHASE_LABELS`) ein; Codex ließ zudem alte Neon-Farben
  (Violett/Cyan) im Syntax-Highlighting unangetastet — ein direkter
  Verstoß gegen die Farbvorgabe —, während Pi dort gar nichts änderte.

**Beide Reviews fanden echte, unabhängig verifizierte, im Code
nachweisbare Stärken und Schwächen auf beiden Seiten — das Ergebnis kippt
mit der Präsentationsreihenfolge.** Gemäß Auftragsregel ("Eindeutigen
Gewinner nur melden, wenn beide Reihenfolgen kompatibel urteilen; sonst:
Tie/inconclusive") wird hier **kein Gewinner** gemeldet.

## Interpretation

- Anders als bei Real-Duel #001 gibt es diesmal **keinen robusten
  Blind-Review-Gewinner** — ein ehrliches, für einen einzelnen Lauf nicht
  unerwartetes Ergebnis bei einer subjektiveren UI/UX-Aufgabe mit mehr
  vertretbaren Lösungswegen als bei der stärker technischen TUI-Aufgabe.
- Beide Patches haben reale, konkrete, sich ergänzende Schwächen: Codex'
  Elapsed-Time-Anzeige und Accessibility-Live-Region sind fehlerhaft; Pis
  Abdeckung des häufigsten „wartet auf mich"-Falls ist unvollständig, und
  seine Farbwelt-Migration lässt das Syntax-Highlighting unberührt.
- Pis wiederholtes Scheitern an fehlenden `node_modules` (jetzt 2/2 Läufe)
  ist der klarste, am robustesten reproduzierte Einzelbefund über beide
  bisherigen Real-Duels hinweg — unabhängig von der jeweiligen Aufgabe.
- Codex war erneut deutlich schneller (9 vs. 30 Minuten) bei ähnlichem
  Output-Volumen; Pis Kosten sind mit Codex' (nicht meldbaren) Kosten
  nicht direkt vergleichbar.
- Zwei Läufe sind weiterhin kein allgemeines Ranking — insbesondere ein
  Lauf mit inkonklusivem Blind-Review unterstreicht das.

## Empfohlene nächste Schritte (nicht automatisch umgesetzt)

Da kein Patch klar gewinnt, aber beide reale, sich ergänzende Bugs
gefunden haben, wären folgende manuelle Optionen sinnvoll (Entscheidung
liegt beim Nutzer, nicht automatisch ausgeführt):

1. Codex' Patch anwenden, danach die zwei von Runde 1 gefundenen Bugs
   (Live-Region-Spam, wirkungslose Elapsed-Time) manuell nachbessern.
2. Pis Patch anwenden, danach die „wartet auf mich"-Abdeckung für
   Haupt-Dialoge und die warme Syntax-Highlighting-Farbe ergänzen.
3. Beide Patches als Referenz behalten, ohne einen davon zu übernehmen,
   und die Fixes selbst/neu formulieren.

## Artefakte

Committet unter [`real-02-gui-ux-redesign/`](real-02-gui-ux-redesign/):
Codex-Transkript, beide Patches, Fingerprint, `results.jsonl`-Zeilen,
Run-Log (auf Nutzerwunsch aus Report #001 fortgeführt).

**Ausnahme:** Pis Transkript ist für diesen Lauf 251 MB (967
`tool_execution_update`-Zwischenstatus-Events allein 236 MB) — über
GitHubs 100-MB-Dateilimit, gzip-komprimiert noch 71 MB. Auf Nutzerwunsch
**nicht** committet, sondern lokal referenziert:
`~/.local/state/real-duel/obench-workspace/transcripts/real-02-gui-ux-redesign-20260905T044922_pi.txt`.

Worktrees für diesen Lauf wurden nach Erstellung dieses Reports entfernt
(`pi-duel cleanup real-02-gui-ux-redesign-20260905T044922`).
