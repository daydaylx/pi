# AGENT-003 — Timeout-Alias umgeht das Verifier-/Debugger-Budget

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** Agent, Budget, Performance
- **Ziel:** Alle externen Timeout-Aliase müssen gleich behandelt werden; Mindestlaufzeit und Profilbudget dürfen nicht unbeabsichtigt unterschritten werden.

## Betroffene Bereiche

- `extensions/permissions/verifier-policy.ts`
- `pi-subagents`-Schema und Executor

## Verbindliche Regeln

1. Eingaben zuerst in ein kanonisches internes Launch-Schema normalisieren.
2. `timeoutMs`, `maxRuntimeMs` und weitere aktive Aliase gleichwertig prüfen.
3. Verifier- und Debugger-Profile besitzen ein serverseitig erzwungenes Mindestbudget.
4. Ein vom Nutzer erlaubter regulärer Abbruch bleibt möglich; das Mindestbudget ist kein Unabbrechbarkeitsversprechen.
5. Nicht unterstützte oder widersprüchliche Alias-Kombinationen ablehnen.

## Todos

- [ ] Aktives Schema und alle Aliasauflösungen gegen die Policy abgleichen.
- [ ] Normalisierung auf einen internen Timeout-Wert implementieren.
- [ ] Mindestbudget und Maximalbudget pro Rolle definieren.
- [ ] Konflikte zwischen Aliasen und Profildefaults festlegen.
- [ ] Tests für `maxRuntimeMs:1`, Profildefault und regulären Cancel ergänzen.

## Pflicht-Regressionstests

- `maxRuntimeMs:1` wird blockiert oder auf sicheren Mindestwert normalisiert.
- `timeoutMs` und `maxRuntimeMs` erzeugen dieselbe Policyentscheidung.
- Profildefault wird nicht durch einen Alias unterschritten.
- Timeout bleibt `incomplete` und wird nie PASS.

## Abnahmekriterien

- Der Auditfall mit Millisekundenbudget kann die Prüfung nicht verkürzen.
- Alle aktiven Schemafelder sind in der Policy abgedeckt.
- Budgetentscheidungen sind im Run-Ticket sichtbar.

## Abhängigkeiten

- AGENT-001 für Run-Ticket und effektive Parameter.

## Risiken

- Einige legitime Debugging-Szenarien werden früher abgebrochen.

## Erforderlicher Abschlussnachweis

PR mit kanonischem Launch-Schema und Alias-Testmatrix.
