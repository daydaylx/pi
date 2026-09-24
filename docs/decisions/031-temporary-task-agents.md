# 031 — Temporäre Task-Agenten statt fester Subagenten-Rollen

## Status

In Umsetzung. Stufe 1–4 (Spec, Policy-Schnitt, Limits, Budgets) liegen im Fork
`pi-subagents` (Branch `feat/temporary-agent-spec`), Stufe 2 und 5 (Guard, Verify-Übersetzung) im Repo `pi`. Second Opinion ist als konform dokumentiert (kein Umbau). Rabbit- und TUI-Migration folgen (siehe Plan). Konzept:
`pi-temporary-subagents-konzept.md`.

## Kontext

Feste Rollen (`investigator`, `debugger`, `verifier`, `rabbit-*`) müssen
gepflegt werden, und ihre Grenze besteht nur aus der `tools:`-Frontmatter der
Rollendatei. Ein Subagent soll keine kleinere autonome Pi-Instanz sein,
sondern eine begrenzte Arbeitseinheit.

## Entscheidung

Der Hauptagent erzeugt bei echtem Bedarf einen `TemporaryAgentSpec`
(`spec` statt `agent` im `subagent`-Tool): `objective`, `profile`
(`analyse | research | verify | implement`), `delegationReason`, optional
`context`, `scope`, `expectedOutput`, `requestedCapabilities`,
`modelPreference`, `constraints`.

Grundsatz:

> **Der Main Agent definiert die Arbeit. Die Runtime definiert die Grenzen.
> Evidenz entscheidet über das Ergebnis.**

### Verbindliche Regeln

1. **Stateless.** Kein Memory, keine dauerhafte Identität, kein Kontext aus
   früheren Läufen. Der Agent existiert nur im Speicher (`filePath:
"<temporary>"`), wird nie als Rollendatei geschrieben und danach verworfen.
2. **Minimaler Kontext.** `inheritProjectContext: false`, `inheritSkills:
false`, immer `context: "fresh"` (`fork` wird abgelehnt). Übergeben wird nur
   der zu `objective`, `scope`, `expectedOutput` gehörende Kontext.
3. **Modellwahl gehört der Runtime.** Der Main nennt eine Klasse (`fast`,
   `cheap`, `strong`, `independent`) oder eine `provider/model`-Id. Klassen
   werden über `config.temporaryAgents.modelClasses` abgebildet, sonst gilt das
   Runtime-Default. Explizite Modelle laufen weiter durch den `modelScope`-
   Allow-List-Check.
4. **Budgets.** Pro Agent: Laufzeit, Tool-Calls, Turns; gesamt: reservierte
   Laufzeit je Sitzung. Nach dem harten Tool-Limit werden alle Tools
   gesperrt, der Agent kann nur noch abschließen. Alle Werte sind über
   `config.temporaryAgents` konfigurierbar. Der Main kann eine Laufzeit nur
   verkürzen. **Token-Budget:** kumulierte Assistant-Tokens
   (Input + Output über alle Turns). Erreicht der Agent das Limit, sperrt der
   Kindprozess alle Tools und weist den Agenten einmal an abzuschließen; die
   Durchsetzung läuft im Kind und gilt daher für Vorder- und Hintergrundläufe.
   Default 500 000, konfigurierbar über `config.temporaryAgents`.
5. **Abbruch und Status.** `running | completed | failed | aborted |
timed_out | policy_blocked`. Ein abgebrochener oder abgelaufener Lauf gilt
   nie als `completed`. Abbruch nutzt die bestehenden Aktionen `stop` und
   `interrupt`.
6. **Evidenz statt Confidence.** Keine Prozentwerte. Ergebnisse trennen
   Beobachtung, Schlussfolgerung, offene Annahme und verbleibende Unsicherheit.
7. **Provenienz.** Jeder Befund nennt Quelle (Datei + Stelle bzw. Kommando)
   und Grund.
8. **Keine versteckte Delegation.** `details.temporaryAgent` trägt Name,
   Objective, Begründung, Profil, Scope, Modell (+ Quelle), Schreibrecht,
   effektive/verweigerte Fähigkeiten, Budgets und Status. TUI/Telemetrie
   zeigen diese Felder statt einer Rollenbezeichnung.
9. **Keine Agent-zu-Agent-Kommunikation.** Temporäre Agenten erhalten weder
   `subagent` noch die Intercom-Bridge (`intercom`, `contact_supervisor`) und
   haben `maxSubagentDepth: 0`. Ergebnisse laufen nur über den Main Agent.
   Rabbit darf später kontrollierte Erweiterungen erhalten, aber keine
   unbegrenzte Peer-to-Peer-Orchestrierung.
10. **Widersprüche.** Der Main entscheidet weder per Mehrheit noch nach
    Fertigstellungsreihenfolge oder Modellstärke. Er identifiziert die
    widersprüchlichen Aussagen, vergleicht die Evidenz, prüft bei Bedarf selbst
    nach oder startet einen gezielten Verifikations-Task und behandelt
    verbleibende Unsicherheit transparent. **Evidenz entscheidet, nicht
    Agentenzahl oder Modellname.**
11. **Autorität.** Subagenten besitzen keine eigene Entscheidungsautorität
    über den Hauptlauf. Sie liefern begrenzte Arbeitsergebnisse.
    Verantwortung, Integration und endgültige Entscheidungen verbleiben beim
    Main Agent.

### Runtime-Rechte

`effective = requested ∩ Profil-Erlaubnis`. `write`, `network`, `spawn`
werden nicht vergeben; `implement` liefert derzeit keine Tools und wird als
`policy_blocked` abgelehnt (nur der Main schreibt). `readonly_shell` (`bash`)
gibt es nur im Profil `verify`. Verweigerte Fähigkeiten stehen in
`denied` und im Task-Text des Kindes.

### Verify-Profil

Das Verifier-Ticket bindet Agenten-Definition (Modell, Prompt), Dedup und
Commit-Gate (ADR 017, 021) an den Namen `verifier`. Ein synthetischer Agent
würde diese Bindung umgehen. Deshalb übersetzt die Guard-Schicht einen Spec mit
`profile: "verify"` deterministisch in den geprüften Verifier-Aufruf
(`agent: "verifier"` + Vorlagen-Task), bevor `assessVerifierDelegation` läuft.
Der Main sieht nur die Spec-API; die Prüfkette bleibt unverändert.

`spec.verification` ist Pflicht (`originalRequest`, `delegatedQuestion`,
`diff`, `baseline`, `acceptance`, optional `reverificationJustification`).
`modelPreference`, `requestedCapabilities`, `model`, `cwd`, `output`, Budgets
und `context: fork` sind für Verify verboten. `agents/verifier.md` bleibt als
technische Profildefinition bestehen; der Alias `agent: "verifier"` gilt
während der Übergangsphase weiter und entfällt in Stufe 8.

### Second Opinion

`second_opinion` (`extensions/second-opinion`) ist bewusst kein Subagent und
keine Rolle, sondern ein einzelner Provider-Aufruf ohne Kindprozess. Es
erfüllt die Regeln bereits ohne Umbau:

| Regel                    | Umsetzung in `second_opinion`                                                        |
| ------------------------ | ------------------------------------------------------------------------------------ |
| 1 stateless              | Ein Aufruf, keine Identität, kein Memory, kein Kontext aus früheren Läufen           |
| 2 minimaler Kontext      | Nur `contextRefs` (Codebereiche, Diff, Testzusammenfassung) im Kontext-Manifest      |
| 3 Modellwahl             | Runtime wählt das Modell und bevorzugt ein anderes Backend; Main nennt keins         |
| 4 Budgets                | Kontext-Budget (`context_budget_exceeded`), Timeout (`timeout`)                      |
| 5 Status                 | `completed`, `cancelled`, `timeout`, `denied`, `unavailable`, `provider_error`, …    |
| 6/7 Evidenz, Provenienz  | `strongestCounterargument`, `missingEvidence`, Referenzen auf das Manifest           |
| 8 Sichtbarkeit           | Approval-Snapshot mit Frage, Grund, Modell und Kontext; Telemetrie `second_opinion`  |
| 9 keine Kommunikation    | Kein Tool-Zugriff, kein Nachrichtenkanal zu anderen Agenten                          |
| 11 Autorität             | Rein beratend; der Main entscheidet                                                  |

Bewusst unverändert: das Feld `confidence` bleibt eine grobe Stufe
(`low | medium | high`), keine Prozentangabe, und steht neben Gegenargument und
fehlender Evidenz. Es ist kein primärer Bewertungsgrund. Jeder Aufruf schreibt
außerdem einen Eintrag in die gemeinsame `run-history.jsonl` (Agent
`second_opinion`, Kategorie und Decision-Id, Ergebnis, Latenz, Tokens; nie
Frage, Kontext oder Antwort). Alles außer `completed` steht als Nicht-Erfolg
darin.

### Limits (vorläufig)

5 temporäre Agenten pro Lauf und 5 Spawns pro Sitzung (`maxPerRun`,
`maxSubagentSpawnsPerSession`). Der Zähler „pro Lauf“ wird derzeit je Sitzung
geführt und beim Sitzungsstart zurückgesetzt; eine echte Turn-Grenze folgt.
Das Konzept nennt 3 als Zielwert; der Wert bleibt konfigurierbar.

## Bewusst nicht eingeführt

Keine neuen festen Rollen, keine Personality-Systeme, kein Messaging-Bus,
keine automatischen Agentenketten, keine LLM-basierten Metaentscheidungen, wo
deterministische Runtime-Regeln genügen.

## Folgen

- Bestehende Rollenpfade bleiben, bis Verifier (an Profil `verify` gebunden),
  Second Opinion und Rabbit migriert und getestet sind.
- Tests: `test/unit/temporary-spec.test.ts`,
  `test/integration/temporary-spec-executor.test.ts` im Fork.
- Rabbit: `PI_RABBIT_MAX_STEPS`, `PI_RABBIT_MAX_PARALLEL`,
  `PI_RABBIT_MAX_DEPTH` konfigurieren die Orchestrierungsgrenzen (mit harten
  Obergrenzen, Defaults 12/3/2).
- Offen: Ergebnis-Validierung für das Evidenzformat (heute nur im Task-Text
  gefordert, nicht geprüft), Turn-genaue Lauf-Zählung, das Entfernen der festen
  Rollen `investigator` und `debugger` samt Plan-Mode-Ausnahme und Rabbit-
  Rollenbibliothek. Der `verifier` bleibt als technisches Profil der
  Verifier-Kette bestehen.
