# ENVIRONMENT — P5-LUNA-HARNESS

Alle Angaben per Preflight-Skripten (`benchmarks/harness/p5/preflight/*.mjs`) erfasst; Rohausgaben liegen unter `RAW/preflight/`.

## System

| Feld                  | Wert                                            |
| --------------------- | ----------------------------------------------- |
| OS                    | Linux 6.8.0-137-generic x86_64 (Ubuntu-basiert) |
| Node                  | v22.23.2                                        |
| Git-Commit (Referenz) | `dd00b33f039b4c6d291b1c241aaae9eb66ba4b85`      |

## Pi

| Feld                                | Wert                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Paketversion                        | `@earendil-works/pi-coding-agent@0.84.4`                                          |
| Binary                              | `/home/d/.npm-global/bin/pi`                                                      |
| Modell (Main/Investigator/Debugger) | `openai-codex/gpt-5.6-luna`                                                       |
| Provider-baseUrl                    | `https://chatgpt.com/backend-api`                                                 |
| Kontextfenster                      | 272.000 Tokens                                                                    |
| Reasoning Effort                    | `high` (verifiziert unverändert an die API weitergereicht — siehe METHODOLOGY.md) |
| Verifier                            | deaktiviert (Modus A: kein externer Reviewer)                                     |
| Auth                                | ChatGPT-Backend über Pi's `openai-codex`-Provider (dieselbe Route wie Codex CLI)  |

## Codex CLI

| Feld                | Wert                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version             | `codex-cli 0.149.1` (gepinnt für die gesamte Serie)                                                                                                             |
| Update verfügbar    | `0.151.0` (laut `codex doctor`, bewusst NICHT installiert — Auftrag Abschnitt 4)                                                                                |
| Installationsart    | npm, Paket `/home/d/.npm-global/lib/node_modules/@openai/codex`                                                                                                 |
| Auth-Verfahren      | ChatGPT-Login (`codex login status` → "Logged in using ChatGPT"; `auth.json`-Keys: `auth_mode`, `OPENAI_API_KEY`, `tokens`, `last_refresh` — Werte nie erfasst) |
| Modell              | `gpt-5.6-luna` (explizit per `-m`/`-c model=` gesetzt; globaler Default in `~/.codex/config.toml` ist `gpt-5.6-terra`, wird von P5 nie berührt)                 |
| Reasoning Effort    | `high` (per `-c model_reasoning_effort=high`)                                                                                                                   |
| Sandbox             | `workspace-write` (per `-s`)                                                                                                                                    |
| Approval-Policy     | `never` (per `-a`)                                                                                                                                              |
| Netzwerkzugriff     | blockiert (Betriebssystem-Sandbox, bwrap — siehe METHODOLOGY.md)                                                                                                |
| Multi-Agent-Feature | vorhanden (`multi_agent: stable`), aber in Core-Parity-Läufen nicht ausgelöst (verifiziert über Abwesenheit von `thread_spawn`-Rollouts je Run)                 |
| CODEX_HOME pro Lauf | isoliert (`~/.local/state/pi-p5/runs/<runId>/codex/codex-home/`), nur `auth.json` hineinkopiert, kein `config.toml`                                             |

## Preflight-Ergebnisse (Zusammenfassung)

| Check                                                   | Ergebnis                                                                                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reasoning-Effort-Mapping (`audit-thinking-level.mjs`)   | CONFIRMED — `high` wird unverändert an die API gesendet (zwei unabhängige Codepfade geprüft)                                                                                                         |
| Netzwerk-Isolation (`check-network-isolation.mjs`)      | Codex: blockiert (kostenloser, modellfreier `codex sandbox`-Test). Pi: kein OS-Sandbox-Äquivalent — Mitigation über `networkToolCallsObserved`-Scan                                                  |
| Aufgaben-Gültigkeit (`audit-task-validity.mjs`)         | 4/5 Tasks vollständig gültig bei `dd00b33`; `04-multi-file-change` mit bekanntem, dokumentiertem Pfad-Confounder (siehe METHODOLOGY.md)                                                              |
| Privater Evaluator-Root (`audit-private-tasks.mjs`)     | `02-local-bug`, `05-refactor-no-behavior-change`, `09-hanging-tool-call` bereit. `04-multi-file-change`, `08-long-session-compaction` fehlen noch (Voraussetzung für die Freigabe des vollen Pilots) |
| Codex-Vorab-Erfassung (`capture-codex-environment.mjs`) | siehe Tabelle oben                                                                                                                                                                                   |

## Bekannte Lücken (vor Freigabe des vollen Pilots zu schließen)

1. Private Evaluatoren für `04-multi-file-change` und `08-long-session-compaction` fehlen noch.
2. Aufgabe `09-hanging-tool-call` benötigt eine `.pi/lsp.json`-Profilbindung (`.hangtest` → `python3 benchmark-fixture/fake-lsp.py --hang`), die weder `reset-task.sh` noch `p5/worktree-setup.mjs` bisher automatisiert anlegen — laut TASK.md als Harness-Detail vorausgesetzt, aber nicht implementiert. Task 09 ist damit aktuell nicht end-to-end lauffähig.
3. Aufgabe `04-multi-file-change`s veralteter Dateipfad im öffentlichen Prompt (siehe METHODOLOGY.md) sollte vor dem vollen Pilot aktualisiert werden, um die Interpretierbarkeit zu verbessern (beeinträchtigt die Fairness nicht, nur die Klarheit der Analyse).
