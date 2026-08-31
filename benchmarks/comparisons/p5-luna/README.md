# P5-LUNA-HARNESS — Pi Harness vs. OpenAI Codex CLI (GPT-5.6 Luna)

Status: **Core-Parity-Pilot abgeschlossen** — 18 Läufe (3 Aufgaben `05`/`02`/`08` × 2 Harnesses × 3 Wiederholungen; `04`/`09` vorab gestrichen, siehe METHODOLOGY.md). Ergebnis: siehe RESULTS.md/ANALYSIS.md. Aufgabe `08` musste wegen eines defekten Prompts aus der Wertung ausgeschlossen werden.

- Series-ID: `P5-LUNA-HARNESS`
- Referenzcommit: `dd00b33f039b4c6d291b1c241aaae9eb66ba4b85`
- Modell (beide Seiten): `gpt-5.6-luna`
- Reasoning Effort: `high`
- Modus: Core Parity (Modus A) — keine Subagenten-Nutzung erzwungen, kein Webzugriff, gleiche Filesystem-Rechte

## Struktur

| Datei            | Inhalt                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `METHODOLOGY.md` | Fairness-Regeln, Task-Auswahl, bekannte Confounder                                          |
| `ENVIRONMENT.md` | Exakte Pi-/Codex-Version, Modell-ID, Konfiguration, Preflight-Ergebnisse                    |
| `RESULTS.md`     | Rohdaten und Aggregatwerte je Lauf                                                          |
| `ANALYSIS.md`    | Interpretation (vorläufig bei n=1/Smoketest, belastbar erst ab n=3)                         |
| `RAW/`           | Preflight-Artefakte, Manifest-Kopie, pro Lauf: Session-Trace/Rollout, Diff, Verify-Ergebnis |

## Infrastruktur

- Manifest: `benchmarks/harness/p5-manifest.json`
- Controller: `benchmarks/harness/p5-controller.mjs`, CLI: `benchmarks/harness/p5.mjs`
- Pi-Launcher: `benchmarks/harness/p5/launch-pi.mjs`
- Codex-Launcher: `benchmarks/harness/p5/launch-codex.mjs`
- Privater Evaluator-Root: `PI_BENCHMARK_PRIVATE_ROOT` (außerhalb dieses Repos)

## Nächster Schritt

Pilot abgeschlossen. Für eine größere, statistisch belastbarere Serie (5 Aufgaben × 5 Wiederholungen) müssten die Prompts für `04`/`08`/`09` zuerst repariert werden (siehe METHODOLOGY.md). Separat angefordert: eine neue Serie mit erlaubten Subagenten (`gpt-5.6-terra`, Pi-Produktivstack inkl. Sonnet-5-Verifier) — wird eigenständig geführt, nicht mit P5-LUNA-HARNESS vermischt.
