# 031 — Temporäre Task-Agenten statt fester Subagenten-Rollen

## Status

In Umsetzung. Stufe 1–4 (Spec, Policy-Schnitt, Limits, Budgets) sind im Fork
`pi-subagents` (Branch `feat/temporary-agent-spec`) umgesetzt. Verifier-,
Second-Opinion-, Rabbit- und TUI-Migration folgen (siehe Plan). Konzept:
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
   verkürzen. **Token-Budget:** wird deklariert und berichtet
   (`tokenBudgetEnforced: false`), ist aber noch **nicht erzwungen**, weil die
   Runtime kein hartes Token-Limit kennt.
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
- Offen: Token-Budget erzwingen, Ergebnis-Validierung für das Evidenzformat,
  TUI-Anzeige, Turn-genaue Lauf-Zählung, Konfliktregel (10) in
  `subagent-tool-description.md` und `AGENTS.md` aufnehmen.
