# OPINION-002 — Abgebrochene Anfrage startet trotzdem den Zweitmeinungs-Call

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** Second Opinion, Abort, Kostenkontrolle
- **Ziel:** Nach einem Abbruch darf kein zusätzlicher Provider-Call mehr gestartet werden.

## Betroffene Bereiche

- `extensions/second-opinion/service.ts`
- `extensions/second-opinion/index.ts`
- Dialog- und Request-Lifecycle

## Verbindliche Regeln

1. Bereits abgebrochene Signale vor Freigabeverbrauch prüfen.
2. Signal unmittelbar vor dem Modellcall erneut prüfen.
3. Kombinierte Abort-Signale müssen den bereits gesetzten Zustand übernehmen.
4. Session- und Request-Zugehörigkeit nach dem Dialog erneut validieren.
5. Abbruch ergibt `cancelled`, nicht fachliches `failed` oder `completed`.

## Todos

- [ ] Abort-Lifecycle zwischen Dialog und Service dokumentieren.
- [ ] Initialen Zustand des kombinierten Controllers korrekt setzen.
- [ ] Pre-call Guard unmittelbar vor `modelRegistry.complete` ergänzen.
- [ ] Freigabe bei Abbruch nicht verbrauchen.
- [ ] Registry-Spy und Sessionwechsel-Tests ergänzen.

## Pflicht-Regressionstests

- Signal ist vor `executeApproved` bereits aborted: kein Registry-Call.
- Abbruch während des Dialogs: kein Registry-Call.
- Abbruch genau vor Providerstart: kein Registry-Call.
- Normaler nicht abgebrochener Auftrag startet genau einen Call.

## Abnahmekriterien

- Der Auditfall zeigt `registryCalls=0`.
- Abgebrochene Anfragen erscheinen als `cancelled`.
- Kein Provider-Call entsteht nach Dialog-Abbruch.

## Abhängigkeiten

- OPINION-001 für die erneute Validierung des vorbereiteten Auftrags.

## Risiken

- Race zwischen letzter Abort-Prüfung und Providerstart bleibt ohne Provider-/Runtime-Unterstützung theoretisch möglich; Signal muss trotzdem weitergereicht werden.

## Erforderlicher Abschlussnachweis

PR mit Abort- und Sessionwechsel-Test sowie Registry-Spy-Ausgabe.
