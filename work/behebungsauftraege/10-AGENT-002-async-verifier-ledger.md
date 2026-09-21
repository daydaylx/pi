# AGENT-002 — Async-Verifier-Ergebnisse werden nicht ins Ledger übernommen

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** Agent, Verifier, Async-State
- **Ziel:** Unterstützte Async-Verifier liefern ein korrekt gebundenes Ledger-Ergebnis; kurzfristig darf kein Async-Pfad einen falschen Nachweis vortäuschen.

## Betroffene Bereiche

- `extensions/setup-core/index.ts`
- `extensions/setup-core/subagent-output-guard.ts`
- `extensions/permissions/verifier-policy.ts`
- gepinnte `pi-subagents`-Background-Pfade

## Verbindliche Regeln

1. Ein reines Notify-Event ist kein PASS.
2. Async-Abschluss muss dieselbe `runId`, Generation, Root-, Scope- und Fingerprintbindung wie Sync verwenden.
3. Start, Abschluss, Timeout, Cancel und Fehler müssen dedupliziert werden.
4. Ergebnisse nach Sessionwechsel werden verworfen.
5. Bis zur vollständigen Integration ist `async:true` für Verifier abzulehnen oder automatisch synchron zu erzwingen.

## Todos

- [ ] Entscheiden: kurzfristig Async sperren oder direkt den vollständigen Abschlussvertrag bauen.
- [ ] Async-Startresultat mit `runId` und Pending-Status speichern.
- [ ] Background-Abschluss an denselben Ledger-Reducer wie Sync anschließen.
- [ ] Notify-Texte von fachlichen Verdicts trennen.
- [ ] Doppelabschlüsse, verspätete Abschlüsse und Fehlabschlüsse testen.
- [ ] Commit-Gate erst nach gültigem gebundenem Abschluss öffnen.

## Pflicht-Regressionstests

- Async-Start mit späterem PASS aktualisiert das Ledger genau einmal.
- Async-Start mit FAIL aktualisiert das Ledger genau einmal.
- Notify ohne strukturiertes Verdict öffnet kein Gate.
- Abschluss nach Sessionwechsel wird ignoriert.
- Timeout vor Abschluss bleibt unvollständig.

## Abnahmekriterien

- Unterstütztes Async-Ergebnis wird korrekt und einmalig verbucht; oder `async:true` wird klar abgelehnt.
- Kein Notify-Text kann einen PASS erzeugen.
- Deduplikation und Generationenschutz sind getestet.

## Abhängigkeiten

- AGENT-001 ist zwingend.
- AGENT-003 muss im gleichen Launch-Vertrag berücksichtigt werden.

## Risiken

- Async-Abschlüsse können nach Prozess- oder Sessionende eintreffen.

## Erforderlicher Abschlussnachweis

PR mit Entscheidung zur Async-Unterstützung und vollständigem Start-/Abschluss-Test.
