# Checkpoint A – Critical Remediation abgeschlossen

## Zweck

Dieser Checkpoint trennt sicherheits-/funktionskritische Remediation von
späterem P2/P3-Cleanup. Er muss einen eigenständig review- und mergefähigen
Stand erzeugen.

## Voraussetzung

F-01–F-10 besitzen in `08_TRACEABILITY_MATRIX.md` genau einen Endstatus.
`offen`, `blockiert` und `deferred` sind für P0/P1 nicht zulässig.

## Technische Abnahme

1. `npm --prefix npm run verify`
2. `npm --prefix npm test` nur separat, falls die Hauptsuite nicht vollständig
   Bestandteil des finalen `verify` ist
3. gezielte produktnahe Critical-Szenarien:
   - großer sicherheitsrelevanter Diff;
   - Recovery mit großem Diff;
   - echter Snapshotdefekt fail-closed + verständliche Diagnose;
   - urteilsloser Verifier: Retry ja, Commitdeckung nein;
   - TUI und headless/RPC erhalten korrekten Verifikationsstatus;
   - definierte positive/negative Git-Commit-Varianten;
   - project-write/Interpreter-Matrix gemäß F-06-Entscheidung;
   - Policy-Grenzen gemäß F-09;
   - F-10 Vorher/Nachher-Messung.
4. Gesamtdiff seit Base-SHA auf unbeabsichtigte Änderungen prüfen.
5. Wenn geschützte Pfade betroffen sind: Verifier-Delegation und PASS.
6. `git status --short` muss sauber sein.

## Akzeptanz

- kein bestätigter P0/P1 offen;
- F-01/F-02 können nicht mehr durch große Diffs umgangen/verriegelt werden;
- Snapshotdefekte führen nirgends zu stiller Freigabe;
- Protocol/Frontend-Server sind im kanonischen Pflichtprofil;
- F-10 hat keine unnötige Cache-Kohärenzschicht eingeführt;
- keine Benchmark-/Stage-2-/Modellläufe;
- keine Shortcut-/Shift+Tab-Bedienänderung.

## Ergebnis

Nach bestandenem Checkpoint A ist die **kritische Remediation abgeschlossen**.
Phase 3/4 darf separat fortgeführt werden. Ein späterer P2/P3-Refactor darf
diesen Stand nicht unnötig destabilisieren; bei Risiko lieber `bewusst
behalten`/`deferred` statt kosmetisch umbauen.
