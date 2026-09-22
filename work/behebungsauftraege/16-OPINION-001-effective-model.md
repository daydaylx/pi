# OPINION-001 — Familienprüfung prüft Labels statt das aktive Modell

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** Second Opinion, Modellidentität
- **Ziel:** Die unabhängige Zweitmeinung darf nicht denselben effektiven Modellaufruf wie der Hauptlauf verwenden, wenn Unabhängigkeit zugesagt wird.

## Betroffene Bereiche

- `extensions/second-opinion/service.ts`
- `extensions/second-opinion/manifest.ts`
- `extensions/setup-core/config.ts`

## Verbindliche Regeln

1. Exakte effektive Modellidentität vergleichen, nicht nur Konfigurationslabels.
2. Nach einem Modellwechsel die Entscheidung neu berechnen.
3. Alias-, Gateway- oder Registry-Unklarheit als `unknown` behandeln.
4. Providername nicht pauschal als Modellfamilie verwenden.
5. Sichtbare Modellangabe im Dialog bleibt zusätzliche Kontrolle, ersetzt aber nicht den technischen Gate.

## Todos

- [ ] Quelle der tatsächlich aufgelösten Hauptmodellidentität bestimmen.
- [ ] Opinion-Modell nach derselben Auflösungslogik normalisieren.
- [ ] Exakte Identität und gegebenenfalls Familie im Vorbereitungsergebnis speichern.
- [ ] Modellwechsel zwischen `prepare` und `executeApproved` prüfen.
- [ ] Alias-/Gateway-Unklarheit explizit behandeln.
- [ ] Tests mit gleichem Modell und unterschiedlichen Labels ergänzen.

## Pflicht-Regressionstests

- Haupt- und Opinion-Call verwenden dasselbe Modell, Labels sind verschieden: Anfrage wird abgelehnt.
- Hauptmodellwechsel nach `prepare`: alte Entscheidung wird ungültig.
- Unterschiedliche Modelle beim selben Gateway: zulässiges Verhalten bleibt möglich.
- Unbekannte Registry-Identität: kein falscher PASS/OK.

## Abnahmekriterien

- Der Auditfall liefert nicht mehr `prepare.ok=true` bei identischem Modell.
- Effektive Modellidentität ist im Ergebnis nachvollziehbar.
- Feature bleibt standardmäßig deaktiviert, bis der Gate-Test grün ist.

## Abhängigkeiten

- AGENT-001-ähnliche Generation-/Sessionprüfung für Dialog bis Call.

## Risiken

- Modellaliasse sind providerabhängig und nicht immer direkt vergleichbar.

## Erforderlicher Abschlussnachweis

PR mit Registry-Spy-Tests und dokumentierter Identitätsnormalisierung.
