`/session-health` (`extensions/session-health/`) liest Pi-Session-JSONLs und
berichtet Turn-Ergebnisse, Recovery-Fälle, Fehler (nach Klasse/Provider/
Phase), Berechtigungsübergänge und Verifier-Urteile. Aktuell akzeptiert der
Befehl nur `--days N` und `--json` (siehe `parseSessionHealthArgs` in
`extensions/session-health/index.ts`).

Aufgabe: Ergänze einen neuen Filter `--provider <name>`, kombinierbar mit
den bestehenden Flags (`--days`, `--json`).

Exaktes Verhalten (verbindlich, nicht interpretierbar):

- Nur `resilience.failure`-Einträge tragen ein `provider`-Feld
  (`SessionHealthFailures.byProvider`). Turns, Recovery-Zähler,
  Berechtigungsübergänge und Verifier-Urteile enthalten KEIN
  Provider-Attribut und bleiben bei gesetztem `--provider` UNVERÄNDERT
  (über die volle Auswahl, nicht gefiltert) — sie stellen den
  Gesamtkontext dar, in dem die Provider-Fehler auftraten.
- Bei `--provider <name>` werden `failures.total`, `failures.byClass` und
  `failures.byPhase` NUR aus den `resilience.failure`-Einträgen berechnet,
  deren `provider`-Feld exakt `<name>` ist. `failures.byProvider` enthält
  dann nur noch (höchstens) den einen angefragten Provider.
- Ist `<name>` ein leerer String oder fehlt der Wert, ist das ein
  Argumentfehler wie bei den bestehenden Flags (`ctx.ui.notify(..., "error")`,
  kein Absturz).
- Ein `--provider`, für den in der gewählten Zeitspanne keine einzige
  `resilience.failure` existiert, ist KEIN Fehler — der Bericht zeigt dann
  `failures.total: 0` und alle Zähler leer, exakt wie bei einer Sitzung ohne
  Fehler.
- Die JSON-Ausgabe (`--json`) muss den angewendeten Filter sichtbar machen
  (analog zu `windowDays` im bestehenden Payload), z. B. als neues Feld
  `provider: <name> | null`.

Erweitere `tests/workflow-mode/session-health.test.mjs` um Testfälle für:
Filter wirkt nur auf failures.*, nicht auf turns/recovery/permissions/
verifier; Kombination von `--provider` mit `--days`; unbekannter Provider
liefert einen leeren, aber gültigen Report statt eines Fehlers; leerer
`--provider`-Wert wird wie ein Argumentfehler behandelt.
