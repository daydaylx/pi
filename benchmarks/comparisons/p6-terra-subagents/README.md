# P6-TERRA-SUBAGENTS — Pi Produktivstack vs. Codex CLI (GPT-5.6 Terra)

Status: **Abgeschlossen** (Smoketest + 12-Läufe-Pilot, 2 Aufgaben × 2 Harnesses × 3 Wiederholungen).

Separate, eigenständige Serie — **nicht** mit P5-LUNA-HARNESS vermischt. Auf Nutzeranforderung: Subagenten erlaubt (statt Core-Parity-Sperre), Modell `gpt-5.6-terra` statt `gpt-5.6-luna`, Pi läuft mit seiner echten Produktivkonfiguration (main/investigator=terra@high, debugger=terra@max, verifier=claude-sonnet-5@max — unverändert aus der echten `settings.json`, kein Overlay).

- Series-ID: `P6-TERRA-SUBAGENTS`
- Referenzcommit: `dd00b33f039b4c6d291b1c241aaae9eb66ba4b85` (gleich wie P5, für Vergleichbarkeit)
- Modell (beide Seiten): `gpt-5.6-terra`
- Reasoning Effort: `high`
- Modus: Subagents Allowed — Pi-Produktivstack inkl. Sonnet-5-Verifier, Codex mit eigenem (unrestriktiertem) Multi-Agent-Feature
- Zusatz: identische Prompt-Ergänzung auf beiden Seiten, die Rückfragen im Einzelschuss-Modus explizit untersagt (siehe METHODOLOGY.md)

## Ergebnis

| Aufgabe            | Pi      | Codex   |
| ------------------ | ------- | ------- |
| 05 (klein/präzise) | 3/3     | 3/3     |
| 02 (Bugfix)        | 3/3     | 3/3     |
| **Gesamt**         | **6/6** | **6/6** |

Details in RESULTS.md/ANALYSIS.md.

## Struktur

Gleiche Struktur wie `p5-luna/`: `METHODOLOGY.md`, `ENVIRONMENT.md`, `RESULTS.md`, `ANALYSIS.md`, `RAW/`.

## Infrastruktur

- Manifest: `benchmarks/harness/p6-manifest.json`
- Controller: `benchmarks/harness/p6-controller.mjs`, CLI: `benchmarks/harness/p6.mjs`
- Wiederverwendet unverändert aus P5: `launch-pi.mjs`, `launch-codex.mjs`, `collect-pi-metrics.mjs`, `collect-codex-metrics.mjs`, `models.mjs`, `agent.mjs`
- Privater Evaluator-Root: eigener, separater Pfad (nicht identisch mit P5s Root, da `metadata.json.seriesId` sich unterscheidet)
