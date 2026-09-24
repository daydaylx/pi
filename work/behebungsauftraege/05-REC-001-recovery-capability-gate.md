# REC-001 — Recovery-Gate sperrt nicht alle mutierenden Fähigkeiten

## Priorität und Ziel

- **Priorität:** P1, hoch
- **Bereich:** Recovery, Security, Robustheit
- **Ziel:** Nach einem Recovery-pflichtigen Fehler darf keine mutierende oder indirekt ausführende Fähigkeit das Gate umgehen.

## Betroffene Bereiche

- `extensions/permissions/guards.ts`
- `extensions/permissions/tool-policy.ts`
- `extensions/setup-core/index.ts`
- `project_check`, `verify`, `subagent` und Custom-Tools

## Verbindliche Regeln

1. Recovery entscheidet nach Capability, nicht nach Toolnamen.
2. `writes`, `executesProjectCode`, `delegates` und externe Seiteneffekte gelten als mutierend oder potenziell mutierend.
3. `project_check` wird nach Profil klassifiziert; nur ausdrücklich rein lesende Profile dürfen separat freigegeben werden.
4. Fehlender, unbekannter oder nicht scharfer Recovery-Status darf nicht als pauschale Freigabe für mutierende Pfade dienen.
5. YOLO-Stufen umgehen das Recovery-Integritätsgate nicht; der Gate gilt unabhängig von der Permission-Stufe (ADR 016 und ADR 029).

## Todos

- [ ] Alle Tool-Einstiege und indirekten Prozesspfade inventarisieren.
- [ ] Capability-Klassifizierung aus SEC-001 übernehmen.
- [ ] Recovery-Prüfung vor `project_check`, `verify`, `subagent` und weiteren Custom-Tools erzwingen.
- [ ] Rein lesende Profile formal definieren.
- [ ] Unknown/fehlender Status konservativ behandeln.
- [ ] Recovery-Entscheidung und Grund im State/Result sichtbar machen.
- [ ] TUI- und Headless-Verhalten getrennt testen.

## Pflicht-Regressionstests

- Scharfes Recovery-Gate plus mutierendes `project_check`.
- Scharfes Gate plus fehlende Dependency-Installation.
- Scharfes Gate plus Subagent mit Prozessausführung.
- Rein lesender Check darf nach festgelegter Regel laufen.
- Unknown Recovery-Status darf keine mutierende Freigabe erzeugen.
- YOLO verhält sich nur in der dokumentierten expliziten Konfiguration anders.

## Abnahmekriterien

- Kein mutierender oder indirekt ausführender Pfad umgeht ein scharfes Gate.
- `project_check` und Delegation werden tatsächlich geprüft.
- Rein lesende Diagnosen bleiben möglich, sofern ihr Profil dies garantiert.
- Die Entscheidung ist im Tool-Result und im TUI-State nachvollziehbar.

## Abhängigkeiten

- SEC-001 und SEC-002: gemeinsame Capability- und Pfadklassifizierung.
- AGENT-001: Verifier-Start darf Recovery nicht umgehen.

## Risiken

- Ein pauschales Verbot aller Checks kann legitime Recovery-Diagnosen blockieren.
- Projektprofile mit versteckten Seiteneffekten können nur bei konservativer Einstufung sicher behandelt werden.

## Erforderlicher Abschlussnachweis

PR mit Capability-Matrix, Guard-Tests für alle genannten Tools und einem echten Prozess-Effekt-Test.

## Umsetzungsstand

Die Recovery-Wirkung wird über eine gemeinsame Capability-Klassifikation bestimmt:

- bekannte Nur-Lese-Tools und `recovery_check` bleiben frei;
- Prozessaufrufe, Delegation und unbekannte Tools gelten konservativ als potenziell mutierend;
- fehlender oder ungültiger Recovery-Status sperrt potenziell mutierende Fähigkeiten;
- der Gate läuft unabhängig von der YOLO-Stufe und verwirft Antworten aus einer inzwischen gewechselten Session.

Regressionen decken Prozess-/Delegationspfade, Custom-Tools, YOLO-Stufen, Provider-Ausfall und fehlerhafte Marker ab. `PI_TEST_SUITE=runtime node tests/run.mjs` ist zuletzt mit 1.807 Assertions erfolgreich gelaufen.
