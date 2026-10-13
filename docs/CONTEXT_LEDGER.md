# Context Ledger — agent

## Bestätigte Nutzerentscheidungen

- `pi-harness-hardening-v2` wird schrittweise umgesetzt: Workspace-Snapshot,
  Verifikationsstatus, Trace-Diagnostik, Tool-/Kontextqualität.
- Independent Verifier, Modellrouting, Compaction und Planmodus-Anomalien
  bleiben datengetriebene Experimente und sind keine Standardautomatik.
- Aktualisierte Nutzerentscheidung: Die lokale Electron-GUI wurde ohne
  Auslagerungs-/Backup-Kopie aus diesem Repository entfernt. Aurora bleibt
  erhalten; die von Core/Aurora und externen Clients genutzte Bridge und
  Frontend-Protokolle bleiben bestehen.
- Audit 2026-10-13: Entfernt wurden `second-opinion`, `diff-viewer`,
  `diff-learning`, die LSP-Navigationstools und die Alias-Befehle
  `/show-plan`/`/plan-edit` (unnötige Komplexität). Bewusst behalten:
  `interactive-pty` (63 Aufrufe in 13 Sessions), `detailed_plan`, die externe
  Frontend-Schicht (`pi-gui` nutzt `@daydaylx/pi-frontend-protocol`). Die
  Qwen-Token-Plan-Modelle sind aus `enabledModels` und
  `subagents.modelScope.allow` entfernt (kein Qwen-Zugang mehr gewünscht;
  der `qwen-token-plan`-Eintrag in `auth.json` bleibt unangetastet). YOLO 3
  erlaubt gemäß ADR 029 auch `rm -rf /`; Tests, die das Gegenteil erwarten,
  sind veraltet. Commits, Pushes und Deployments nur auf ausdrücklichen
  Auftrag (`AGENTS.md`).
- Real-Duel Phase 5: Der Nutzer wählte eine neue, vollständige 36-Lauf-Serie
  (3 Tasks × 3 Trials × Work-only/Plan→Work × Pi/Codex) mit
  `gpt-5.6-luna` und Reasoning `medium`. Reale API-Läufe starten erst nach
  einem sauberen, ausdrücklich freigegebenen Baseline-Commit; kein
  `--allow-dirty`, kein Push und keine parallele interaktive Pi-Sitzung.

## Architekturentscheidungen

Details und Begründungen stehen in `docs/decisions/`; hier nur der gültige Kern.

- **Frontend-Schicht:** Die lokale Electron-App ist ersatzlos entfernt. Aurora
  und die Core-Extensions sprechen über den internen State-Bus
  (`extensions/frontend-protocol/`, `extensions/frontend-bridge/`);
  `frontend-server/` stellt externen Clients die öffentliche JSONL-API bereit
  (`docs/frontend-api.md`, Paket `@daydaylx/pi-frontend-protocol`);
  `verification.run` ist darüber nicht direkt aufrufbar.
- **Planmodus** (ADR 012, 016, 020): nur `work`, `simple_plan`,
  `detailed_plan`. Shift+Tab ist die einzige normale Steuerung; die Auswahl
  wartet auf die nächste Nutzereingabe und startet keinen Turn. Pläne werden
  ausschließlich über `plan_write` in die sitzungsbezogene Ablage
  (`~/.pi/agent/plans/<workspace>/<session>.md`) geschrieben, sind
  unverbindlicher Kontext und werden nur nach ausdrücklicher, hashgebundener
  Freigabe umgesetzt. Arbeitsbaum-Mutationen sind unter YOLO 1 und 2 gesperrt,
  nur YOLO 3 übergeht sie (ADR 029). Die feste Allowlist umfasst
  Lese-/Diagnose-/Recovery-/Web-Fähigkeiten, `verify({check:"typecheck"})`,
  begrenzte Diagnose-Bash und eine artefaktfreie temporäre Analyse-Spec;
  Projekt-Skripte und `project_check` bleiben gesperrt.
- **Bash-Klassifikation** (ADR 012, 022): Plan-, Readonly- und Recovery-Gate
  teilen ein normalisiertes Modell in `extensions/shared/permission-policy.ts`.
  Executables werden nur über `trustedExecutableName` aufgelöst,
  `git status/diff/log` nur mit konservativer Options-Allowlist,
  `parseReadOnlyShell` lässt keine Pipelines zu. Das ist eine Allowlist vor
  dem Executor, keine OS-Sandbox. `project-write` erlaubt Interpreter nur für
  projektinterne literale Skripte; Inline-, stdin- und externe Skripte fragen
  nach.
- **YOLO** (ADR 029): drei Stufen — 1 blockiert, 2 fragt, 3 erlaubt an harten
  Grenzen; nie persistiert.
- **Workspace-Snapshot** (ADR 027): `shared/workspace-snapshot.mjs` liefert
  einen versionierten Snapshot (HEAD, staged, unstaged, untracked, Renames,
  Deletes; keine Patches, Inhalte oder absoluten Pfade) für
  `extensions/resilience/`, `extensions/setup-core/` und
  `extensions/permissions/verifier-policy.ts`. Erfassung ab Git-Root,
  gestreamte Patch-Hashes, begrenztes Retry, typisierte Fehler: Commit- und
  Recovery-Gates bleiben bei Snapshotdefekten geschlossen. Inhaltssensitive
  Git-Aufrufe erzwingen `--no-ext-diff` und `--no-textconv`; die
  Schema-Version ist `"2"`. Die frühere Benchmark-Kopie ist archiviert
  ([`docs/benchmark-history.md`](benchmark-history.md)).
- **Verifikation** (ADR 015, 021, 032): `project_check` ist der einzige Weg
  zur vollständigen Projektverifikation und der einzige, der Footer und Ledger
  fortschreibt; das Ergebnis gilt für den Workspace-Snapshot, nie automatisch
  für HEAD. Das `verify`-Tool bietet nur `typecheck`/`test`. Der
  Verifikationsstatus ist sitzungs- und snapshotgebunden, rein technisch und
  erscheint dedupliziert bei `agent_settled`. Verifier-Kette: Need-Gate,
  Dedup-Gate, Ticket, Commit-Gate (Pfadkatalog:
  `extensions/permissions/verifier-required-paths.ts`); urteilslose
  Verifier-Läufe bleiben retrybar und decken keinen Commit.
- **Recovery** (ADR 016): `latestRecoveryGate`
  (`extensions/resilience/recovery-state.ts`) behält den chronologisch
  neuesten `recovery-checked`-Marker; Live-Update im `recovery_check`-Tool
  und History-Replay nutzen denselben Reducer (`foldCheckedMarker`,
  `foldRequiredMarker`).
- **Subagenten** (ADR 031, 014, 018): keine festen Rollen mehr;
  `agents/verifier.md` ist das einzige technische Profil. Delegation läuft
  über temporäre Task-Agenten (`subagent` mit `spec`, höchstens 3 pro
  Parent-Lauf). `toolSchemaMode: "harness"` reduziert die Tool-Surface;
  `action` ist ein geschlossenes Enum (`list`, `status`, `stop`,
  `interrupt`). Es gibt keine Subagent-Parallelitätskonfiguration.
- **Aurora** (ADR 007, 009, 013): Aurora besitzt die einzeilige Fußzeile (die
  einzige permanente Statusfläche) und das transiente Activity-Widget; das
  Eingabefeld ist Pis eigener Editor; Subagenten stehen im Activity-Widget.
  Animiert wird nur echte Arbeit (`DENKT NACH`, `ARBEITET` in
  `contextual`; `ANTWORTET`, `WARTET AUF MODELL` statisch). Gestaltung aus
  `extensions/aurora-ui/tile.ts` (gefüllte Kacheln über die acht
  `Theme.bg`-Flächen, ab `wide` zweispaltig, unter 18 Spalten rahmenlos);
  Statuslabels und Overflow in `tool-renderers.ts`. Eingeklappte
  Tool-Receipts sind Einzeilen (`collapse-result.ts`); Fehler, Partial
  Output, Truncation und leere Ergebnisse bleiben sichtbar.
- **Auslieferung:** Extensions müssen ohne Arbeitsbaum-Kontext laden
  (`scripts/check-relative-imports.mjs`, `scripts/check-versioned-tree.mjs`
  mit `git archive HEAD`; gilt nur für HEAD, ersetzt keine CI). CI-`verify`
  nutzt den Standard-Shallow-Checkout. Die Allowlist in
  `scripts/install-user.mjs` ist die einzige Quelle für Installiertes
  (inkl. `APPEND_SYSTEM.md` und `prompts/`); lokale `+extensions/…`-Einträge
  der installierten `settings.json` bleiben erhalten.
- **Messung und Budgets:** Tokenmetriken trennen `cacheRead`/`cacheWrite`;
  `providerReportedTotal` ist das rohe `usage.totalTokens` und kann
  Cache-Buchhaltung enthalten (Methodik in `docs/benchmark-history.md`).
  Compaction (ADR 010): Reserve 49152, Recent 20000, Auslösung bei 81,9 % des
  Fensters; `reserveTokens` steuert Schwelle und Summary-Budget
  (`0,8 × reserve`); ein Überlauf ist nur einmal wiederherstellbar; die Werte
  sind im Runtime-Test festgenagelt (Upstream-Default 20.000).
- **Kommunikation:** `APPEND_SYSTEM.md` verlangt phasenbasierte Narration,
  keine Tool-für-Tool-Kommentierung; die Delegationsvorlage steht in `AGENTS.md`.

## Nicht-Ziele

- Keine neue Planner-Worker-Reviewer-Kette, keine Abschluss-Pipeline und
  keine automatische Checkausführung.
- Keine freie Shell in Projektprüfprofilen und keine automatische Installation.
- Keine Speicherung von Secrets, vollständigen Toolausgaben, privaten
  Evaluatordetails oder Modellgedanken in Benchmark- oder Runtimezuständen.

## Bekannte Einschränkungen

- Kontrollierte Baseline- und Holdout-Läufe für die Snapshotlogik stehen aus.
- Der Fork `daydaylx/pi-subagents` ist am Pin typecheck-grün, seine Unit-,
  Integrations- und E2E-Suiten bestehen; er ist nicht Teil einer
  Pflichtprüfung des Hauptrepos.
- Pi 1.0.4 warnt beim Start, dass `typebox` in `pi-subagents` und
  `pi-web-access` unter `dependencies` statt `peerDependencies` steht. Beim
  Fork bewusst nicht geändert: Pi installiert Git-Pakete mit `--omit=peer`, und
  der asynchrone Runner läuft außerhalb des Extension-Loaders.
- `install:user --apply` sichert nichts und überschreibt auch `setup.json`,
  `models.json`, `keybindings.json` und `web-search.json` im
  Agent-Verzeichnis.
- Der Live-Smoke ist ohne authentifizierte TTY nicht durchführbar; Aurora-
  Sichtbarkeit, Shift+Tab, Plan→Work-Handoff und Subagent-Aufruf bleiben
  unbelegt (`docs/manual-smoke-checklist.md`).
- P2: belegt ist nur die Aufteilung von `tests/suites/runtime.mjs`
  (Schnittkante: `SECTION_SUITES`-Registry).

## Offene Risiken

- Git-Sonderfälle wie Umbenennungen, gelöschte und indexierte Dateien müssen
  bei allen unterstützten Git-Versionen gleich behandelt werden.
- Zusätzliche Metriken oder Statushinweise können Schemakompatibilität,
  Tokenverbrauch und Warnungsdichte beeinträchtigen.

## Offene Fragen

- Recovery-Rate nach den Fixes aus dem Audit vom 2026-10-13 ist nicht
  gemessen (keine neuen Sitzungen).

## Wichtige Projektregeln

- Schutzregeln zu Nutzeränderungen, Auftragsscope, Commits/Pushes: siehe
  `AGENTS.md`.
- Vor `npm run install:user -- --apply` ein Backup von `~/.pi/agent` anlegen;
  danach `npm install --ignore-scripts` in `~/.pi/agent/npm` (nie `npm ci`,
  `node-pty` bleibt gebaut) und `node scripts/apply-runtime-patches.mjs --apply`.
- Nach relevanten Änderungen läuft `npm --prefix npm run verify`. Nur ein
  `project_check`-Aufruf des Pflichtprofils `verify` aktualisiert den
  Footer/Ledger — ein reiner `bash`-Lauf desselben Befehls oder ein Lauf aus
  `verifier` heraus tut das nicht (siehe `docs/verify-profiles.md`).
- `npm run test:runtime` ist bewusst kein Teil von `verify`/CI: es prüft eine
  lokal gepatchte Runtime unter einem entwicklerspezifischen Pfad
  (`PI_RUNTIME_ROOT`), den kein CI-Runner besitzt (siehe
  `docs/RUNTIME_PATCHES.md`).

## Aktuelle Prioritäten

- Audit-Umsetzung vom 2026-10-13 ist abgeschlossen (Stand:
  `docs/PROJECT_STATE.md`); Pi-Runtime-Pin und Dev-Abhängigkeit sind `1.0.4`.
- Real-Duel: Medium-Profile, Fingerprint-Provenienz und die 36-Lauf-Matrix
  sind vorbereitet. Vor dem Dual-Smoke zuerst den kanonischen Audit-/Medium-
  Stand prüfen und die explizite Commit-Freigabe einholen.
- Der Live-Smoke (#137) bleibt offen: Offline-Start/Shift+Tab ist geprüft,
  Provider- und Plan/Work-Schritte sind noch nicht gelaufen.
- Der Fork-Pin ist ein vollständiger, bei GitHub erreichbarer SHA, der den
  alten Pin enthält (aktuell `0364aaa`, Branch
  `feat/temporary-agent-spec`); `main` ist nicht automatisch der neueste
  Stand. Vor jeder Pin-Änderung Erreichbarkeit prüfen und die Integrity im
  Lockfile neu berechnen; die lokale Suite bleibt bewusst offline.

## Verworfene Optionen

- Ein großer allgemeiner Runtime-State, automatische `blocked`-Klassifikation
  und standardmäßig aktive Recovery-Nudges sind verworfen, bis Messdaten
  ihren Nutzen belegen.
- Eine zweite vollständige Verify-Pipeline ist verworfen; stattdessen gibt es
  den schlanken Versioned-Tree-Check plus den `git archive HEAD`-Weg.
- Fork-Strip-down (2026-10-13 verworfen): Async-Runner, Chains, Intercom und
  Worktrees zu entfernen (−38 000 Zeilen) brächte nur Wartbarkeit;
  `toolSchemaMode: "harness"` sperrt diese Pfade schon auf Schema-Ebene. Der
  Stand ist unfertig (82 Typfehler) und liegt nur lokal im Dev-Klon
  (`wip/strip-down-2026-10-13`); `74b95d6` ist ebenfalls nicht übernommen.
