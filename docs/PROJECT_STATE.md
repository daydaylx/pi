# Project State

> Flüchtiger Arbeitsstand des Pi-Repositories. Steuert **nicht** den
> Coding-Workflow: die einzige Aufgabenquelle ist der PlanSnapshot unter
> `.agent/plans/current-plan.md`. Kein Laufzeitmodul liest diese Datei.
> Dauerhafte Entscheidungen stehen in `docs/CONTEXT_LEDGER.md` und
> `docs/decisions/`.

## Aktueller Stand

Workflow v3 ist der einzige aktive Workflow. Die Bereinigung der verbliebenen
Altlasten, Doppelstrukturen und toten Pfade ist abgeschlossen.

## Zuletzt umgesetzt

**Statusmodell.** Genau eine Deklaration von `WorkflowStatus`
(`shared/workflow-status.ts`); `plan-mode/store/types.ts` re-exportiert sie.
`WorkflowCapabilityState` und die drei getrennten Werteaufzählungen in
Aurora-State, Sidecar-Schema und Capability-Bridge sind darauf zurückgeführt.
Legacy-Werte erscheinen nur in `legacyStatus()` der Migration.

**Completion.** `setup-core/verification-gate.ts` (346 Z.) entfernt — es besaß
eine zweite Aggregation, Typfamilie, Git-Parsing, Report und
Abschlussempfehlung. `/verify-gate` liegt jetzt in `plan-mode` und nutzt als
reine Diagnose dieselben Prüffunktionen (`completion/diagnosis.ts`).
`/finish` und `/task-done` rufen einen gemeinsamen internen Handler; der
Override baut den Bericht aus dem gelaufenen Ergebnis statt die Pipeline ein
zweites Mal zu starten. Die Option `overrideReason` der Pipeline ist entfallen.

**Kontext.** `shared/context-ledger.ts` (603 Z.) und
`schemas/context-ledger.schema.json` entfernt: von keiner aktiven Extension
erreichbar. `docs/CONTEXT_LEDGER.md` bleibt handgepflegt über den Skill
`context-checkpoint`, dessen falsche Behauptung einer automatischen
Konsolidierung korrigiert wurde.

**UI.** Fünf verwaiste Dateien gelöscht (`thinking-view.ts`,
`thinking-view-config.ts`, `context-menu.ts`, `git-header.ts`,
`activity-status.ts`). Tote Eventkanäle entfernt (`openContext`, `openChanges`,
`snapshot`, `openThinkingView`). `ZENTUI_STATUS_KEYS` heißt `UI_STATUS_KEYS`;
die Stringwerte blieben unverändert, jetzt weil `aurora-ui/footer.ts` sie liest.

**UI-Chrome repariert und entschlackt.** `themes/aurora-night.json` deklarierte
mit `pillBg` und `overlayBg` zwei Schlüssel, die das Pi-Theme-Schema nicht kennt
(`additionalProperties: false`). `Theme.bg()` wirft bei unbekannten Schlüsseln;
ein `try/catch` in `renderPill` verschluckte das, sodass jedes Fußzeilensegment
als `[Klammertext]` rendete statt als Fläche — bei laufendem Ticker rund 60
gefangene Ausnahmen je Sekunde. `shared/ui-theme.ts` ist auf `renderSegment`
reduziert; `renderPill`, `emptyBorderLine`, `renderFrameBorder` und
`formatSelectionRow` sind entfallen, die drei letzten hatten keinen Aufrufer.

Die Fußzeile ist die einzige Statusfläche (ADR 009). Modell, Denktiefe, Kontext
und Arbeitsablauf standen zuvor doppelt — im Editorrahmen und in der Fußzeile.
Der Rahmen ist auf eine Zeile mit Arbeitsablauf und Schritt reduziert, die
untere Rahmenzeile und das 2,5-Hz-Blinken sind entfallen. Neu sind
`aurora-ui/footer.ts` (Renderlogik, priorisiertes Weglassen von Segmenten statt
hartem Abschneiden) und `aurora-ui/layout.ts` (die Breitenschwellen, zuvor in
`tool-renderers.ts` als `76` dupliziert). `index.ts` schrumpft von 679 auf 539
Zeilen; die Registrierung von Editor, Fußzeile und Widget bleibt dort.

Die Berechtigung erscheint jetzt als kurzer Modus-Label aus
`PERMISSION_LEVEL_LABEL`. Der frühere Startwert setzte `permissions.bash` unter
ein Modus-Label — zwei verschiedene Einstellungen unter einem Namen.

`zentui.json` und `extensions/pi-tool-display/config.json` sind gelöscht: beide
Pakete sind seit der Paketbereinigung keine aktiven Laufzeitpakete, ihre
Konfiguration steuerte nichts. Die npm-Pins bleiben als Typecheck-Anker.

**Shortcuts.** `Shift+Tab` ist der Workflow-Wechsel, `Super+Q` das vollständige
Control Center — eine gemeinsame Definition (`shared/control-center-menu.ts`),
ein gemeinsamer Action-Router. Die frühere Inline-Menüliste in `commands.ts`
und das separate Overlay in `control-plane.ts` sind entfallen. Der nie
registrierte `SHORTCUTS.help` ist entfernt.

**Permissions.** `/full-access` mit eigener Toggle-Logik entfernt; die Legacy-
Werte werden weiterhin an der Eingangsgrenze `/permission <wert>` akzeptiert.
Die inline nachgebaute Legacy-Abbildung in `setup-core/config.ts` nutzt jetzt
`normalizePermissionLevel()`. YOLO wird nie aus persistierter Konfiguration
aktiviert.

**Benchmarks.** Task 11 (`context-ledger-survival`) samt kaputter Fixture
entfernt — sie importierte zwei nicht existierende Module und wurde vom
Typecheck nicht erfasst. Der Harness hat keine Runtime-Kopplung; `scoredRunCount`
kommt jetzt aus dem Manifest statt aus einer hartcodierten Zahl.

**Tests.** Entfernt wurden ausschließlich Tests ohne aktive Produktanforderung:
ein toter Abschnitt mit `return;` an erster Stelle, der die gelöschte
`task-contract.ts` lud; die Sektion des alten Gates; beide Ledger-Sektionen;
die Sektionen der verwaisten UI-Module. Sicherheitsanforderungen wurden auf die
neuen Mechanismen übertragen (harte Secret-Grenze auf
`completionOverrideReport`, Permission-Status auf den Statuskanal).

**Dokumentation.** `docs/decisions/001`–`008` angelegt. Sechs überholte Berichte
nach `docs/archive/` verschoben, zwei selbst als überholt markierte Pläne
gelöscht. Runtime-Matrix korrigiert: die installierte Runtime ist `0.82.1`, der
Dev-Pin `0.80.6` — eine Minor-, keine Patch-Abweichung.

## Letzte Verifikation

Stand 2026-07-28, alle Läufe tatsächlich ausgeführt.

| Prüfung                                    | Ergebnis                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `npm --prefix npm run verify`              | **grün (Exit 0)**                                                                           |
| `npm --prefix npm run typecheck`           | grün                                                                                        |
| `npm --prefix npm run test`                | **711 bestanden, 0 fehlgeschlagen** (runtime 271, ui 35, workflow-v3 237, lsp 155, diff 13) |
| `npm --prefix npm run test:coverage`       | grün, alle Werte über Baseline                                                              |
| `node tests/p1-runtime.mjs`                | grün                                                                                        |
| `node benchmarks/harness/test/p3.test.mjs` | grün                                                                                        |
| `npm run install:user -- --dry-run`        | grün, 187 Dateien                                                                           |
| `git diff --check`                         | sauber                                                                                      |
| Erreichbarkeitsanalyse                     | 94/94 Dateien ab `settings.json` erreichbar                                                 |

Ausgangsbaseline auf Commit `a7e4ad7`: 787 bestanden. Die Differenz von 76
Assertions entfällt vollständig auf Tests entfernter Runtime-Funktionen
(altes Gate 30, Ledger 35, verwaiste UI-Module rund 20, dafür rund 10 neue).

### P1-Runtime-Patches neu portiert

Das Upgrade der installierten Pi-Runtime von `0.82.0` auf `0.82.1` hatte die
lokalen Patches überschrieben; `tests/p1-runtime.mjs` und damit `npm run verify`
waren rot. Alle vier Eingriffspunkte wurden gegen `0.82.1` neu geschrieben
(gescopte Event-Listener im Loader, `ExtensionRunner.dispose()`, Aufruf im
Reload-Pfad, `applyConfiguredExtensionOrder`) und der Versions-Pin nachgezogen.
Der Reload-Test über zehn Generationen ist grün.

Damit sich das Nachschreiben von Hand nicht wiederholt, stehen die Eingriffe
jetzt versioniert in `scripts/apply-runtime-patches.mjs`
(`node scripts/apply-runtime-patches.mjs`): idempotent, alles-oder-nichts, mit Sicherung nach
`backups/runtime-patches/` und hartem Abbruch bei geändertem Runtime-Code.
`tests/runtime-patches.mjs` sichert das Skript ab und läuft in
`npm run verify` mit. Verifiziert wurde es end-to-end gegen eine unpatched
Kopie der Runtime: das Ergebnis ist byte-identisch mit der von Hand gepatchten
Live-Installation und besteht `tests/p1-runtime.mjs`. Einzelheiten in
[`RUNTIME_PATCHES.md`](RUNTIME_PATCHES.md).

## Nächste Repository-Prioritäten

1. Angleichung von Pi-Runtime `0.82.1` und Dev-Pin `0.80.6` — braucht eine
   ausdrückliche Freigabe für die Abhängigkeitsänderung.
2. Entfernung von `store/migration.ts` und `/migrate-plan`, sobald keine
   Ausrollziele mehr v1/v2-Artefakte tragen (letzte unterstützte Version: v2).
   Dieses Repository selbst ist seit dem Verwerfen der lokalen Altartefakte
   v3-rein.
3. Coverage von `lsp/index.ts` (20,5 %) und `ask-user.ts` (36,8 %) anheben oder
   die niedrigen Schwellen ausdrücklich als gewollt festhalten.
