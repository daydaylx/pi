# RESULTS — P6-TERRA-SUBAGENTS

## Smoketest (n=1 je Harness)

| Metrik            | Pi (`p6-smoke-05-pi`)                             | Codex (`p6-smoke-05-codex`)                       |
| ----------------- | ------------------------------------------------- | ------------------------------------------------- |
| Evaluator-Status  | pass                                              | pass                                              |
| Modell aufgelöst  | `openai-codex/gpt-5.6-terra`                      | `gpt-5.6-terra`                                   |
| Verifier          | aktiviert (`claude-sonnet-5`), nicht aufgerufen   | n/a                                               |
| Modellaufrufe     | 11                                                | 5                                                 |
| Geänderte Dateien | `benchmark-fixture/diff-viewer/change-tracker.ts` | `benchmark-fixture/diff-viewer/change-tracker.ts` |

## Voller Pilot (12 Läufe: `05`, `02` × Pi/Codex × 3 Wiederholungen)

### Aufgabe 05 — `05-refactor-no-behavior-change`

| Run                  | Status   | Modellaufrufe | Input-Tokens | Output-Tokens | Fehlgeschl. Tools | Laufzeit |
| -------------------- | -------- | ------------- | ------------ | ------------- | ----------------- | -------- |
| p6-pilot-05-pi-r1    | **pass** | 12            | 71.165       | 3.168         | 3                 | 229 s    |
| p6-pilot-05-pi-r2    | **pass** | 16            | 69.922       | 4.151         | 5                 | 336 s    |
| p6-pilot-05-pi-r3    | **pass** | 7             | 28.902       | 3.070         | 1                 | 197 s    |
| p6-pilot-05-codex-r1 | **pass** | 5             | 377.095      | 3.061         | 1                 | 503 s    |
| p6-pilot-05-codex-r2 | **pass** | 4             | 289.614      | 2.149         | 1                 | 127 s    |
| p6-pilot-05-codex-r3 | **pass** | 5             | 361.519      | 4.041         | 1                 | 197 s    |

**Erfolgsquote: Pi 3/3, Codex 3/3.** Gegenüber P5-LUNA-HARNESS (Pi 1/3 bei derselben Aufgabe) eine vollständige Umkehr — siehe ANALYSIS.md für die Zuordnung zur Prompt-Ergänzung.

### Aufgabe 02 — `02-local-bug`

| Run                  | Status   | Modellaufrufe | Input-Tokens | Output-Tokens | Fehlgeschl. Tools | Laufzeit |
| -------------------- | -------- | ------------- | ------------ | ------------- | ----------------- | -------- |
| p6-pilot-02-pi-r1    | **pass** | 10            | 32.124       | 1.168         | 3                 | 225 s    |
| p6-pilot-02-pi-r2    | **pass** | 8             | 28.478       | 1.070         | 3                 | 224 s    |
| p6-pilot-02-pi-r3    | **pass** | 11            | 27.621       | 1.232         | 4                 | 171 s    |
| p6-pilot-02-codex-r1 | **pass** | 3             | 165.827      | 1.280         | 1                 | 188 s    |
| p6-pilot-02-codex-r2 | **pass** | 3             | 199.769      | 1.094         | 1                 | 143 s    |
| p6-pilot-02-codex-r3 | **pass** | 4             | 351.036      | 1.764         | 0                 | 97 s     |

**Erfolgsquote: Pi 3/3, Codex 3/3** — wie in P5, unverändert volle Parität.

### Gesamt

| Metrik        | Pi (Median, n=6) | Codex (Median, n=6) |
| ------------- | ---------------- | ------------------- |
| Erfolgsquote  | 6/6              | 6/6                 |
| Input-Tokens  | 30.513           | 320.325             |
| Output-Tokens | 2.151            | 1.956               |
| Laufzeit      | 224 s            | 166 s               |
| Modellaufrufe | 10,5             | 4,0                 |

Keine Subagenten-Delegation in irgendeinem der 12 Läufe (Investigator/Debugger/Verifier bei Pi durchgehend `invoked: false`; kein `multi_agent`-Thread bei Codex) — beide Aufgaben lösen Pis Delegationskriterien nicht aus.

Rohdaten: `RAW/runs/<run-id>/` (2 Smoketest + 12 Pilot).
