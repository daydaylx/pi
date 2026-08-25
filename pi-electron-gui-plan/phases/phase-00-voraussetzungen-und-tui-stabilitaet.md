# Phase 00 – Voraussetzungen und TUI-Stabilität

## Ziel

Vor Beginn der GUI-Arbeit müssen Runtime, TUI-Zustände und aktive Abhängigkeiten ausreichend stabil und nachvollziehbar sein. Die GUI darf keine bereits vorhandenen Widersprüche konservieren.

## Aufgaben

1. Aktuelle Entry-Points für CLI, TUI, Sessions, Extensions und Verification erfassen.
2. Exakt verwendete Version von `@earendil-works/pi-coding-agent` und relevanten Forks dokumentieren.
3. Bestehende TUI-Optimierungen abschließen oder bewusst aus dem GUI-Blocker entfernen.
4. Widersprüchliche Zustände zwischen Changes, Verification und Workflow prüfen.
5. Insbesondere sicherstellen:
   - Eine Änderung nach erfolgreicher Verification macht das Ergebnis sichtbar veraltet.
   - Ein früheres `checks_failed` sperrt spätere Bearbeitung nicht dauerhaft in einer falschen Phase.
6. Owner für Workflow, Permissions, LSP, Modell, Aktivität, Changes und Verification dokumentieren.
7. Basis-Tests für TUI-Start und zentrale Shortcuts sichern.

## Nicht-Ziele

- keine Electron-Abhängigkeit
- kein GUI-Code
- kein umfassender TUI-Neubau
- keine neue Statusmaschine

## Risiken

- Dokumentation weicht vom aktiven Code ab.
- Runtime-Patches greifen nur auf eine Build-Variante.
- Ein scheinbarer UI-Fehler ist tatsächlich eine falsche fachliche Zustandsableitung.

## Erforderliche Tests

- TUI-Start ohne GUI-Abhängigkeiten
- bestehende CLI-Argumente
- Workflowwechsel
- Änderung nach erfolgreicher Verification
- erneute Verification nach weiterer Änderung
- Listener- und Timerbereinigung bei Sessionwechsel
- kanonische Shortcuts bleiben aktiv

## Abschlusskriterien

- [ ] Aktive Entry-Points und Runtime-Versionen sind codebasiert dokumentiert.
- [ ] Für jeden GUI-relevanten Zustand ist genau ein fachlicher Owner benannt.
- [ ] Der Verification-Stale-Fall ist reproduzierbar getestet und korrekt gelöst.
- [ ] Kein bekannter P0- oder P1-TUI-Fehler blockiert die GUI-Grundlage.
- [ ] TUI startet und arbeitet ohne installierte oder gebaute GUI.
- [ ] Bestehende Shortcuts wurden nicht verändert.
- [ ] Relevante Basis- und Regressionstests sind grün.
- [ ] Es existiert ein dokumentierter Baseline-Commit für Phase 01.

## Gate

Nur `GO`, wenn alle Abschlusskriterien erfüllt sind. Offene fachliche State-Widersprüche ergeben `NO-GO`.

