# REC-002 — Recovery-Replay verwendet den ersten statt den neuesten Check

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** Recovery, State, Robustheit
- **Ziel:** Nach Neustart oder Resume muss derselbe gültige Recovery-Zustand wie im laufenden Prozess rekonstruiert werden.

## Betroffene Bereiche

- `extensions/resilience/recovery-state.ts`
- `extensions/resilience/index.ts`
- Restart- und Replay-Tests

## Verbindliche Regeln

1. Nach dem letzten `required`-Marker zählt der chronologisch neueste gültige Check.
2. Ein späterer `required`-Marker entwertet alle früheren Checks.
3. Live-Aktualisierung und History-Replay verwenden dieselbe Reducer-Funktion.
4. Turn-, Session- und Generation-Zuordnung muss explizit bleiben.

## Todos

- [ ] Aktuelle `latestRecoveryGate`-Replaylogik korrigieren.
- [ ] Gemeinsamen State-Reducer für Live und Replay einführen.
- [ ] Mehrere Checks für denselben Required-Turn modellieren.
- [ ] Mehrere Required-Marker und Sessionwechsel testen.
- [ ] TUI-Anzeige des wiederhergestellten Status prüfen.

## Pflicht-Regressionstests

- `required(turn1) → checked(A) → checked(B) → restart` ergibt B.
- `required(turn1) → checked(A) → required(turn2)` verwirft A.
- Ein alter Check aus einer früheren Session öffnet kein aktuelles Gate.
- Live- und Replay-Ergebnis sind identisch.

## Abnahmekriterien

- Der Auditfall stellt nach Restart B statt A wieder her.
- Kein Check vor dem letzten Required-Marker wird verwendet.
- Tests decken Reihenfolgefehler und Sessiongrenzen ab.

## Abhängigkeiten

- REC-001 für die Bedeutung eines gültigen Checks.
- AGENT-001, falls Recovery-Checks künftig Run-Tickets verwenden.

## Risiken

- Falsche Turn-Zuordnung könnte ein altes Gate öffnen.

## Erforderlicher Abschlussnachweis

PR mit Reducer-Änderung und Replay-Test inklusive mindestens zweier Checks.
