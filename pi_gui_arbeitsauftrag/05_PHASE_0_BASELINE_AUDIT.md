# Phase 0 – Baseline und Schutzgeländer

## Ziel

Vor GUI-Arbeit den bestehenden Zustand von `daydaylx/pi` exakt erfassen und Schutz vor Regressionen schaffen.

## Aufgaben

1. Aktuelle Architektur dokumentieren.
2. Relevante Dateien erfassen:
   - Aurora UI
   - keybindings
   - settings
   - setup-core
   - workflow
   - verification
   - subagents
   - session state
   - RPC
3. Bestehende Tests und Verify-Kommandos erfassen.
4. Aktuelle Shortcuts als Baseline speichern.
5. Bestehende Menüs und semantische Aktionen auflisten.
6. Aurora-owned vs. Core-owned State trennen.
7. aktuellen Startpfad von `pi` dokumentieren.
8. prüfen, wie `pi --mode rpc` im aktuellen Fork funktioniert.
9. Baseline-Smoke-Test durchführen.

## Muss-Artefakte

- `baseline-architecture.md`
- `baseline-shortcuts.md`
- `baseline-menus.md`
- `baseline-state-owners.md`
- `baseline-tests.md`
- `phase-0-report.md`

## Abschlusskriterien

Alle Punkte müssen erfüllt sein:

- [ ] `pi` startet unverändert.
- [ ] vorhandene Tests sind erfasst.
- [ ] zentrale Shortcuts sind vollständig dokumentiert.
- [ ] zentrale Menüs sind vollständig dokumentiert.
- [ ] Core-owned State ist von Aurora-owned Rendering getrennt beschrieben.
- [ ] RPC-Fähigkeiten des aktuellen Forks sind praktisch getestet.
- [ ] keine Produktivdatei wurde unnötig verändert.
- [ ] Baseline-Report enthält bekannte Risiken.

## STOP-Gate

Nach Erfüllung:

```text
STATUS: PHASE 0 COMPLETE
NEXT: PHASE 1 BLOCKED
USER APPROVAL REQUIRED
```

Nicht mit Phase 1 beginnen, bevor der Nutzer ausdrücklich freigibt.
