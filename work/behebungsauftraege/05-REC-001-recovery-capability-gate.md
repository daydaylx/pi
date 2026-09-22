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
5. Der bewusst dokumentierte YOLO-Bypass bleibt eine separate, explizite Produktentscheidung.

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
