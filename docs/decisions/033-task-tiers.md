# 033 — Task-Klassen FAST/NORMAL/DEEP

## Status

Umgesetzt (Extension `extensions/task-tier/`, Abschnitt „Aufgabenklassen“ in
`AGENTS.md`).

## Kontext

Einfache, lokale Aufgaben erzeugten unverhältnismäßigen Overhead: breite
Exploration, wiederholte Reads, globale Verify-Kette, Subagenten und
durchgehend `high`-Thinking. Vor dieser Entscheidung gab es kein aktives
Task-Routing (`/route` war bereits entfernt, der Menüeintrag in
`plan-mode/command-center.ts` ist verwaist).

## Entscheidung

Eine kleine, rückbaubare Extension klassifiziert jeden Turn per Heuristik
(`classify.ts`, reine Funktion) in `fast`, `normal` oder `deep`:

- **deep:** Plan Mode aktiv, Schlüsselwörter (Security, Permission,
  Architektur, Migration, Refactoring, Protokoll, Dependency, Verifier …) oder
  ein genannter Hard-Verifier-Pfad (`verifier-required-paths.ts`).
- **fast:** kurzer Auftrag, ≤ 3 genannte Pfade, ≤ 2 Listenpunkte, keine
  breiten Signale.
- **normal:** alles andere und Default bei Unsicherheit — bisheriger Ablauf,
  keine Prompt-Injektion, kein Thinking-Eingriff.

Wirkung:

| Klasse | Prompt-Zusatz             | Thinking                                      | Subagenten/Verifier | Duplicate-Read-Guard |
| ------ | ------------------------- | --------------------------------------------- | ------------------- | -------------------- |
| fast   | FAST-Regeln + Stop-Regel  | senkt auf `low` (≤ 120 Zeichen) bzw. `medium` | technisch geblockt  | ja                   |
| normal | keiner                    | unverändert                                   | wie bisher          | ja                   |
| deep   | DEEP-Hinweis + Stop-Regel | hebt auf mindestens `high`                    | wie bisher          | nein                 |

**Release-Aktionen und Fortsetzungen** (Nachtrag 2026-10-01): Prompts mit
commit/push/merge/publish/release/deploy/PR sind nie `fast` (mindestens
`normal`), weil AGENTS.md vor Commit/Push einen Verifier verlangt, FAST ihn
aber sperrt. Kurze Fortsetzungs-Prompts („weiter“, „ja“) erben die höhere
Klasse des Vorgänger-Turns (inkl. Eskalation).

**Eskalation** (nur aufwärts, mit einmaliger Steering-Nachricht): FAST → NORMAL
bei > 2 Suchen oder > 6 Reads vor dem ersten Edit bzw. > 3 geänderten Dateien;
→ DEEP beim Edit eines Hard-Verifier-Pfads. Die Sperre für Subagenten/Verifier
entfällt damit.

**Duplicate-Read-Guard:** ein `read`, dessen Zeilenbereich bereits von einer
früheren, nicht gekürzten Ausgabe derselben unveränderten Datei (mtime/Größe)
abgedeckt ist, wird blockiert. `edit`/`write` invalidieren; Kompaktierung und
Sitzungsstart setzen zurück.

**Thinking:** automatische Änderungen werden über `shared/auto-thinking.ts`
markiert, damit `permissions/thinking-control.ts` sie nicht als manuelle Wahl
persistiert; am Turn-Ende wird das ursprüngliche Level wiederhergestellt,
sofern der Nutzer es zwischenzeitlich nicht selbst geändert hat.

**Telemetrie:** pro Turn ein Session-Eintrag `task-tier.turn` (Klasse,
Eskalationen, Searches, Reads, blockierte Duplicate-Reads, Edits, Commands,
Subagent-/Verifier-Aufrufe, Thinking, Dauer). Tokenverbrauch kommt weiter aus
`benchmarks/duel/usage.py`.

## Nicht geändert

Plan Mode, Permission-Kern, Verifier-Katalog und Need-Gate, Commit-Gate,
Subagenten-Limits. Die Sicherheitsgrenzen werden nicht gelockert: der Hard-
Pfad-Katalog gilt unverändert, und Hard-Pfad-Änderungen führen zu DEEP.

## Rückbau

`"+extensions/task-tier/index.ts"` aus `settings.json` (und `knip.json`)
entfernen und die Erwartungsliste in `tests/suites/runtime/target-config.mjs`
anpassen; optional den Abschnitt „Aufgabenklassen“ in `AGENTS.md` und die
Sonderregel bei der `verify`-Pflicht streichen. `shared/auto-thinking.ts`
bleibt dann wirkungslos.
