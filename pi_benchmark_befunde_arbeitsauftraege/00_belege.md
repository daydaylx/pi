# Belegverzeichnis

## Primärquellen

- Commit: https://github.com/daydaylx/pi/commit/e30c7f5335c290ec2871c8a2af186a4bb0096d98
- Report: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign.md
- Run-Log: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign/run.log
- Pi-Patch: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign/patch_pi.diff
- Codex-Patch: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign/patch_codex.diff
- Results: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign/results.jsonl
- Codex-Transkript: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign/codex_transcript.txt

## Befund A – Pi-Verifikation scheitert in frischen Worktrees

Der Report dokumentiert für Real-Duel #002 erneut zwei Fehlschläge von
`project_check(verify)` mit Exit 127, weil im frischen Worktree `node_modules`
fehlten. Der gleiche Typ Fehler trat bereits im vorherigen Real-Duel auf.

Der Report bewertet dies ausdrücklich als reproduzierbares 2/2-Muster.

## Befund B – Verifier-Delegation scheitert an Tool-Contract

Im selben Lauf scheiterte ein Versuch, an den Verifier-Subagenten zu delegieren,
weil ein nicht erlaubter Parameter `timeoutMs` übergeben wurde.

Damit ist der Fehler nicht auf die eigentliche Aufgabenlösung zurückzuführen,
sondern auf einen Widerspruch zwischen aufrufender Logik/Prompt und Tool-Schema.

## Befund C – Pi-Transcript ist 251 MB groß

Report #002:
- Pi-Transkript: 251 MB
- 967 `tool_execution_update`-Events
- diese Events allein: 236 MB
- gzip immer noch ca. 71 MB

Das Pi-Transkript konnte deshalb nicht in GitHub eingecheckt werden.

## Befund D – Pi nutzt erheblich mehr Toolcalls und Zeit

Run #002:
- Pi: 72 Tool Calls, 6 Tool Errors, 1809,258 s
- Codex: 27 Tool Calls, 2 Tool Errors, 540,966 s

Die qualitative Bewertung war trotzdem unentschieden.
Das spricht dafür, den Overhead des Harness und die Tool-Sequenzen gezielt
zu untersuchen, ohne vorschnell die Modellqualität verantwortlich zu machen.

## Befund E – Turn-Metrik ist nicht harnessübergreifend vergleichbar

Der Report weist selbst darauf hin:
- Pi: 41 `turn_end`-basierte Turns
- Codex: 1 `turn.completed`
- beide Werte haben nicht dieselbe Semantik

`turns` darf daher nicht als direkte Vergleichsmetrik interpretiert werden.

## Befund F – Codex-Patch bestätigt Nutzen eines normalen User-Waiting-State

Im Codex-Patch werden normale `select`, `confirm` und `input` UI-Requests gezählt
(`pendingUserRequests`) und als Waiting-State dargestellt.

Im Pi-Patch wird `needsAttention` dagegen nur aus Subagent-Status
`needs_attention` abgeleitet. Dieser Befund gehört primär zum GUI-Patchvergleich,
zeigt aber gleichzeitig, wie wichtig eindeutige, zentral definierte Zustände sind.

## Hinweis zur Aussagekraft

Zwei Real-Duel-Läufe reichen nicht für ein allgemeines Ranking Pi vs. Codex.
Sie reichen aber, um wiederkehrende technische Fehler im Pi-Harness als konkrete
Engineering-Befunde zu behandeln.
