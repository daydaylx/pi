# 042 — Blockaden ohne UI sind für zwei Aufrufe weich (2026-10-18)

## Status

Angenommen, 2026-10-18. Ergänzt 041 und die Ausnahme für Subagenten-Kinder (Commit `df5091f`).

## Fragestellung

Ohne UI (`print`, `json`, `rpc` ohne Dialogkanal) beendete bisher jede einzelne Blockade den
ganzen Lauf (`stopNonInteractive`, `terminate: true`). Das gilt auch für `ask_user` und
`workspace_add`, die ohne UI nur unmöglich sind, aber nichts Gefährliches tun. Wie viel Härte
ist dort nötig, ohne die Sperren zu schwächen?

## Befund

- Duell 003 (30.09.): Pi kam nach einer verweigerten Löschung nur über Auto-Antworten weiter.
- Pi-vs-Codex-Aufgabe `t3` (18.10.): `chmod +x … && bash -n …` wurde als „opaker
  Interpreteraufruf“ blockiert, der Lauf endete mit nicht ausführbarem Skript (0/18 versteckte
  Tests, in den beiden Läufen davor 17/18 und 18/18).
- `lager` L1–L3 (18.10.): `workspace_add` (aus dem Projektnamen geraten) und danach `ask_user`
  endeten den Lauf nach 7 Sekunden ohne Änderung.
- Subagenten-Kinder beenden sich seit `df5091f` nicht mehr an einer Einzelblockade; der
  Wiederholungsschutz fängt Schleifen.

## Entscheidung

- Ohne UI erhalten die ersten **zwei** Blockaden eines Laufs `terminate` nicht; die Begründung
  nennt den Weg über eine zulässige lokale Alternative und die Pflicht, die Blockade im Abschluss
  zu nennen. Die dritte Blockade beendet den Lauf wie bisher (`HEADLESS_SOFT_BLOCK_LIMIT = 2` in
  `extensions/permissions/guards.ts`). Der Zähler wird mit jedem Lauf (`agent_start`) zurückgesetzt.
- `ask_user` ohne UI folgt demselben Budget (zwei weiche Fehlschläge, dann Ende).
- **Unverändert:** welche Aktionen blockiert werden, die TUI, die Subagenten-Regeln, der
  Wiederholungsschutz (drei identische Blockaden beenden den Lauf) und der Stop-Hinweis auf
  stderr samt Eintrag `permissions.headless-stop`.

## Folgen

- Läufe ohne UI brechen bei einer einzelnen unmöglichen Aktion nicht mehr ab; das Modell kann
  eine zulässige lokale Alternative wählen.
- Es gibt keinen neuen Weg um eine Sperre: dieselbe Aktion bleibt blockiert, ein Umweg über
  alternative Schreibwege bleibt durch die Regel in `AGENTS.md` ausgeschlossen.
- Kosten: bis zu zwei zusätzliche Modellrunden pro Lauf.
