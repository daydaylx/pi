# Stufe-2 Readiness-Report — Template

Auszufüllen unmittelbar vor Freigabe der 36-Läufe-Serie.

## Versionsstand

- Base SHA:
- Pi Candidate Provenance:
- Codex Candidate Provenance:
- Modell:
- Reasoning:
- Relevante CLI-Versionen (pi, codex):
- OpenBench-Version (Tag/SHA):

## Infrastruktur

- [ ] Repo clean
- [ ] Baseline-Preflight clean (format:check, typecheck) für den finalen Base-SHA
- [ ] Benchmark-Unit-/Regressionstests grün (`python3 -m unittest discover -p 'test_*.py'` in `scripts/`)
- [ ] Work-only Dual-Smoke PASS (beide Kandidaten)
- [ ] Plan→Work Dual-Smoke PASS (beide Kandidaten)
- [ ] alle Smoke-Runs `comparable=true`

## Trial-System

- [ ] `--trial` getestet (Default 1, explizite Werte, Ablehnung von 0/negativ)
- [ ] eindeutige Run-IDs zwischen Trials
- [ ] keine Dateikollision zwischen Trials (Fingerprint/Transcript/Tool-Trace/Worktree)
- [ ] Report aggregiert mehrere Trials korrekt (n/Mean/Median/Min/Max)

## Tool-Trace

- [ ] Pi Work-only: vorhanden
- [ ] Pi Plan-Phase: vorhanden
- [ ] Pi Work-Phase: vorhanden
- [ ] Gesamt korrekt aggregiert, keine Doppelzählung (Plan Calls + Work Calls = Total Calls, Plan Errors + Work Errors = Total Errors)

## Regression-Klassifikation

- [ ] Clean-Baseline → neuer Fehler wird als `verification/regression` klassifiziert
- [ ] Failing-Baseline → bekannter Fehler wird als `verification/baseline` klassifiziert
- [ ] Unknown/Skipped-Baseline → bleibt `verification` (keine Spekulation)
- [ ] Nicht-Verifikationsfehler werden durch Baselinewissen nicht umklassifiziert

## Tasks

|                                        | Klasse | ungelöst auf Base SHA | beide Workflows unterstützt | Checker/Bewertung definiert | Baseline-Checks definiert | keine versteckte Lösung im Benchmark-Artefakt |
| -------------------------------------- | ------ | --------------------- | --------------------------- | --------------------------- | ------------------------- | --------------------------------------------- |
| real-03-lsp-ruby-profile               | A      |                       |                             |                             |                           |                                               |
| real-04-session-health-provider-filter | B      |                       |                             |                             |                           |                                               |
| real-05-lsp-rename-tool                | C      |                       |                             |                             |                           |                                               |

## Blind-Review

- [ ] Zwei unabhängige Blind-Review-Durchläufe vorbereitet (Protokoll: `blind-review-protocol.md`)
- [ ] Mapping-/Anonymisierungsverfahren festgelegt

## Laufmatrix

- [ ] Matrix fest dokumentiert (`run-matrix.md`), Zielstandard 3×3×2×2=36
- [ ] Reihenfolge-Rotation zwischen Trials festgelegt

## Freeze

- [ ] Base SHA festgelegt (`base-sha-freeze.md`)
- [ ] Stufe-2-Harness eingefroren

## GO-Kriterium

Erst wenn **alle** obigen Punkte erfüllt sind: `GO FOR STAGE 2`.

## Falls ein Punkt nicht erfüllt ist

### BLOCKER

(konkretes Problem)

### Auswirkung

(warum es Vergleichbarkeit/Aussagekraft beeinträchtigt)

### Kleinste notwendige Korrektur

(nur die minimale Änderung, die vor Stufe 2 notwendig ist)
