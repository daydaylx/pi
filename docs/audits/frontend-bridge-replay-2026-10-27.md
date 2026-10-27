# Frontend-Bridge Replayprüfung — 2026-10-27

## Baseline und Scope

- Pi-Repository: `/home/g/Projekte/pi`, Baseline `bc3b10c` (`fix(deps): use host typebox peer in pi-web-access`); Arbeitsbaum war bereits durch andere Änderungen belegt.
- M-20 betrifft nur `extensions/frontend-bridge/index.ts`, den Bridge-Consumer in `frontend-server/index.mjs` und deren Tests. Keine Liveinstallation oder Runtimeänderung.
- Vorher schrieb jeder Bridge-Flush dieselben sechs Projektionen (`permissions`, `lsp`, `changes`, `verification`, `task`, `subagents`) als vollständiges Objekt, auch wenn nur ein Feld geändert war.

## Replay-Kriterium

Sessioneinträge werden in Reihenfolge abgespielt. Für jedes vorhandene Top-Level-Feld ersetzt der Eintrag den vorherigen Wert; nicht enthaltene Felder bleiben unverändert. Nullable Felder (`changes`, `verification`) behalten `null` als expliziten Löschwert; Arrays wie `subagents` ersetzen vollständig. Alte Volleinträge bleiben gültig. Der Server beginnt mit seinen dokumentierten Defaultwerten; nicht geänderte Defaults müssen nicht erneut im Sessionlog stehen.

## Klassifikation und Änderung

- `permissions`: fachlicher Zustand bleibt anderweitig durch Permissions-Sessioneinträge erhalten; Bridge-Ereignisse sind die Frontendprojektion. Geänderte Werte werden weiterhin protokolliert.
- `verification`: Verifier-Runs bleiben ihre dauerhafte Quelle; Bridge-Projektionen bei Änderungen bleiben erhalten.
- `lsp` und `changes`: aktuelle Statusprojektionen; Änderungen bleiben protokolliert, identische Wiederholungen entfallen.
- `task`: Titel/Phase-Projektion; geänderte Werte bleiben protokolliert, der Default wird aus Serverzustand bezogen.
- `subagents`: flüchtige Runprojektion; Start, Attention und Abschluss bleiben protokolliert, Abschluss persistiert weiterhin die leere Liste.
- Runmanifeste und Aktionsbelege liegen in getrennten Entry-Typen/Stores und wurden nicht verändert.

Bridge-Flushes enthalten jetzt nur geänderte Top-Level-Felder. Beim Replay einer alten Volleingabe mit darauffolgendem Sparse-Entry bleiben alle nicht berührten Felder erhalten. Die Tests prüfen diesen Mischfall und die Sessiongrenze. Der Abschluss eines Subagenten schreibt nur noch `subagents: []`, statt alle anderen Bridgewerte zu duplizieren; der Test vergleicht die serialisierte Payloadgröße mit dem vorherigen Volleintrag.

## Testergebnis

Siehe [frontend-bridge-replay-tests-2026-10-27.log](../evidence/frontend-bridge-replay-tests-2026-10-27.log). Der Runtime-Lauf wurde nach einer zunächst veralteten Testannahme korrigiert und erneut ausgeführt. Die Prüfungen decken alte Vollform, Sparse-Replay, Epoch-Isolation, Sessionreset, Null-/Array-Replacement sowie gewöhnliche TUI ohne Bridgeeinträge ab.

## Einschränkungen / Rückweg

- Keine Live-Wiederöffnung einer historischen Session, da dies eine aktive GUI/Runtime erfordert und für diese Optimierung nicht freigegeben war. Abnahme bezieht sich auf den getesteten Session-Event-Replay und Frontend-Server-Merge.
- Bei Bedarf kann die Änderung lokal durch Wiederherstellung der Vollprojektion in `extensions/frontend-bridge/index.ts` zurückgenommen werden; der Server liest alte Voll- und neue Teilobjekte weiterhin über dieselbe Mergebehandlung.
