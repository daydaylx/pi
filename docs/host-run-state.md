# Host: Auftragszustand und Versand

Der `RunStore` besitzt den fachlichen Zustand, die Queue, Submission-Dedup und
Recovery. `run.current`, Reconnect und Startsperren lesen diesen Store direkt;
es gibt kein zusätzliches `currentRunId`, `activeRun` oder `uncertainRun`.
Ein geklärtes Manifest benötigt deshalb kein manuelles Zurücksetzen von Hostflags.

Die kurzlebige `promptReservation` enthält nur Request-ID und optional Run-ID.
Sie schützt Versand und Annahme bis zum Agentstart und endet bei Antwortfehler,
Request-Timeout oder Ablauf des Startfensters. Fehlt bei `run.submit` danach die
Startbestätigung, bleibt der Auftrag als `UNCERTAIN` im Store gesperrt. Ein
Idle-Snapshot oder `session.current` kann diese Unsicherheit nicht aufheben.
Ein tatsächlich beobachteter verspäteter Agentstart setzt die Ausführung fort,
ohne erneut zu senden. Späte Antworten und Timeouts ändern keinen bereits
abgeschlossenen Auftrag und lösen keine Reservierung eines späteren Requests.

Die älteren `agent.*`-Methoden besitzen weiterhin kein Runmanifest. Nur für
deren unbestätigten Transportausgang bleibt `legacyPromptUncertain` bis zum
beobachteten Start/Turn-Ende oder expliziten Sessionreadback erhalten. Es ist
kein persistierter Auftragszustand; dauerhafte Dedup-/Recovery-Garantien gelten
für `run.submit`. Runtime-Aktivität und offene Dialoge werden aus dem aktuellen
Snapshot bzw. der Dialogliste abgeleitet.

## Eigentümer und Persistenz

| Zustand                                                              | Eigentümer und Übergang                                                                          | Persistenz                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `runStore.runs`, Runzustand, Aktionen, Proofs und Ergebnisse         | RunStore; Host übergibt Lifecycle/Readback; `run.current` und Reconnect lesen den Store          | Atomare Runmanifeste unverändert             |
| `submissionIndex`, Submission-ID und Ursprungssitzung                | RunStore; vor Versand erstellt, beim Laden rekonstruiert                                         | Runmanifest mit Submission-ID unverändert    |
| `queued` und Queuefolge                                              | RunStore; Annahme, expliziter Start, Cancel                                                      | Runmanifest unverändert                      |
| `currentRunId`, `activeRun`, `uncertainRun`                          | Entfallen; Store bzw. Runtime-Snapshot liefern den Zustand direkt                                | Keine zweite Persistenz                      |
| `state.activity`, `state.permissions.pending`, `pendingUi`           | Adapter-Snapshot bzw. Dialogliste; nur beobachtete Runtime-/Dialogaktivität                      | Kein Runstatus; kein Recovery-Ersatz         |
| `promptReservation` und Timer                                        | Host; Request-ID plus optionale Run-ID, von Versand bis Start oder begrenztem Annahmefenster     | Kurzlebig, kein Schemafeld                   |
| `pending` mit `requestId`, `runId`, `startObserved` und Requesttimer | Host; Send, Antwort oder Timeout; `startObserved` schützt vor verspäteter Transportantwort       | Nur Transport, fachliches Ergebnis im Store  |
| `legacyPromptUncertain`                                              | Nur unbestätigte alte `agent.*`-RPCs ohne Manifest; Start, Settle oder explizites Readback klärt | Keine neue Garantie für Legacy-RPCs          |
| Verifikationstimer                                                   | Host terminiert fehlenden Nachweis; RunStore bestimmt Ergebnis/Unknown                           | Runzustand und Nachweise bleiben im Manifest |

## Übergänge

| Auslöser                                                 | Versandreservierung                                                | RunStore / Startentscheidung                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `run.submit` mit bekannter Submission-ID                 | Kein neuer Versand                                                 | Bestehender Run, einschließlich Ursprungssitzung                                                       |
| Neue Annahme                                             | Nach persistiertem Run und Submissionindex requestgebunden belegen | `ACCEPTED` → `INVESTIGATING` / `TURN_STARTING`                                                         |
| Ack vor Agentstart                                       | Bis `promptStartGraceMs` begrenzen                                 | Ack beweist noch keinen ausgeführten Auftrag                                                           |
| Beobachtetes `responding`                                | Freigeben, Request als beobachtet kennzeichnen                     | Nur unbestätigten Promptstart als `TURN_STARTED` fortsetzen; keinen externen Unknown-Zustand aufheben  |
| Ack ohne Start bis Frist oder Request-Timeout ohne Start | Freigeben                                                          | `UNCERTAIN`; Queue und neue Starts bleiben gesperrt                                                    |
| Unlesbares/zu großes Ack ohne Start                      | Freigeben                                                          | `UNCERTAIN` / `PROMPT_RESPONSE_UNREADABLE`; kein behaupteter Backend-Reject                            |
| Expliziter Backend-Reject vor Ausführung                 | Freigeben                                                          | `FAILED`, kein erfolgreicher Abschluss                                                                 |
| Späte Antwort nach Start, Settle oder neuerem Request    | Nur passende Request-ID freigeben                                  | Kein Wiederöffnen und kein Überschreiben beobachteter Ausführung                                       |
| `agent.settled`                                          | Freigeben                                                          | RunStore bestimmt `SUCCEEDED`, Fehler, Verifikation oder Unknown; Queue erst nach zulässigem Abschluss |
| Backend-/Hostcrash mit offener Mutation                  | Kurzlebiger Transport entfällt                                     | Persistierte Aktionen werden `unknown`; kein automatischer Prompt-/Apply-Retry                         |
| Reconnect / `session.current` mit Idle                   | Keine fachliche Freigabe                                           | Snapshot aus Store; `UNCERTAIN` bleibt gesperrt                                                        |
| Vertrauensgebundene Reconciliation                       | Kein zusätzlicher Flagreset                                        | RunStore entscheidet über verbleibende Startsperre                                                     |

Manifestformat, Submission-Dedup, IPC-v1 und Applyjob-/Readback-Verträge bleiben erhalten.
Diese Änderungen erfordern keine Migration produktiver Runmanifeste.

## Lokale Prüfungen

```sh
npm --prefix npm run test:frontend-contracts
node --test --test-name-pattern='run authority survives' frontend-server/test/runs.test.mjs
node --test --test-name-pattern='late prompt replies' frontend-server/test/host.test.mjs
```

Die Proben nutzen temporäre Profile und eine Fake-Runtime. `nixos_apply` wird nur
als Ereignis simuliert; kein Applyjob, Dienst oder Produktivmanifest wird ausgeführt
oder geändert. Dies belegt keine Aktivierung des installierten Hosts.
