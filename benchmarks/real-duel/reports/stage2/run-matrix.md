# Stufe-2 Laufmatrix

Zielstandard: 3 Tasks × 3 Trials × 2 Workflows × 2 Kandidaten = **36
Kandidatenläufe** (18 `pi-duel run`-Aufrufe, da Pi und Codex pro Aufruf
parallel laufen). Wird das Budget kleiner angesetzt, ist das **vor** Beginn
der Serie hier bewusst zu dokumentieren, nicht nach dem Start spontan zu
reduzieren. Zielstandard bleibt 3×3×2×2.

## Reihenfolge-Rotation

Um zeitliche/providerbedingte Effekte zu reduzieren, rotiert die
Workflow-Reihenfolge zwischen den Trials derselben Task:

| Trial | 1. Workflow | 2. Workflow |
| ----- | ----------- | ----------- |
| 1     | work-only   | plan-work   |
| 2     | plan-work   | work-only   |
| 3     | work-only   | plan-work   |

Pi und Codex eines Vergleichspaars laufen wie bisher parallel
(`pi-duel run --task <dir> --workflow <wf> --trial <n>` startet beide
Kandidaten gleichzeitig, sofern `--candidate` nicht gesetzt ist).

## Matrix (auszufüllen während der Serie)

| Task                                   | Klasse | Trial | Workflow-Reihenfolge | Status | comparable | Ersetzt Trial? |
| -------------------------------------- | ------ | ----- | -------------------- | ------ | ---------- | -------------- |
| real-03-lsp-ruby-profile               | A      | 1     | WO→PW                | offen  |            |                |
| real-03-lsp-ruby-profile               | A      | 2     | PW→WO                | offen  |            |                |
| real-03-lsp-ruby-profile               | A      | 3     | WO→PW                | offen  |            |                |
| real-04-session-health-provider-filter | B      | 1     | WO→PW                | offen  |            |                |
| real-04-session-health-provider-filter | B      | 2     | PW→WO                | offen  |            |                |
| real-04-session-health-provider-filter | B      | 3     | WO→PW                | offen  |            |                |
| real-05-lsp-rename-tool                | C      | 1     | WO→PW                | offen  |            |                |
| real-05-lsp-rename-tool                | C      | 2     | PW→WO                | offen  |            |                |
| real-05-lsp-rename-tool                | C      | 3     | WO→PW                | offen  |            |                |

Jede Zeile deckt beide Kandidaten (Pi + Codex, parallel) und beide
Workflows ab (2 Aufrufe pro Zeile: der jeweils erste und zweite Workflow der
Rotation) = 4 Kandidatenläufe pro Zeile × 9 Zeilen = 36.

`Status` ∈ {offen, läuft, abgeschlossen, verworfen (comparable=false)}.
`Ersetzt Trial?` referenziert den `run_id`/Trial, falls diese Zeile ein
sauberer Wiederholungslauf für einen zuvor als `comparable=false`
verworfenen Trial ist (siehe `comparable-false-process.md`) — alte und neue
Zeilen werden so nie stillschweigend vermischt.
