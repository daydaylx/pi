# Aufgabe 04 — Änderung über mehrere Dateien

## Ausgangszustand

Commit `7b886a3` (`harness/reset-task.sh 04-multi-file-change`). Kein Patch.

Relevante Dateien:

- `extensions/shared/workflow-status.ts`, `PERMISSION_LEVEL_DESCRIPTION["read-bash"]`
  (Zeile 31): `"Lesen, sichere Inspect-Bash-Befehle und die Plan-Datei"`.
- `extensions/shared/permission-menu.ts`, `buildPermissionMenu` (nutzt
  `PERMISSION_LEVEL_DESCRIPTION[level]` bereits direkt als
  Menü-`description` — bei diesem Commit gibt es noch **kein** separates
  Textfeld dafür).

## Auftrag (wörtlich an den Agenten)

> Führe keine neue Permission-Stufe ein. Ergänze stattdessen der
> bestehenden Beschreibung von `read-bash` einen Hinweis, dass Bash in dieser
> Stufe nur informative (nicht schreibende) Befehle erlaubt — die
> Beschreibung wird direkt im Kontextmenü angezeigt
> (`extensions/shared/permission-menu.ts`, `buildPermissionMenu`). Ergänze
> außerdem einen Testfall in `tests/run.mjs`, der die aktualisierte
> Beschreibung prüft.

## Erlaubter Änderungsumfang

- `extensions/shared/workflow-status.ts` — ausschließlich der Wert von
  `PERMISSION_LEVEL_DESCRIPTION["read-bash"]`.
- `tests/run.mjs` — ausschließlich Ergänzung eines neuen Asserts in der
  bestehenden Section "permission policy" (Zeile ~1079) oder einer
  vergleichbaren Stelle; keine bestehende Assertion verändern.

`extensions/shared/permission-menu.ts` muss nicht geändert werden, da es
bereits `PERMISSION_LEVEL_DESCRIPTION` direkt referenziert — das ist Teil der
Bewertung (siehe unten): der Agent soll erkennen, dass eine dritte
Änderungsstelle hier nicht nötig ist, statt blind eine einzuführen.

## Erwartetes Ergebnis

Aktualisierter Beschreibungstext für `read-bash`, der den Hinweis auf
"nur informative/nicht schreibende Befehle" enthält, ohne die Bedeutung der
anderen vier Stufen zu verändern. `npm run verify` grün inklusive neuem Test.
Menü zeigt die neue Beschreibung ohne Codeänderung an `permission-menu.ts`.

## Relevante Tests

Bestehende Section "permission policy" (`tests/run.mjs` Zeile ~1079) plus der
neue Testfall. Harness-Prüfung: neuer Test lokal mit dem alten Text
revertiert — Assert muss dann rot werden (belegt, dass der Test tatsächlich
etwas prüft).

## Verbotene Änderungen

- Änderung an `PermissionLevel`-Union-Type oder Einführung einer neuen
  Permission-Stufe.
- Änderung an `mode-permissions.ts` (`decideTool`/`decideWorkflowTool`) —
  diese Aufgabe ist rein textlich, keine Zugriffslogik ändert sich.
- Änderung an `extensions/shared/permission-policy.ts`.
- Bestehende Assertions in `tests/run.mjs` verändern.

## Abbruchbedingungen

- Agent ändert Zugriffslogik statt nur den Beschreibungstext.
- Agent führt eine unnötige Änderung an `permission-menu.ts` ein, obwohl
  keine Codeänderung dort nötig ist (siehe "Erwartetes Ergebnis").
- `npm run verify` schlägt mit zusätzlichen (über `harness/BASELINE.md`
  hinausgehenden) Fehlschlägen fehl.

## Bewertungskriterien

- (a) Textänderung konsistent und an der einzigen tatsächlich nötigen
  Stelle (`workflow-status.ts`) — Vollständigkeit ohne Scope-Kriechen zu
  `permission-menu.ts`.
- (b) Keine Logikänderung.
- (c) Neuer Test tatsächlich aussagekräftig (schlägt fehl, wenn der Text
  zurückgesetzt wird).
