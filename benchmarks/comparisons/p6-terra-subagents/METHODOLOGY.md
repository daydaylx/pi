# METHODOLOGY — P6-TERRA-SUBAGENTS

## Ziel

Auf Nutzeranforderung nach P5-LUNA-HARNESS: Messen, was jeder Harness im echten Produktivbetrieb liefert, wenn Subagenten-Delegation erlaubt ist (statt der Core-Parity-Sperre in P5), weiterhin bei gleichem Modell auf beiden Seiten (`gpt-5.6-terra` statt `gpt-5.6-luna`).

## Unterschiede zu P5-LUNA-HARNESS

|                     | P5-LUNA-HARNESS                                                                 | P6-TERRA-SUBAGENTS                                                   |
| ------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Modell              | `gpt-5.6-luna`                                                                  | `gpt-5.6-terra`                                                      |
| Pi-Subagenten       | gesperrt (Investigator/Debugger dürfen aufgerufen werden, Verifier deaktiviert) | erlaubt, inkl. Verifier                                              |
| Pi-Verifier-Modell  | deaktiviert                                                                     | `anthropic/claude-sonnet-5` (Pis echte Produktivkonfiguration)       |
| Pi-Settings-Overlay | ja (pinnt Luna, deaktiviert Verifier, entfernt Web-Paket)                       | **keiner** — Worktree nutzt die unveränderte, echte `settings.json`  |
| Codex-Subagenten    | nicht erzwungen, aber nie beobachtet                                            | nicht erzwungen, eigenes `multi_agent`-Feature frei                  |
| Prompt              | v2-`PROMPT.md` unverändert                                                      | v2-`PROMPT.md` + identische Ergänzung gegen Rückfragen (siehe unten) |

## Warum kein Pi-Settings-Overlay nötig ist

Pis echte, aktuelle `settings.json` (unverändert im gefetchten Worktree vorhanden) pinnt bereits exakt: `defaultModel: "gpt-5.6-terra"`, `agentOverrides.investigator.model: "openai-codex/gpt-5.6-terra"` (kein Thinking-Override → erbt `high`), `agentOverrides.debugger: {model: "openai-codex/gpt-5.6-terra", thinking: "max"}`, `agentOverrides.verifier: {model: "anthropic/claude-sonnet-5", thinking: "max"}`. `modelScope.allow` enthält beide Modelle bereits. Verifiziert vor dem ersten echten Lauf durch direktes Auslesen eines frisch vorbereiteten Worktrees (siehe RAW/preflight).

## Prompt-Ergänzung gegen unbeantwortbare Rückfragen

**Hintergrund:** In P5-LUNA-HARNESS endeten 2 von 3 Pi-Läufen bei Aufgabe 05 damit, dass der Agent eine Klärungsfrage stellte, die im erzwungenen Einzelschuss-Modus nie beantwortet werden kann (`ask_user` schlägt in `--print`/`codex exec` strukturell fehl). Der Nutzer bat darum, das für diese neue Serie zu entschärfen — **nicht** durch Deaktivieren eines Tools (Codex hat ohnehin kein `ask_user`-Äquivalent, ein Tool-seitiger Eingriff wäre nur für Pi möglich und damit unfair), sondern durch eine für beide Seiten identische Prompt-Ergänzung.

Wortlaut (`manifest.promptSuffix`, an denselben öffentlichen Prompt für beide Harnesses angehängt):

> Hinweis zur Ausführungsumgebung: Diese Aufgabe läuft in einem nicht-interaktiven Einzelschuss-Modus. Eine Rückfrage kann nicht beantwortet werden. Falls der Auftrag an einer Stelle mehrdeutig ist, triff die plausibelste Annahme, dokumentiere sie kurz in deiner Abschlussantwort, und setze die Bearbeitung fort statt eine Rückfrage zu stellen.

Der `promptFingerprint` im Ergebnis deckt den **vollständigen** tatsächlich gesendeten Text (Prompt + Ergänzung) ab, nicht nur den öffentlichen `PROMPT.md`-Inhalt.

**Wirkung:** Pi löste mit dieser Ergänzung alle 3 Wiederholungen von Aufgabe 05 korrekt (P5: nur 1/3) — siehe RESULTS.md/ANALYSIS.md.

## Aufgabenauswahl

Nur `05-refactor-no-behavior-change` und `02-local-bug` — dieselben zwei bereits in P5 als valide bestätigten Aufgaben. `08-long-session-compaction` bleibt ausgeschlossen (Prompt strukturell inhaltsleer, siehe P5-METHODOLOGY.md — daran ändert die Rückfrage-Ergänzung nichts, da es dort nichts zu erkunden/anzunehmen gibt). `04`/`09` bleiben aus denselben Gründen wie in P5 ausgeschlossen.

## Referenzcommit

Identisch zu P5 (`dd00b33`) für Vergleichbarkeit der Codebasis zwischen beiden Serien.

## Privater Evaluator

Eigener, separater `PI_BENCHMARK_PRIVATE_ROOT` (nicht identisch mit P5s Root) mit `metadata.json.seriesId: "P6-TERRA-SUBAGENTS"` — gleicher Evaluator-Code wie in P5 (Korrektheits-/Scope-Prüfung ist modell-/harnessunabhängig), nur die Series-ID unterscheidet sich, damit `validatePrivateP6Task` P5- und P6-Läufe nicht verwechseln kann.

## Infrastruktur-Wiederverwendung

`launch-pi.mjs`, `launch-codex.mjs`, `collect-pi-metrics.mjs`, `collect-codex-metrics.mjs`, `models.mjs`, `agent.mjs` aus P5 werden **unverändert** wiederverwendet (keiner dieser Module hartcodiert Luna oder die Core-Parity-Rollenform). Neu: `p6-manifest.json`/`.schema.json`, `p6-manifest.mjs`, `p6-controller.mjs` (kein Settings-Overlay, alle 4 Pi-Rollen aktiv, Prompt-Suffix-Injektion), `p6/io.mjs` (eigener State-Root `pi-p6`), `p6/cli.mjs`, `p6.mjs`.
