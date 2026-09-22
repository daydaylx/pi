# BENCH-002 — Patch-Sicherung verliert Binärinhalte

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** Benchmark, Datenintegrität, Cleanup
- **Ziel:** Jeder Kandidatenstand muss vor Cleanup vollständig und gegen die exakte Basis wiederherstellbar gesichert werden.

## Betroffene Bereiche

- `_save_patch` in `benchmarks/real-duel/scripts/pi-duel`
- `cmd_cleanup`
- Patch- und Wiederherstellungs-Tests

## Verbindliche Regeln

1. Binäränderungen mit vollständiger Git-Patchinformation sichern.
2. External Diff und Textconv beim Sicherungslauf deaktivieren.
3. Existenz und SHA einer Patchdatei reichen nicht als Integritätsnachweis.
4. Cleanup erst nach erfolgreicher Wiederanwendbarkeitsprüfung erlauben.
5. Basis-SHA, Patch-SHA und Wiederherstellungsresultat getrennt dokumentieren.

## Todos

- [ ] Patch-Erzeugung auf vollständige Binary-Patches umstellen.
- [ ] Untracked, renamed, deleted, mode-changed und Gitlink-Fälle definieren.
- [ ] Frischen Basis-Checkout für `git apply --check` verwenden.
- [ ] Reapply-Test vor Cleanup integrieren.
- [ ] Cleanup-Fehler und Worktree-Remove-Fehler nicht verschlucken.
- [ ] Bei nicht wiederherstellbarer Sicherung Cleanup abbrechen und Artefakte behalten.

## Pflicht-Regressionstests

- Geänderte PNG-/Binärdatei sichern und frisch anwenden.
- Neue Binärdatei, gelöschte Binärdatei und Dateimodusänderung.
- Patch-SHA absichtlich verfälschen.
- Fehlgeschlagenes `git apply --check` blockiert Cleanup.

## Abnahmekriterien

- Der Auditfall mit `Binary files ... differ` erzeugt einen anwendbaren Patch.
- Cleanup entfernt keinen Kandidatenstand mit unvollständiger Sicherung.
- Wiederherstellung gegen die exakte Basis ist automatisiert geprüft.

## Abhängigkeiten

- BENCH-003 für belastbare Baseline-Identität.

## Risiken

- Patchgröße steigt.
- Sonderfälle wie Submodule und ignorierte Dateien brauchen bewusste Scope-Definition.

## Erforderlicher Abschlussnachweis

PR mit Binär-Reapply-Test und Cleanup-Fail-closed-Test.
