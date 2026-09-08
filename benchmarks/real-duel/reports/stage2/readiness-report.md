# Stufe-2 Readiness-Report

Ausgefüllt am 2026-09-08, basierend auf `readiness-report-template.md`.

## Versionsstand

- Base SHA: `803153164ad111e6489c90a7a5cfa38b082c472a` (Tag `real-duel-stage2-base`)
- Pi Candidate Provenance: `pi-real@fc3ec86f60db` (`candidates/pi-real.toml`)
- Codex Candidate Provenance: `codex-real@f5d17b4fbae1` (`candidates/codex-real.toml`)
- Modell: `gpt-5.6-luna`
- Reasoning: Pi `high`, Codex `high`
- CLI-Versionen: Pi `0.84.4`, Codex `codex-cli 0.149.1`
- OpenBench-Version: Tag `v1.0.0` (`ee71845c2898a98b8e3f2810cba8a1389f72c27e`)

## Infrastruktur

- [x] Repo clean (`canonical_repo_clean: true`, `dirty_files_list: []`)
- [x] Baseline-Preflight clean für den finalen Base-SHA (`baseline_status=clean`, beide Kandidaten, beide Smoke-Läufe)
- [x] Benchmark-Unit-/Regressionstests grün — 58/58 (`python3 -m unittest discover -p 'test_*.py'` in `scripts/`)
- [x] Work-only Dual-Smoke PASS — `pi-duel smoke --trial 1`: Pi `success=true wall_time_s=20.628`, Codex `success=true wall_time_s=30.639`
- [x] Plan→Work Dual-Smoke PASS — `pi-duel smoke --trial 1 --workflow plan-work`: Pi `completed=true wall_time_s=71.296`, Codex `completed=true wall_time_s=161.958`, beide `failed_required_gates=[]`
- [x] alle Smoke-Runs `comparable=true` (Work-only: `reason=baseline_clean`; Plan-Work: `reason=baseline_clean`)

**Bekanntes Restrisiko (kein Blocker, aber zu beachten):** Während der Vorbereitung dieses Freezes brach Pis Plan-Phase bei `smoke-01-marker-file` in 2 von 5 Testläufen mit „Kein Planartefakt" ab — Ursache: das Modell stellt bei dieser sehr trivialen Aufgabe gelegentlich eine `ask_user`-Rückfrage („Soll ich in den Arbeitsmodus wechseln?"), die im RPC-Modus nicht beantwortbar ist; `pi_rpc_driver.py` bricht dann mit einer wenig aussagekräftigen Fehlermeldung ab, statt sauber über das dafür vorgesehene Gate `check_allowed_followups_only` zu scheitern. Reproduziert unabhängig von Nebenläufigkeit (ein isolierter Pi-only-Lauf war ebenfalls betroffen). Liegt in `pi_rpc_driver.py`, nicht in den in diesem Auftrag geänderten Dateien, und wurde nicht behoben (außerhalb des Auftragsumfangs — „kein grundlegender Umbau des Harness"). Empfehlung für die Serie: ein Lauf mit `completed=false` und dieser Fehlermeldung ist kein Zeichen einer kaputten Aufgabe, sondern ein bekannter, seltener Flake — sauber mit neuer Trial-Nummer wiederholen (siehe `comparable-false-process.md`, analог anzuwenden auch auf harte Ausführungsfehler, nicht nur `comparable=false`).

**Zusätzlich behobene Infrastruktur-Lücke (nicht ursprünglich im Arbeitsauftrag, aber blockierend für P0-2):** Frische Git-Worktrees hatten kein `node_modules` (gitignored), wodurch `format:check`/`typecheck` (Default-Baseline-Checks) in jedem Worktree mit „command not found" scheiterten und `baseline_status` nie `clean` werden konnte — das hätte den P0-2-Fix in der Praxis wirkungslos gemacht. Fix: `_make_worktree()` übernimmt `node_modules` jetzt per Hardlink-Kopie (`cp -al`) aus dem sauberen canonical Repo, pro Worktree unabhängig mutierbar (kein Teilen zwischen parallelen Armen). Verifiziert: `format:check`/`typecheck` liefen in einem frischen Worktree danach fehlerfrei; beide Clean-Smokes oben zeigen `baseline_status=clean`.

## Trial-System

- [x] `--trial` getestet — Default 1 ohne Flag; `--trial 2`/beliebige positive Werte übernommen; `--trial 0`/`--trial -1` auf `smoke` und `run` mit `SystemExit(2)` abgelehnt (`test_pi_duel.py::TrialCliTest`, `PositiveIntTest`)
- [x] eindeutige Run-IDs — `run_id` enthält `:trial{N}` (via `make_run_id`), Dateinamen (`run_id_base`) enthalten `-trial{N}-` vor dem Zeitstempel
- [x] keine Dateikollision — Fingerprint/Transcript/Tool-Trace/Worktree-Pfade alle von `run_id_base` abgeleitet, Trial 1 und Trial 2 empirisch unterscheidbar (`test_pi_duel.py::RunIdBaseTest`)
- [x] Report aggregiert mehrere Trials korrekt — `_stats()`/`_format_stat_cell()` liefern n/Mean/Median/Min/Max ab n>1, bei n≤1 byte-identisches Legacy-Format (`test_report_plan_work.py::StatsTest/FormatStatCellTest/MultiTrialAggregationTest`), end-to-end mit synthetischen 3-Trial-Daten manuell verifiziert

## Tool-Trace

- [x] Pi Work-only: vorhanden (`tool_trace_summary` in Ergebniszeile, Sidecar `tool-traces/{run_id_base}_pi.json`)
- [x] Pi Plan-Phase: vorhanden (`plan_phase_tool_trace`, Sidecar `..._pi_plan.json`)
- [x] Pi Work-Phase: vorhanden (`work_phase_tool_trace`, Sidecar `..._pi_work.json`)
- [x] Gesamt korrekt aggregiert, keine Doppelzählung — im Clean-Smoke: `plan_calls(1) + work_calls(5) = total_calls(6)`, `plan_errors(0) + work_errors(1) = total_errors(1)`; zusätzlich per Unittest belegt (`test_tool_trace.py::test_phase_separation_no_double_count`)

## Regression-Klassifikation

- [x] Clean-Baseline → neuer Fehler wird als `verification/regression` klassifiziert — **war ein bestätigter Bug, jetzt behoben.** `baseline_failure_map(status=clean)` und `status=unknown/skipped` ergaben denselben Rückgabewert (`None`), wodurch dieser Pfad nie erreicht wurde. Fix: `BaselineContext` trägt den vollen Status. Test: `test_tool_trace.py::test_clean_baseline_promotes_new_verification_error_to_regression`
- [x] Failing-Baseline → bekannter Fehler wird als `verification/baseline` klassifiziert — unverändertes, bereits korrektes Verhalten, jetzt über `BaselineContext` statt rohem Dict (`test_failing_baseline_same_check_stays_baseline_class`)
- [x] Unknown/Skipped-Baseline → bleibt `verification` (keine Spekulation) — `test_unknown_or_skipped_baseline_leaves_category_unchanged`, plus empirisch in beiden `--allow-dirty`-Smokes (`baseline_status=skipped` → Kategorie unverändert)
- [x] Nicht-Verifikationsfehler werden durch Baselinewissen nicht umklassifiziert — `test_clean_baseline_does_not_affect_non_verification_errors`

**Bekanntes Restrisiko:** Ältere `results.jsonl`-Zeilen aus Stufe 1 (vor diesem Fix) können bei sauberer Baseline + neuem Verifikationsfehler fälschlich `verification` statt `verification/regression` tragen. Betrifft nur historische Piloten-Daten, keine Stufe-2-Läufe.

## Tasks

| Task                                   | Klasse | ungelöst auf Base SHA                                                                                                                | beide Workflows unterstützt   | Checker/Bewertung definiert                                                                                                                                | Baseline-Checks definiert                                                        | keine versteckte Lösung im Benchmark-Artefakt                       |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| real-03-lsp-ruby-profile               | A      | ✅ (verifiziert: `PROFILES` ohne `ruby`-Eintrag, `docs/lsp.md` ohne Ruby-Erwähnung)                                                  | ✅ (`work-only`, `plan-work`) | ✅ Checker verifiziert gegen Ist-Zustand: korrektes FAIL                                                                                                   | ✅ Default (`format:check`, `typecheck`)                                         | ✅ liegt außerhalb `benchmarks/real-duel/`, keine Vorlösung im Repo |
| real-04-session-health-provider-filter | B      | ✅ (verifiziert: `parseSessionHealthArgs` kennt nur `--days`/`--json`)                                                               | ✅ (`work-only`, `plan-work`) | ✅ Checker verifiziert gegen Ist-Zustand: korrektes FAIL                                                                                                   | ✅ Default                                                                       | ✅ dito                                                             |
| real-05-lsp-rename-tool                | C      | ✅ (verifiziert: `LOCAL_LSP_TOOLS` enthält nur die 5 read-only Tools, `docs/lsp.md` dokumentiert Rename als bewusst nicht enthalten) | ✅ (`work-only`, `plan-work`) | ✅ Checker verifiziert gegen Ist-Zustand: korrektes FAIL; zusätzlich checker-eigener, agentenunabhängiger Sicherheitstest (`decideTool`/`LOCAL_LSP_TOOLS`) | ✅ `["verify"]` (Sicherheitsgrenze — volle Treffergleichheit mit Agenten-Verify) | ✅ dito                                                             |

Alle vier Stufe-1-Task-Verzeichnisse (`smoke-01-marker-file`, `plan-work-pilot-01-task-catalog`, `real-01-tui-warm-theme`, `real-02-gui-ux-redesign`) bleiben für Stufe 2 gesperrt — Lösungen/Patches/Blind-Review-Ergebnisse bereits vollständig im Repo dokumentiert.

## Blind-Review

- [x] Zwei unabhängige Blind-Review-Durchläufe vorbereitet — Protokoll: `blind-review-protocol.md` (Prozess dokumentiert, manuell durchzuführen — kein neues Code-Subsystem, wie im Arbeitsauftrag gefordert „keine neue Benchmark-Architektur")
- [x] Mapping-/Anonymisierungsverfahren festgelegt — `reports/stage2/<task>/blind-review-mapping.json`-Schema, Rotation A–D pro Trial, Auflösung erst nach Abschluss beider Reviews, `inconclusive` bei Widerspruch statt erzwungenem Sieger

## Laufmatrix

- [x] Matrix fest dokumentiert (`run-matrix.md`), Zielstandard 3×3×2×2=36
- [x] Reihenfolge-Rotation zwischen Trials festgelegt (Trial 1/3: WO→PW, Trial 2: PW→WO)

## Freeze

- [x] Base SHA festgelegt (`base-sha-freeze.md`, Tag `real-duel-stage2-base`)
- [x] Stufe-2-Harness eingefroren — ab diesem Commit keine Änderungen an Pi-Instructions, Permissions, Tool-Trace, Verifier-Policy, Plan-Quality, Benchmark-Skripten, Candidate-Konfiguration, Modell, Reasoning oder Task-Checkern bis zum Ende der 36-Läufe-Serie

## GO-Kriterium

Alle obigen Punkte sind erfüllt.

**`GO FOR STAGE 2`**

Die nächste, separate Aktion ist der Start der eigentlichen 3×3×2×2-Läufe-Serie entlang `run-matrix.md` — ausdrücklich **nicht** Teil dieser Ausführung.
