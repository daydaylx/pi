# Project State

## Aktuelle Arbeit

Audit-Remediation und Benchmark-Vorbereitung: Die Vorabnahme von Meilenstein B
bestätigt alle F-01–F-28-Endstatus. Phase 3/4 bleibt uncommittete, verifizierte
Vorarbeit. Phase 5 bereitet eine separate Pi-vs-Codex-Real-Duel-Serie mit
`gpt-5.6-luna` und Reasoning `medium` vor; reale Trials starten erst auf einer
sauberen, ausdrücklich freigegebenen Baseline. Kein Push.

## Umgesetzt

- **Audit Phase 4:** F-11 entfernt den toten Recovery-Export; F-18 trennt
  reine Verifier-Bewertung von erlaubter Executor-Normalisierung; F-19 macht
  Snapshotpfade Git-root-relativ mit Retry und Unterordnerregression.
- **Finalisierung:** Die Aurora-Header-Lifecycle-Regression ergänzt nur zwei
  Aufrufe im bestehenden Test. Der Coverage-Lauf misst nun
  `extensions/aurora-ui/index.ts` mit 46/46 Funktionen (100 %), ohne
  Produktverhalten oder Baseline zu ändern.
- **Medium-Serie:** Separate `pi-real-medium`-/`codex-real-medium`-Manifeste,
  `pi-duel --reasoning high|medium`, Reasoning-Übergabe für Work-only und
  Plan→Work sowie getrennte globale/effektive Fingerprint-Felder sind
  vorbereitet. Die 36-Lauf-Matrix liegt in
  `benchmarks/real-duel/reports/stage2-medium/`.

## Letzte Verifikation

- `verify({ check: "test" })` erfolgreich: Frontend-Contracts 21, Runtime
  1523, UI 139, Workflow 687, LSP 182 und die übrigen registrierten Suiten.
  Die gekapselten Benchmark-Unit-Regressionen liefen 62/62 grün.
- `npm --prefix npm run test:coverage` erfolgreich: Aurora 46/46 Funktionen
  (100 %); Runtime 1523, UI 139, Workflow 687 und LSP 182 grün.
- Direkte Interpreteraufrufe für die Benchmark-Unit-Suite sind durch die
  Schutzgrenze blockiert; die identische Suite lief über den vertrauenswürdigen
  Test-Entry-Point.
- Die zwei Verifier-Berichte zu Phase 4 sind inhaltlich positiv, aber ihre
  Harness-Abschlussartefakte technisch `INCOMPLETE` und nicht anrechenbar.

## Nächste Schritte

1. Das kanonische `project_check({ profile: "verify" })` auf dem vollständigen
   Audit- und Medium-Vorbereitungsstand ausführen.
2. Den abgegrenzten Audit- und Benchmark-Diff prüfen und eine explizite
   Commit-Freigabe für die saubere Medium-Baseline einholen.
3. Nach dem Commit `STAGE2_BASE_SHA` dokumentieren, die parallele Pi-Nutzung
   beenden und erst dann Dual-Smoke sowie die 36 Medium-Läufe starten.
