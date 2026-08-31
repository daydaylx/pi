# METHODOLOGY — P5-LUNA-HARNESS

## Ziel

Isolieren, welchen Qualitätsgewinn/-verlust der Pi-Harness gegenüber der echten OpenAI-Codex-CLI verursacht, wenn beide Seiten exakt dasselbe Modell (`gpt-5.6-luna`) verwenden. Verglichen wird der Harness-Effekt, nicht das Modell.

## Modus A — Core Parity (diese Serie)

- Gleiches Modell, gleicher Reasoning Effort (`high`)
- Keine Subagenten-Pflicht auf keiner Seite (Pi: Investigator/Debugger dürfen aufgerufen werden, wenn AGENTS.md das vorsieht, sind aber nicht erzwungen; Verifier ist explizit deaktiviert)
- Kein Webzugriff (Codex: OS-Sandbox `workspace-write`; Pi: `pi-web-access`-Paket aus dem Worktree-Overlay entfernt — siehe „Bekannter Confounder: Netzwerk-Asymmetrie" unten)
- Gleiche Filesystem-Rechte (beide Seiten dürfen im Worktree lesen/schreiben)
- Gleicher Task-Prompt (identischer `benchmarks/v2/tasks/<id>/PROMPT.md` für beide Seiten)
- Gleicher Evaluator (identischer `evaluator.mjs`-Code aus `PI_BENCHMARK_PRIVATE_ROOT`, nach Abschluss beider Läufe gegen denselben Worktree-Zustand ausgeführt)

Modus B (Native Harness) ist nicht Teil dieser Serie.

## Referenzcommit und Modell-Backend

- Referenzcommit: `dd00b33f039b4c6d291b1c241aaae9eb66ba4b85` (aktueller HEAD zum Planungszeitpunkt, unabhängig von P3/P4).
- Pi-Seite: `openai-codex/gpt-5.6-luna` (baseUrl `https://chatgpt.com/backend-api`, 272K Kontext) — verifiziert dieselbe Backend-Route wie die lokal installierte Codex-CLI (`codex login status` → "Logged in using ChatGPT", Codex' `websocket`-Endpoint in `codex doctor` zeigt ebenfalls `wss://chatgpt.com/backend-api/...`). Bewusst NICHT `openrouter/openai/gpt-5.6-luna` oder `opencode-go/gpt-5.6-luna` (andere Infrastruktur, größeres Kontextfenster, andere `thinkingLevelMap`).
- Codex-Seite: `gpt-5.6-luna`, CLI-Version `0.149.1` (gepinnt für die gesamte Serie; `0.151.0` ist laut `codex doctor` verfügbar, wird bewusst nicht installiert).

## Reasoning-Effort-Verifikation

Vor dem ersten echten Lauf per Preflight (`p5/preflight/audit-thinking-level.mjs`) statisch **und** per direkter Quellcode-Prüfung bestätigt: Pi's `openai-codex/gpt-5.6-luna`-Eintrag hat kein `high`-Mapping in `thinkingLevelMap` (nur `xhigh`/`max`/`minimal`). Zwei unabhängige Codepfade im installierten Pi-Runtime-Bundle wurden geprüft:

1. `getSupportedThinkingLevels`/`clampThinkingLevel` (chunk-MNAIPA3J.js): nur `xhigh`/`max` erfordern einen expliziten Map-Eintrag; `high` gilt immer als unterstützt und wird nicht auf eine niedrigere Stufe geklemmt.
2. `buildRequestBody` (openai-codex-responses-*.js): `effort = model.thinkingLevelMap?.["high"] ?? "high"` — da kein Map-Eintrag existiert, wird der Literal-String `"high"` unverändert als `body.reasoning.effort` gesendet.

Codex CLI liest sein eigenes `reasoning_effort` direkt aus `turn_context` in der Rollout-JSONL — keine äquivalente Mapping-Kollisionsgefahr.

**Ergebnis:** `high` ist für beide Systeme sauber und unterscheidbar verwendbar; keine Notwendigkeit, auf eine "gemeinsame Stufe" auszuweichen.

## Task-Auswahl

| Kategorie                 | Task-ID                          | Status bei `dd00b33`                                                                                                 |
| ------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Kleine/präzise Aufgabe    | `05-refactor-no-behavior-change` | ✅ vollständig fixture-isoliert, unabhängig vom Referenzcommit                                                       |
| Bugfix                    | `02-local-bug`                   | ✅ vollständig fixture-isoliert                                                                                      |
| ~~Multi-Datei~~           | ~~`04-multi-file-change`~~       | ❌ **aus dem Piloten gestrichen** — Zielkonstrukt existiert nicht mehr (siehe unten)                                 |
| Lange Sitzung/Kontext     | `08-long-session-compaction`     | ✅ Prompt generisch, kein Dateibezug                                                                                 |
| ~~Hängender Tool-Aufruf~~ | ~~`09-hanging-tool-call`~~       | ❌ **aus dem Piloten gestrichen** — `.pi/lsp.json`-Profil-Setup fehlt noch (siehe ENVIRONMENT.md, "Bekannte Lücken") |

Der volle Pilot läuft damit mit **3 statt 5 Kategorien** (statt 5 Tasks × 2 Harnesses × 3 Wiederholungen = 30 Läufe: 3 Tasks × 2 Harnesses × 3 Wiederholungen = 18 Läufe). Auf Nutzerwunsch: keine neuen Aufgaben erfinden, konsistent mit der bereits bei Aufgabe 01 angewandten Linie "einfach, aussagekräftig, proportional".

### Warum `05-refactor-no-behavior-change` statt `01-single-file-change`

Die ursprünglich vorgesehene Aufgabe `01-single-file-change` (Git-Header-Rename-Kategorie) ist am Referenzcommit `dd00b33` nicht mehr ausführbar: `extensions/git-header.ts`/Funktion `summarizeStatus` wurde im Commit `9a4fed9` ("refactor: remove legacy paths, duplicate structures and dead runtime code") vollständig entfernt, keine äquivalente Stelle existiert mehr im Code (verifiziert: `find`/`grep` liefern keinen Treffer für die Kategorie-Strings, `git merge-base --is-ancestor 9a4fed9 dd00b33` bestätigt Vorfahre-Beziehung).

Auf Nutzerwunsch nach der "einfachsten, aussagekräftigsten, proportionalsten" Lösung wurde **keine neue Aufgabe erfunden** (das hätte einen komplett neuen Fixture+Evaluator erfordert) und **nicht** die Aufgaben-ID `01` mit neuem Inhalt überschrieben (das hätte die Bedeutung von "01" je nach Referenzcommit mehrdeutig gemacht). Stattdessen wird die bereits vorhandene, unverändert gültige Aufgabe `05-refactor-no-behavior-change` als Ersatz für die Kategorie "kleine/präzise Aufgabe" verwendet — sie ist über einen eigenständigen Fixture-Snapshot vollständig unabhängig vom aktuellen Repo-Zustand und erfordert keinerlei neue Aufgaben-Erstellung.

### Warum `02-local-bug` statt `03-failing-unit-test` für die Bugfix-Kategorie

Beide Aufgaben sind strukturell fast identisch (Fixture-Test, injizierter Bug, eindeutiges Pass/Fail). `02-local-bug` konfrontiert den Agenten nur mit einem Verhaltenssymptom (zwei Hunks statt einem) und erfordert eigenständige Exploration/Diagnose eines Off-by-one-Fehlers — das erzeugt mehr beobachtbare Varianz in Planung/Exploration/Fehlerbehandlung, genau den Dimensionen, die Modus A messen soll. `03-failing-unit-test` bleibt Reserve für einen späteren Zusatzlauf.

### Warum `04-multi-file-change` gestrichen wurde

Tiefer als der bereits dokumentierte Pfad-Confounder (`extensions/shared/permission-menu.ts` existiert nicht mehr): Der eigentliche Bearbeitungsgegenstand der Aufgabe, `PERMISSION_LEVEL_DESCRIPTION["read-bash"]`, existiert am Referenzcommit `dd00b33` **überhaupt nicht mehr** als Schlüssel — das Permission-System wurde auf vier Stufen konsolidiert (`readonly`/`project-write`/`confirm-all`/`yolo`), `read-bash` ist nur noch ein Legacy-Migrationswert in einer Normalisierungsfunktion, kein gültiger `PermissionLevel` mehr (verifiziert: `PermissionLevel`-Union-Type und `PERMISSION_LEVEL_DESCRIPTION`-Objekt in `extensions/shared/workflow-status.ts` enthalten keinen `read-bash`-Eintrag). Die Aufgabe ist damit wie spezifiziert unlösbar, nicht nur erschwert. `audit-task-validity.mjs`s reiner Dateipfad-Existenzcheck hatte das nicht erkannt, da er nur prüft, ob referenzierte _Dateien_ existieren, nicht ob referenzierte _Code-Konstrukte_ (Objektschlüssel, Typ-Varianten) innerhalb dieser Dateien noch vorhanden sind — eine dokumentierte Grenze dieses Preflight-Checks für zukünftige Serien.

## Bekannte Confounder

### Netzwerk-Isolations-Asymmetrie

Codex' `-s workspace-write`-Sandbox blockiert Netzwerkzugriff auf Betriebssystemebene (bwrap, Linux-Kernel-Namespaces) — verifiziert per kostenlosem, modellfreiem Test (`codex sandbox -- curl ... https://1.1.1.1` → sofortiger Verbindungsfehler, kein Timeout). Pi hat **keine äquivalente OS-Sandbox** für seinen Bash-Tool-Zugriff; "kein Webzugriff" wird bei Pi nur durch Entfernen der `pi-web-access`-Extension aus dem Worktree-Overlay hergestellt (`p5/worktree-setup.mjs`), nicht durch eine Kernel-Sperre.

**Mitigation, nicht Beseitigung:** Jeder Lauf wird nachträglich auf Netzwerk-Tool-Call-Versuche (`curl|wget|nc|ssh` als Wortgrenze irgendwo im Trace) gescannt (`p5-controller.mjs`s `scanForNetworkToolCalls`) und als `networkToolCallsObserved` im Ergebnis festgehalten — statt stillschweigend Parität zu behaupten. Ein positiver Wert bedeutet nicht zwingend einen tatsächlichen Netzwerkzugriff (grobe, textbasierte Heuristik, keine exakte Tool-Call-Analyse), sondern ist ein Signal für manuelle Nachprüfung.

### `npm/node_modules`-Symlink (behoben, hier dokumentiert)

`prepareP4Worktree` (wiederverwendet aus P4, unverändert) erzeugt einen isolierten Worktree per unabhängigem `git init`+`fetch`+`checkout`, OHNE den `npm/node_modules`-Symlink zu setzen, den das ältere `reset-task.sh` (via `git worktree add`) anlegt. Ohne diesen Symlink schlägt jeder fixture-basierte Test fehl (`run-fixture-test.mjs` löst `jiti` über `npm/node_modules` auf). Da `PI_BENCHMARK_PRIVATE_ROOT` vor dieser Serie nie existierte, wurde P4 nie real end-to-end mit einem echten Fixture-Task ausgeführt — diese Lücke war entsprechend unentdeckt. P5 behebt das in `p5/worktree-setup.mjs`s `linkNpmNodeModules` (harness-neutral, gilt für beide Seiten), ohne `p4-controller.mjs` selbst anzufassen (P3/P4-Sicherheit bleibt gewahrt).

### Rollen-Pinning-Semantik (behoben, hier dokumentiert)

Die wiederverwendete `pinRuntimeRoles`-Funktion aus `p4-controller.mjs` verlangt, dass jede im Manifest aktivierte Rolle (`enabled !== false`) im tatsächlichen Lauf auch aufgerufen wurde — das widerspricht Pi's eigener, bedingter Delegationslogik (siehe `AGENTS.md`: Investigator/Debugger werden nur bei bestimmten Kriterien delegiert, nicht bei jedem Task). Dieses Verhalten wurde erst beim ersten echten P5-Lauf sichtbar (P4 lief nie real, siehe oben). P5 verwendet daher eine eigene, angepasste `pinRuntimeRoles` (`p5-controller.mjs`): `main` muss immer aufgerufen werden und exakt passen; `investigator`/`debugger` sind optional — wenn aufgerufen, muss das Modell exakt passen, wenn nicht aufgerufen, ist das ein legitimes Ergebnis (0 Subagentenaufrufe), keine Pin-Verletzung. `p4-controller.mjs` selbst bleibt unverändert (P3/P4-Sicherheit).

### `codex exec` hat kein `-a`/`--ask-for-approval` (behoben, hier dokumentiert)

Die ursprüngliche Codex-CLI-Recherche (`codex --help`) listete `-a/--ask-for-approval` als verfügbares Flag — das gilt aber nur für den interaktiven Top-Level-Befehl `codex`, nicht für `codex exec` (verifiziert per `codex exec --help`, Version 0.149.1: kein `-a`-Eintrag). `exec` ist von sich aus nicht-interaktiv — es gibt kein TTY, das um Bestätigung gefragt werden könnte —, daher ist der Sandbox-Modus (`-s workspace-write`) allein das maßgebliche Rechte-Gate. `p5/launch-codex.mjs` übergibt `-a` seit diesem Fund nicht mehr; `manifest.harnesses.codex.approvalPolicy` bleibt als dokumentiertes Intent-Feld erhalten (siehe ENVIRONMENT.md), ohne einem literalen CLI-Flag zu entsprechen.

### `codex exec` wartet auf stdin-EOF, auch mit Prompt-Argument (behoben, hier dokumentiert)

`codex exec --help`: "If stdin is piped and a prompt is also provided, stdin is appended as a `<stdin>` block" — das gilt unabhängig davon, ob ein Prompt bereits als Argument übergeben wurde. Node's `child_process.spawn()`-Default lässt `stdin` als offene, nie geschlossene Pipe stehen; Codex wartete dadurch auf ein EOF, das nie kam (beobachtet: >80 Minuten bei 0% CPU-Auslastung, bevor der Prozess manuell beendet wurde — kein Rollout-File wurde in dieser Zeit angelegt, vermutlich keine echten API-Kosten verursacht). `p5/launch-codex.mjs` setzt seither `stdio: ["ignore", "pipe", "pipe"]`, wodurch Codex sofort ein leeres stdin (EOF) sieht.

### Token-Kalibrierung gegen eine echte Rollout-Datei

Erstannahmen zur Codex-Rollout-Feldstruktur (aus `--help`/Dokumentation abgeleitet) waren an mehreren Stellen ungenau und wurden gegen eine echte, während dieser Serie erzeugte Rollout-JSONL korrigiert:

- `turn_context.effort` (nicht `reasoning_effort`) trägt den aufgelösten Reasoning-Effort.
- `turn_context.multi_agent_version` (nicht `session_meta.multi_agent_version`).
- Token-Nutzung liegt in `event_msg`-Einträgen vom Typ `token_count`, Feld `info.total_token_usage` — als **kumulativer** Laufzähler, nicht als Delta. Nur der letzte solche Event zählt; Aufsummieren über alle `token_count`-Events würde massiv überzählen.
- Entgegen der ursprünglichen Annahme liefert Codex sehr wohl eine Cache-Aufschlüsselung: `cached_input_tokens`/`cache_write_input_tokens` sind reale, befüllte Felder (kein `null`).
- Modellaufrufe: `response_item`-Einträge mit `payload.type === "message" && payload.role === "assistant"` (deckungsgleich mit `event_msg.item_completed`-Einträgen vom Typ `AgentMessage`, im Kalibrierungssample exakt gleiche Anzahl).
- Tool-Aufrufe: `event_msg.item_completed`-Einträge vom Typ `CommandExecution`; Fehlschlag über `item.status === "failed"` (deckungsgleich mit `item.exit_code !== 0`).

`p5/collect-codex-metrics.mjs` ist entsprechend kalibriert. Details/Feldnamen sind im Datei-Kommentar dokumentiert.

### Evaluator-Korrektur: erforderliche Änderungsprüfung (behoben, hier dokumentiert)

Erstversion des Evaluators für `05-refactor-no-behavior-change` meldete `status: "pass"`, obwohl gar keine Änderung vorgenommen wurde — die Fixture-Baseline dieser Aufgabe ist (anders als bei `02-local-bug`) bereits vor jeder Änderung grün (11/11), sodass ein reiner Test-Exit-Code-Check nicht zwischen "korrekt gelöst" und "nichts getan" unterscheidet. Behoben durch eine zusätzliche, verpflichtende `git diff`-Prüfung, dass die Zieldatei tatsächlich verändert wurde. Verifiziert gegen einen unveränderten Baseline-Worktree (Ergebnis danach korrekt `fail`). Der `08-long-session-compaction`-Evaluator (`zigProfilePresent`) war von diesem Fehler nicht betroffen (ein fehlendes `zig`-Profil ist strukturell erkennbar), wurde aber zur Sicherheit ebenfalls gegen einen unveränderten Worktree gegengeprüft.

### `npm run verify`-Kette ist mit isolierten Worktrees strukturell inkompatibel (behoben, hier dokumentiert)

`npm run verify`s `test:coverage`-Schritt ruft über `tests/run-all.mjs` **hart-codiert** `benchmarks/harness/test/p4-controller.test.mjs` auf, das `git cat-file -e <P4-Referenzcommit b85cb72...>` voraussetzt. Ein isolierter P4/P5-Worktree (per `prepareP4Worktree`s unabhängigem Shallow-Fetch, siehe P0-05-Kommentar im Quellcode) enthält **nur** seinen eigenen Referenzcommit — niemals den einer anderen Serie. Die volle Verify-Kette bricht daher in **jedem** isolierten Worktree ab, unabhängig vom Agenten oder der Serie (verifiziert gegen einen unveränderten P5-Baseline-Worktree). Das betrifft P4 identisch, wurde dort aber nie bemerkt (P4 lief nie real). P5s Evaluatoren für `08` (der eine echte `npm run verify`-artige Prüfung braucht) nutzen daher stattdessen `npm run typecheck` (eigenständig) + `node tests/run.mjs` (in sich geschlossen, keine P3/P4-Abhängigkeit) — funktional gleichwertig für die tatsächlich task-relevanten Prüfungen, ohne die inkompatible Kette. Kein Eingriff in bestehenden Produktivcode/Testinfrastruktur.

## Wiederholungen

Smoketest: 1 Task (`05-refactor-no-behavior-change`) × 2 Harnesses × 1 Wiederholung = 2 Läufe (durchgeführt). Voller Pilot: 3 Tasks (`05`, `02`, `08`) × 2 Harnesses × 3 Wiederholungen = 18 Läufe (`04`/`09` gestrichen, siehe oben).

## Leakage-Prävention

`benchmarks/tasks/` (mit lösungsverratenden v1-`TASK.md`-Dateien) wird von `prepareP4Worktree` aus jedem Agenten-Worktree entfernt, bevor der Agent startet (wiederverwendet, unverändert). Beide Seiten erhalten ausschließlich: Repository-Arbeitszustand (ohne `benchmarks/tasks/`), den öffentlichen `PROMPT.md`-Text, normale Projektanweisungen (`AGENTS.md`/`APPEND_SYSTEM.md` für Pi; kein Äquivalent für Codex in Core-Parity-Modus). Der private Evaluator läuft als separater Prozess mit minimaler Environment (`PATH`/`HOME`/`TMPDIR`) und whitelisted nur 7 sichere Ergebnis-Schlüssel (`v2-private.mjs`, wiederverwendet, unverändert).
