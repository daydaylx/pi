# 015 — Verifier-Delegationen werden technisch erzwungen, nicht appelliert

## Kontext

Die Verifier-Zuverlässigkeit hing bisher an Textregeln in `AGENTS.md` und
`docs/subagents.md`: vollständiger Prüfauftrag mit Diff und Baseline, kein
eng geschätztes `turnBudget`, Fallback nur bei Provider-Fehlern. Regeln und
Runtime liefen auseinander:

- Unvollständige Delegationen starteten trotzdem; der Verifier verbrauchte
  sein Budget mit Selbstbeschaffung von Diff/Baseline oder lieferte
  `UNVERIFIABLE`.
- Per Run gesetzte `turnBudgets` kappten Läufe mitten in der Prüfung; ein
  solcher Abbruch war äußerlich kaum von einem echten Urteil zu
  unterscheiden und wurde gelegentlich wie ein bestandener Lauf behandelt.
- Das in `extensions/subagent/config.json` gesetzte
  `toolSchemaMode: "harness"` (Entscheidung 014) ist im installierten
  `pi-subagents` (`npm/node_modules`, Version 0.34.0 ohne diesen Schlüssel)
  wirkungslos — die reduzierte Tool-Surface ist faktisch nicht aktiv. Die
  Erzwingung durfte deshalb nicht auf Paket-Schemata bauen, deren Existenz
  von der installierten Version abhängt.

## Entscheidung

Die Erzwingung liegt vollständig in Auroras Guard-Schicht und wirkt
unabhängig vom Subagenten-Paket:

1. **Vollständigkeitsprüfung vor dem Start.**
   `extensions/permissions/verifier-policy.ts` blockt jeden
   `subagent`-Aufruf mit `agent: "verifier"` (ohne Management-`action`),
   dessen `task` die Pflichtabschnitte der Delegationsvorlage vermissen
   lässt: `Original User Request:`, `Delegated Question:`,
   `Implementation / Diff to verify:`, `Pre-existing workspace state` und
   einen Acceptance/Akzeptanz-Abschnitt. Der Blocktext nennt die fehlenden
   Abschnitte.
2. **`turnBudget` ist für Verifier verboten.** Ein per Run gesetztes
   `turnBudget` wird vor dem Start geblockt; maßgeblich bleibt ausschließlich
   das Profil-`timeoutMs` aus `agents/verifier.md`.
3. **INCOMPLETE ist ein eigener Zustand.**
   `extensions/setup-core/subagent-output-guard.ts` leitet aus jedem
   Verifier-Tool-Result einen `verifier-run`-Session-Eintrag ab. Abbruch,
   Zeitüberschreitung, Turn-Budget, Detach oder Exit≠0 ergeben
   `status: "incomplete"` mit benanntem Grund und einem sichtbaren
   INCOMPLETE-Vorsatz im Tool-Result; solche Läufe zählen nie als
   unabhängige Verifikation. Ein fachliches `FAIL` bei Exit 0 bleibt
   `completed` mit `verdict: "FAIL"`.
4. **Fallback bleibt Provider-Fehlern vorbehalten.** Das installierte Paket
   bricht die Fallback-Kette bei Erfolg, Timeout, Turn-Budget und Detach ab
   und fällt nur bei `isRetryableModelFailure`-Mustern zurück; Tests gegen
   das installierte Paket zementieren das.

`AGENTS.md` und `docs/subagents.md` beschreiben seither nur noch diesen
technisch erzwungenen Ablauf; die Appell-Formulierungen („großzügig wählen",
„nicht raten") sind entfernt.

## Konsequenzen

- Die Verifier-Erzwingung überlebt Paket-Updates und Versionsdrift, weil sie
  vor dem Executor in der Guard-Schicht entscheidet.
- Der Paket-Drift selbst (`toolSchemaMode` ohne Wirkung, gepinnter Fork-SHA
  nicht in der lokalen Clone-Historie) bleibt ein dokumentierter, separater
  Folgeschritt; er verlangt Paketinstallationen und ist bewusst nicht Teil
  dieser Entscheidung.
- `verifier-run`-Einträge sind die strukturierte Quelle für
  `/session-health`; ältere Sessions ohne diese Einträge erscheinen in der
  Verifier-Auswertung nicht.

## Alternativen

- **Reparatur der Paketinstallation zuerst:** korrekt aufgelöster Fork mit
  wirksamem `toolSchemaMode`. Verworfen als alleinige Lösung, weil die
  Erzwingung dann an der installierten Version hinge und
  Paketinstallationen erfordert hätte; sie bleibt möglicher Folgeschritt.
- **Nur Prompt-/Doku-Regeln:** Status quo. Verworfen, weil er nachweislich
  zu Regel-Runtime-Drift und INCOMPLETE-Läufen ohne klare Kennzeichnung
  geführt hat.
