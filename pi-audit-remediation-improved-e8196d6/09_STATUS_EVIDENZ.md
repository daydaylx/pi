# Audit-Remediation – kompakter Status- und Evidenzbericht

> F-01–F-28-Status wird ausschließlich in `08_TRACEABILITY_MATRIX.md` geführt.
> Diese Datei dupliziert keine vollständige Audit-ID-Liste.

## Metadaten

- Repository: `daydaylx/pi` (lokal `/home/d/.pi/agent`)
- Branch: `main` (Arbeitsbranch `phase0/baseline-2026-09-10` angelegt, HEAD nicht gewechselt)
- Base-SHA: `4563fad1937ed838a4824777d6c6a25298349f27`
- aktueller HEAD: `4563fad1937ed838a4824777d6c6a25298349f27` (unverändert seit Phase-0-Beginn)
- Datum: 2026-09-10
- Node: v22.23.2 (passend zu `.nvmrc`, `package.json`/`npm/package.json` `engines.node`, `npm/package-lock.json` `packages[""].engines.node`)
- npm: 10.9.8 (passend zu `engines.npm` an allen drei Stellen)
- Runtime: `@earendil-works/pi-coding-agent@0.84.4` global installiert (`npm ls -g`); `npm/package.json` devDependency-Pin `0.84.3` — siehe Evidenzblock F-23
- Bearbeiter/Agent: Claude Sonnet 5, Phase-0-Ausführung dieser Session (Nutzer: daydayfay05@gmail.com)

## Scope-Abweichungen seit Auditstand

- **Referenz-HEAD-Ancestry (wichtiger Befund):** Der im Master-Arbeitsauftrag genannte
  „Referenz-HEAD" `e8196d60d95afead4aa0487f941deffa736e47a8` existierte vor
  `git fetch origin` lokal **nicht** als Git-Objekt. Nach `git fetch origin`
  (einziger nicht-rein-lesender Schritt dieser Phase; verändert nur
  `.git/refs`/Objekt-DB, keine Produktdatei, kein Merge/Checkout) zeigt sich:
  `git merge-base --is-ancestor e8196d6 HEAD` → exit 1 (NEIN),
  `git merge-base --is-ancestor HEAD e8196d6` → exit 0 (JA). **HEAD (`4563fad`)
  ist Vorfahre von `e8196d6`, nicht umgekehrt** — auf `origin/main` liegt
  `e8196d6` als Fast-Forward-Nachfahre (`4563fad..e8196d6 main -> origin/main`).
  Der lokal ausgecheckte Stand entspricht exakt dem im Master-Arbeitsauftrag
  genannten „analysierten Produktcode" (`4563fad`) — für die Befundprüfung
  besteht damit **kein Code-Drift** gegenüber der Audit-Grundlage.
- **Audit-Dokument nachträglich verfügbar geworden:** Der dritte referenzierte
  Hash, „Audit-Commit" `e6db405b6cb3f17dc6f262375c5152a721c8cca6`, existiert
  lokal als Git-Objekt (`git merge-base --is-ancestor HEAD e6db405` → exit 0)
  und enthält `docs/PI_COMPLEXITY_ERROR_ANALYSIS.html` (852 Zeilen) — den
  ursprünglich als „im Repo fehlend" eingeschätzten Original-Audit-Bericht.
  Er wurde per PR #147 auf `origin/main` gemerged, war zu Beginn dieser
  Phase-0-Ausführung nur lokal nicht gefetcht. Read-only via
  `git show origin/main:docs/PI_COMPLEXITY_ERROR_ANALYSIS.html` eingesehen
  (kein Merge, kein Checkout, HEAD unverändert `4563fad`). Er bestätigt
  F-01–F-10 im Detail und liefert präzisere Schwellwerte/Einordnungen, die in
  die untenstehenden Evidenzblöcke eingeflossen sind.
- **Neue Commits auf `origin/main` seit HEAD:** `git log --oneline
HEAD..origin/main` → genau zwei Commits (`e6db405` Audit-Report,
  `e8196d6` Merge-Commit dafür), beide reine Dokumentation
  (`docs/PI_COMPLEXITY_ERROR_ANALYSIS.html`, 852 Zeilen, keine
  Code-/Test-Änderung). Keine F-ID ist dadurch neu zu bewerten.
- **Fremdänderungen/Blocker:** keine. Drei zusätzliche Git-Worktrees
  existieren bereits außerhalb des Remediation-Scopes (siehe unten), wurden
  nicht betreten.
- **Node/npm/Lockfile:** keine Diskrepanz — `.nvmrc`, `package.json` engines,
  `npm/package.json` engines und `npm/package-lock.json`
  (`packages[""].engines`) sind alle identisch (`node 22.23.2`, `npm
10.9.8`) und stimmen mit der tatsächlichen Laufzeitumgebung überein.
- **Worktrees:** `git worktree list` zeigt neben dem Hauptpfad drei weitere,
  bereits bestehende Worktrees auf `detached HEAD` (`~/.local/state/pi-p3/worktrees/p3-01-1`,
  zwei unter `~/.local/state/real-duel/worktrees/real-05-lsp-rename-tool-trial1-20260909T005445/{codex,pi}`)
  — gehören nicht zum Remediation-Scope, nicht betreten/verändert.
- **Submodule:** keine (`git submodule status` liefert keine Ausgabe).

## Baseline

| Prüfung                     | Befehl                                       | Exit | Ergebnis/Fehlerklasse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------- | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation                | `npm ci --prefix npm --engine-strict`        |    0 | grün — 369 packages, 0 vulnerabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Pflichtprofil               | `npm --prefix npm run verify`                |    1 | **infrastrukturbedingt**: format:check, typecheck, deadcode (knip), test:coverage, test:patches liefen alle grün durch; Abbruch in `test:gui` → `gui/test/session-rpc.mjs` mit `SESSION RPC FAIL: Timeout für get_state` — der Test spawnt einen echten `pi --mode rpc`-Subprozess (`npm/node_modules/.bin/pi`) und wartet auf dessen RPC-Antwort; Timeout in dieser (verschachtelten Agent-)Sandbox-Umgebung, kein Bezug zu F-01–F-28. `audit:check` wurde wegen der `&&`-Verkettung nicht mehr erreicht. |
| Protocol separat (Baseline) | `npm --prefix npm run test:protocol-package` |    0 | grün — 8/8 Tests bestanden                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Frontend separat (Baseline) | `npm --prefix npm run test:frontend-server`  |    0 | grün — 13/13 Tests bestanden                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Hauptsuite                  | `npm --prefix npm test`                      |    0 | grün — alle Suiten (u. a. compact-tool-receipts, benchmark-telemetry, check-npm-audit, check-theme-contrast, openrouter-doctor-\*) 0 Fehlschläge; enthält `test:protocol-package` + `test:frontend-server` + `tests/run-all.mjs`, **nicht** `test:gui`                                                                                                                                                                                                                                                     |

**Bestätigt (auditbezogener Datenpunkt, nicht Teil von Phase 0 selbst):**
`verify` enthält laut `npm/package.json` weder `test:protocol-package` noch
`test:frontend-server` — beide liefen nur separat grün, weil Phase 0 sie
explizit vorschreibt. Das ist der Faktenkern von F-07 (Phase 2).

## Meilensteine

| Meilenstein              | Status            | relevante Commits                                                  | Vollprüfung               | Verifier                                         | Blocker                     |
| ------------------------ | ----------------- | ------------------------------------------------------------------ | ------------------------- | ------------------------------------------------ | --------------------------- |
| Phase 0 Baseline         | **abgeschlossen** | (kein Commit — reine Evidenzerhebung, keine Produktdatei geändert) | Baseline (siehe oben)     | n/a — keine geschützten Pfade in Phase 0 berührt | keiner                      |
| Checkpoint A – F-01–F-10 | **abgeschlossen** | `243820c`, `a15ebb8` + Arbeitsbaum-Remediation (kein neuer Commit) | fokussierte Regressionen und kanonisches verify grün | `PASS_WITH_WARNINGS` durch unabhängigen Sonnet-Review | nur dokumentierte Baseline-Provenienz-Warnung; Commit bleibt ausdrücklich Nutzerentscheidung |
| Phase 3 Low-Risk         | offen             |                                                                    | fokussiert                | bedingt                                          |                             |
| Phase 4 Optional         | offen             |                                                                    | fokussiert/risikobasiert  | bedingt                                          |                             |
| Final                    | offen             |                                                                    | `verify`                  | final falls nötig                                |                             |

## Evidenzblöcke

### F-01/F-02 – Snapshot-Größenlimit (Commit-Gate fail-open / Recovery-Gate unlösbar)

- **Ausgangsverhalten:** `collectWorkspaceSnapshot()` (`shared/workspace-snapshot.mjs:79`)
  ruft `git` ausschließlich über `execFileSync(..., { encoding: "utf8" })`
  ohne `maxBuffer`-Override auf → Node-Default 1 MiB. `assessGitCommitVerifierGate()`
  (`extensions/permissions/verifier-policy.ts:332-340`) fängt den Fehler und
  liefert `PERMITTED` (fail-open). `workspaceFingerprint()`/`recoverySnapshot()`/
  das `recovery_check`-Tool (`extensions/resilience/index.ts`) liefern
  `"unavailable"` bzw. werfen einen Tool-Fehler (fail-closed, dauerhaft).
- **Reproduktion (vier Szenarien, je in isoliertem Temp-Repo außerhalb des Hauptrepos,
  ausschließlich synthetische Daten, keine versionierten Benchmarkdaten
  berührt):**

  | Szenario                                                                    | Rohgröße         | Diffgröße (`git diff --binary`)    | Ergebnis `collectWorkspaceSnapshot()`                                                                                                                                                                                                                                       |
  | --------------------------------------------------------------------------- | ---------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | A: Textdiff, unstaged, Vollersetzung                                        | 1,99 MB Datei    | 3,74 MB                            | `THROW code=ENOBUFS signal=SIGTERM status=null`                                                                                                                                                                                                                             |
  | B: Binärdiff, unstaged                                                      | 900 KB Datei     | 2,32 MB                            | `THROW code=ENOBUFS signal=SIGTERM status=null`                                                                                                                                                                                                                             |
  | C: große untracked Datei                                                    | 5,00 MB Datei    | n/a (kein Diff)                    | **OK, kein Wurf** — `untrackedContentFingerprints()` nutzt `readFileSync`, nicht `execFileSync`; `ls-files --others` liefert nur den Pfad. Bestätigt: F-01/F-02 sind spezifisch an den `git diff --binary`-Patch-Aufrufen (staged/unstaged), nicht an Dateigröße allgemein. |
  | D: staged (738 KB Diff) + unstaged (738 KB Diff) kombiniert, je unter 1 MiB | 2× ~350 KB Datei | je 738 KB (zwei getrennte Aufrufe) | **OK, kein Wurf** — bestätigt: Limit gilt pro-`git()`-Aufruf, nicht kumulativ über den Workspace.                                                                                                                                                                           |

  Deckt sich mit den im Original-Audit (`docs/PI_COMPLEXITY_ERROR_ANALYSIS.html`,
  Commit `e6db405`, read-only eingesehen) genannten Schwellwerten: ENOBUFS ab
  ca. 350 KB geändertem Text bzw. ca. 700 KB Binärdaten.

- **Auswirkung auf Commit-Gate (F-01), end-to-end mit echtem Code geprüft**
  (`assessGitCommitVerifierGate()` real aufgerufen, kein Mock):
  - Kontrollfall — kleine Änderung an `extensions/permissions/seed.ts`
    (geschützter Pfad laut `verifier-required-paths.ts`), kein Verifier-Lauf
    hinterlegt: `blocked=true`, Reason „Verifier-Pflicht (technisch
    erzwungen)…" — Gate funktioniert korrekt.
  - Gleiche Datei, gleicher geschützter Pfad, aber Diff auf 1,48 MB
    vergrößert: `blocked=false` (PERMITTED) — **Commit-Gate umgangen, obwohl
    kein Verifier-PASS vorliegt.** F-01 damit end-to-end reproduziert, nicht
    nur statisch belegt.
- **Auswirkung auf Recovery-Gate (F-02), end-to-end mit echtem Test-Harness
  geprüft** (`tests/shared/harness.mjs` + echte `resilience`/`plan-mode`/
  `mode-permissions`-Extensions, Workspace = Szenario-A-Repo mit 3,74 MB Diff):
  nach fehlgeschlagenem Turn ist die Schreibsperre aktiv (erwartet); der
  Aufruf des `recovery_check`-Tools wirft real: _„Recovery-Check
  fehlgeschlagen: kein Workspace-Snapshot (spawnSync git ENOBUFS). Die
  Schreibsperre bleibt bestehen."_ — ein erneuter `write`-Versuch danach ist
  weiterhin blockiert. Das Gate ist damit strukturell unlösbar, solange der
  große Diff im Workspace bleibt.
- **Ergebnis:** **bestätigt** (nicht widerlegt) für F-01 und F-02, jeweils
  end-to-end reproduziert (nicht nur statisch belegt).
- **Entscheidung/Änderung:** n/a — Entscheidung/Fix erst in Phase 1.
- **geänderte Dateien:** keine (Phase 0 ist reine Evidenzerhebung).
- **fokussierte Tests:** n/a — kein bestehender Test deckt einen
  Snapshot-Fehler >1 MiB ab (Lücke selbst ist Teil des Befunds, siehe
  Original-Audit Abschnitt 9).
- **Commit/ADR:** n/a — erst Phase 1.
- **Rest-Risiko:** hoch bis Phase 1 behoben ist — jeder Commit/jede Recovery
  mit einem Diff >~350 KB Text bzw. ~700 KB Binär ist betroffen.
- **Rückweg/Wiederaufnahme-Trigger:** n/a (keine Änderung vorgenommen).

#### Phase-1-Nachweis — F-01 bis F-03

- `collectWorkspaceSnapshot()` hasht staged und unstaged Patches jetzt per
  `spawn()` in Chunks. Es liefert denselben typisierten Ergebnisvertrag an
  alle Aufrufer, wiederholt nur begrenzt bei einer instabilen Erfassung und
  akzeptiert auch ein Repository vor seinem ersten Commit.
- **F-01:** Ein nicht erfassbarer Snapshot blockiert nun jeden `git commit`
  sichtbar. Ein großer Diff im Verifier-Pflichtpfad bleibt ohne passenden PASS
  blockiert; ein passender PASS entsperrt ihn auch beim ersten Commit.
- **F-02:** Der Recovery-Check verarbeitet einen großen gültigen Diff, bleibt
  bei einem echten Snapshotdefekt geschlossen und nennt `git status --short`
  sowie `git log -1` als nicht-destruktiven Prüfweg. Seine Anzeigeausgabe ist
  während des Einlesens begrenzt.
- **F-03:** Ein fertig gemeldeter Verifier-Lauf ohne erfassbaren Snapshot
  verwirft ein zuvor gebundenes Urteil. Asynchrone Verifier-, Recovery- und
  Sessionereignisse dürfen keinen Zustand in eine neue Sitzung schreiben.
- **Nachweise:** Typecheck, fokussierte Gate-Regressionen (136 Assertions),
  Runtime 1481/1481, Workflow 599/599 und Coverage ohne Einbruch sind grün.
  Das vollständige `npm --prefix npm run verify` sowie der unabhängige
  Verifier sind grün. Der aktuelle `project_check({ profile: "verify" })`-
  Lauf ist ebenfalls mit Exit 0 durchgelaufen und hat den Footer-/Ledger-
  Nachweis aktualisiert.

### F-19 – Pfadbasis

- **Ausgangsverhalten:** `collectWorkspaceSnapshot()` mischt in `changedFiles`
  Pfade aus `git diff --name-status` (repo-root-relativ, unabhängig vom
  `cwd`) mit Pfaden aus `git ls-files --others --exclude-standard`
  (cwd-relativ, ohne `--full-name`).
- **Reproduktion (Testmatrix, Temp-Repo mit `extensions/permissions/`-Unterordner,
  `collectWorkspaceSnapshot()` je aus Repo-Root und aus dem Unterordner
  aufgerufen, `matchingVerifierRequiredPaths()` aus
  `extensions/permissions/verifier-required-paths.ts` real importiert):**

  | Fall                       | Pfad aus Root-Aufruf                | Pfad aus Unterordner-Aufruf                     | Required-Path-Treffer aus Unterordner |
  | -------------------------- | ----------------------------------- | ----------------------------------------------- | ------------------------------------- |
  | staged (M)                 | `extensions/permissions/tracked.ts` | `extensions/permissions/tracked.ts` (identisch) | ✅ erhalten                           |
  | unstaged (M)               | `extensions/permissions/tracked.ts` | `extensions/permissions/tracked.ts` (identisch) | ✅ erhalten                           |
  | rename (staged)            | `extensions/permissions/renamed.ts` | `extensions/permissions/renamed.ts` (identisch) | ✅ erhalten                           |
  | delete (staged)            | `extensions/permissions/loose.ts`   | `extensions/permissions/loose.ts` (identisch)   | ✅ erhalten                           |
  | **untracked (neue Datei)** | `extensions/permissions/loose.ts`   | **`loose.ts`** (Präfix verloren)                | ❌ **Treffer verloren**               |

- **Reale Erreichbarkeit:** `ctx.cwd` wird in `guards.ts:117-119` direkt als
  drittes Argument an `assessGitCommitVerifierGate` durchgereicht. Im
  installierten SDK (`@earendil-works/pi-coding-agent`) ist `cwd` schlicht
  `process.cwd()` (siehe `dist/core/sdk.js` Doku-Kommentar,
  `dist/core/session-manager.js:597` `resolvePath(cwd)`) — nichts erzwingt,
  dass `pi` aus dem Repo-Root gestartet wird. Ein Start aus einem Unterordner
  (z. B. `cd extensions/permissions && pi`) reicht, damit der Bug real greift.
- **Ergebnis:** **bestätigt**, aber auf den **untracked-Fall begrenzt** —
  staged/unstaged/rename/delete sind alle root-relativ und bleiben korrekt
  erkannt, unabhängig vom Aufrufort. Eine neue, noch nicht `git add`ete Datei
  in einem geschützten Verzeichnis kann das Verifier-Pflicht-Gate umgehen,
  wenn der Agent aus einem Unterordner heraus läuft.
- **Entscheidung/Änderung:** n/a — Fix erst in Phase 2/4 (laut Matrix
  Phase 0/4).
- **geänderte Dateien:** keine.
- **Commit/ADR:** n/a.
- **Rest-Risiko:** mittel — Voraussetzung (Start aus Unterordner) ist nicht
  der Normalfall, aber nicht ausgeschlossen und nicht dokumentiert verboten.
- **Rückweg/Wiederaufnahme-Trigger:** n/a.

### F-23 – Runtime-Metadaten

- **Ausgangsverhalten (zwei getrennte, nicht zu vermengende Fakten):**
  1. `lastChangelogVersion: 0.84.4` in `settings.json:2` ist ein reiner
     „Changelog gesehen"-Cursor der global installierten CLI
     (`dist/core/settings-manager.js:442-449`,
     `dist/modes/interactive/interactive-mode.js:962-973`: Vergleich gegen
     die CLI-eigene `VERSION`-Konstante, danach Rückschreiben). `grep -rn
lastChangelogVersion extensions/ shared/ scripts/` → keine Treffer:
     **kein Codepfad in diesem Repo liest oder schreibt diesen Wert.**
  2. `scripts/apply-runtime-patches.mjs:50` definiert eigenständig
     `EXPECTED_RUNTIME_VERSION = "0.84.3"` und prüft das **fail-closed**
     gegen die tatsächlich installierte Runtime (Zeile 519-528): weicht die
     Version ab, wirft das Skript `Runtime ist ${version}, die Patches sind
gegen ${EXPECTED_RUNTIME_VERSION} geschrieben. […] EXPECTED_RUNTIME_VERSION
nachziehen, oder bewusst mit --allow-version-drift fortfahren.` — außer
     `--allow-version-drift` wird explizit gesetzt.
- **Reproduktion/Nachweis:** `npm ls -g @earendil-works/pi-coding-agent` →
  `0.84.4` installiert. `grep -rn EXPECTED_RUNTIME_VERSION` →
  `scripts/apply-runtime-patches.mjs`, `tests/p1-runtime.mjs`,
  `tests/runtime-patches.mjs` (Pin `0.84.3` an allen Stellen konsistent).
  **Damit besteht aktuell realer Versions-Drift** zwischen der installierten
  Runtime (`0.84.4`) und dem Patch-Anker (`0.84.3`) — beim nächsten Lauf von
  `apply-runtime-patches.mjs` ohne `--allow-version-drift` würde das Skript
  sicher (fail-closed) mit obiger Fehlermeldung abbrechen. `tests/runtime-patches.mjs`
  (Teil der bereits grün gelaufenen `test:patches`-Baseline) lief in dieser
  Session grün durch — zu klären (nicht Teil von Phase 0), ob dieser Test
  denselben Versionscheck durchläuft oder ihn umgeht.
- **Ergebnis:** **bestätigt** als realer, aktueller Zustand — **nicht**
  „widerlegt", wie eine oberflächliche Lesart von `lastChangelogVersion`
  allein nahelegen würde. Der Zustand ist aber bereits sicher (fail-closed)
  abgefangen, kein stiller Defekt.
- **Entscheidung/Änderung:** n/a — ob Runtime auf `0.84.4` gehoben und
  Patches nachgezogen werden, oder bewusst bei `0.84.3` geblieben wird, ist
  eine Entscheidung für eine spätere Phase (laut Master-Arbeitsauftrag
  „Paket C — Entscheidungen vor der Umsetzung").
  Kein Upgrade-Experiment, kein `--allow-version-drift`-Lauf in Phase 0.
- **geänderte Dateien:** keine.
- **Commit/ADR:** n/a.
- **Rest-Risiko:** niedrig (fail-closed abgesichert), aber
  Handlungsbedarf zur Klärung besteht.
- **Rückweg/Wiederaufnahme-Trigger:** n/a.

### F-27 – Session-Mismatch

- **Ausgangsverhalten:** `consumeApproval()` (`extensions/plan-mode/session.ts:240-258`)
  verbraucht `planApproval` (Zeile 248: `planApproval = undefined`) **vor**
  dem Vergleich `grant.sessionId !== ctx.sessionManager.getSessionId()`
  (Zeile 249) und ruft bei Mismatch — anders als der Hash-Mismatch-Zweig
  direkt darunter (Zeile 251-257, mit `session.notify(...)`) — **keine**
  Benachrichtigung auf. Der Ordering-Bug selbst ist im Code eindeutig und
  unstrittig.
- **Reale Erreichbarkeit (Kernfrage von 0.4, per Codearchäologie geklärt,
  keine synthetischen Direktaufrufe verwendet):**
  1. `createWorkflowSession(pi)` (`extensions/plan-mode/session.ts:88`) wird
     einmal pro Extension-Initialisierung aufgerufen
     (`extensions/plan-mode/index.ts:9`); `planApproval` lebt als
     Closure-Variable dieses einen Aufrufs.
  2. `session_start` löst zusätzlich `session.resetForSession()` aus
     (`extensions/plan-mode/events.ts:89-91`), was `planApproval` explizit
     löscht.
  3. Im installierten SDK (`@earendil-works/pi-coding-agent`,
     `dist/core/extensions/loader.js`) existiert zwar ein modulweiter
     `extensionCache` (`Map`, per `cwd` invalidiert, Zeile ~117-133) — dieser
     cacht aber nachweislich nur die **jiti-transpilierte Factory-Funktion**
     (`loadExtensionModule()`, Zeile 410-436: `extensionCache.set(extensionPath, factory)`),
     **nicht** eine bereits instanziierte Registrierung. Die eigentliche
     Instanziierung passiert in `initializeExtension()`
     (Zeile 459-463): `await factory(load.api)` — mit einem **frisch
     erzeugten** `extension`/`load.api`-Objekt bei jedem Aufruf. Jede
     `factory(pi)`-Ausführung (also jeder `createWorkflowSession(pi)`-Aufruf)
     erzeugt damit ein neues `let planApproval` in einer neuen Closure.
  4. `AgentSession` (`dist/core/agent-session.js:2127`) instanziiert
     `this._extensionRunner = new ExtensionRunner(...)` als
     Instanzeigenschaft, gebunden an `this.sessionManager` — pro Session
     also ein eigener `ExtensionRunner`.
  5. Zusammengenommen: Ein Cross-Session-Zugriff auf dasselbe
     `planApproval` würde voraussetzen, dass zwei verschiedene Sessions
     dieselbe bereits instanziierte Extension-Registrierung teilen — das ist
     nach dem oben belegten Cache-Mechanismus (nur Factory-Funktion gecacht,
     nicht deren Ausführungsergebnis) **architektonisch nicht der Fall**.
  6. Einschränkung: Der RPC-/Frontend-Server-Pfad
     (`gui/main/pi-rpc-manager.js`) wurde nicht mit derselben Tiefe wie der
     CLI/TUI-Kern nachverfolgt; es gibt aber keinen Hinweis, dass dort ein
     anderer Instanziierungsmechanismus als der oben belegte
     `AgentSession`/`ExtensionRunner`-Pfad verwendet wird.
- **Ergebnis:** **widerlegt bezüglich Produktions-Erreichbarkeit** — der
  Ordering-Bug im Code ist real, aber ohne einen nachweisbaren Weg, ihn im
  normalen CLI/TUI/RPC-Betrieb auszulösen (jede Session erhält eine frisch
  instanziierte, isolierte `planApproval`-Closure). Wird trotzdem **nicht
  verschwiegen**: als „Defense-in-Depth-Lücke ohne bestätigten
  Erreichbarkeitspfad" festgehalten, da stille Zustandsänderungen laut
  Master-Arbeitsauftrag grundsätzlich sichtbar gemacht werden sollen.
- **Entscheidung/Änderung:** n/a — ob der Ordering-Bug trotz fehlender
  Erreichbarkeit als Hygiene-Fix behoben wird, entscheidet sich in Phase 3.
- **geänderte Dateien:** keine.
- **Commit/ADR:** n/a.
- **Rest-Risiko:** niedrig (kein bestätigter Erreichbarkeitspfad).
- **Rückweg/Wiederaufnahme-Trigger:** falls künftig ein SDK-Mehrsession-Modus
  eingeführt wird, der Extension-Instanzen explizit über Sessions hinweg
  teilt, ist diese Einordnung neu zu prüfen.

### F-06 – project-write/YOLO bei Interpretern asymmetrisch

- **Ausgangsbefund:** `project-write` ließ opake Interpreteraufrufe wie
  `node -e` und `python -c` ohne Rückfrage durch, obwohl ein solcher Aufruf
  beliebigen Code ausführen kann. YOLO blockierte dieselbe Form bereits hart;
  readonly ließ sie nur bei nachweislich rein lesenden Befehlen zu.
- **Entscheidung:** Die gezielte Option 2 aus `03_PHASE_2_RESTLICHE_P1.md`
  ist umgesetzt (ADR
  [`022`](../docs/decisions/022-project-write-interpreter-boundary.md)):
  Inline-Code, stdin-Code und explizit externe Interpreter-Skripte fragen in
  `project-write` nach; ein literal angegebener, projektinterner Skriptpfad
  bleibt erlaubt. Die bestehende readonly-Sperre und YOLO-Hard-Blockade bleiben
  unverändert.
- **Policy-Matrix (produktnah über `decideBash()`):**

  | Form | readonly | project-write | confirm-all | yolo |
  | ---- | -------- | ------------- | ----------- | ---- |
  | `node -e` | block | ask | ask | block |
  | `python3 -c` | block | ask | ask | block |
  | stdin (`printf … \| python3 -`) | block | ask | ask | block |
  | internes Skript (`node scripts/check.mjs`) | block | allow | ask | block |
  | externes Skript (`node /tmp/script.mjs`) | block | ask | ask | block |
  | direkter externer Schreibpfad (`touch /tmp/out`) | block | ask | ask | block |

- **Rest-Risiko:** Die Erkennung ist eine Kommandoformprüfung, keine
  OS-Sandbox und keine Inhaltsanalyse. Ein erlaubtes internes Skript läuft mit
  den Rechten des Pi-Prozesses; Aliase, Funktionen und Skriptinhalte können
  weiterhin eigene Wirkungen haben. Shell-Variablen, Symlink-Ausbrüche,
  Secret-/Systemgrenzen und externe Schreibpfade bleiben separat geschützt.
  Die Rückfrage bzw. die Wahl von readonly/confirm-all ist der dokumentierte
  Rückweg.
- **Evidenz:** `tests/workflow-mode/permissions.test.mjs` prüft die sechs
  Formen über alle vier Stufen; `npm --prefix npm test` war danach mit 639
  Workflow-Assertions und ohne Fehler grün.

### F-09 – autoritative Pfad-/Symlink-Policy statt konkurrierender Zweige

- **Ausgangsbefund:** `assessWorkflowTool()` in
  `extensions/permissions/workflow-policy.ts` blockierte bereits jeden
  Projekt-/Symlink-Ausbruch vor `decideTool()`. `decideFileAccess()` enthielt
  daneben unerreichbare stufenabhängige Zweige für externe Reads, externe und
  System-Schreibpfade sowie Symlink-Schreibzugriffe. Die dortige Runtime-
  Dokumentationsausnahme wurde anschließend durch die Stufenlogik wieder
  blockiert.
- **Entscheidung/Änderung:** `workflow-policy.ts` ist alleiniger Besitzer der
  harten Projekt-, System-, Secret- und Symlink-Grenze. `decideFileAccess()`
  entscheidet nach erfolgreicher Hard-Layer-Prüfung nur noch die Zugriffsstufe
  und behält die echte projektinterne Ausführungspfad-Regel. Die Hard-Layer-
  Ausnahme für einen dokumentierten Runtime-Read wird als explizites
  `allowOutsideProjectRead`-Ergebnis durch `guards.ts` und `tool-policy.ts`
  weitergereicht; sie ist damit auf allen Zugriffsstufen end-to-end wirksam.
- **Vorher/Nachher-Matrix des vollständigen Pfadteils:**

  | Fall | Vorher: Hard-Layer / Stufe | Nachher: Hard-Layer / Stufe |
  | ---- | -------------------------- | --------------------------- |
  | interner Read | durch Stufe erlaubt | Hard-Layer passiert; readonly/project-write/confirm-all/yolo: allow |
  | externer Read | Hard-Layer blockiert | Hard-Layer blockiert auf allen Stufen |
  | Runtime-Doku-Read | Hard-Layer-Ausnahme, danach erneut block/ask | Hard-Layer-Ausnahme + explizite Übergabe; alle Stufen: allow |
  | interner normaler Write | Hard-Layer passiert; readonly block/project-write allow/confirm-all ask/yolo allow | gleich |
  | interner Ausführungspfad-Write | Hard-Layer passiert; project-write/confirm-all ask, yolo block | gleich; Stufenregel bleibt erhalten |
  | externer Write | Hard-Layer blockiert | Hard-Layer blockiert auf allen Stufen |
  | Systempfad-Write | Hard-Layer blockiert und tote Stufenlogik | Hard-Layer blockiert auf allen Stufen |
  | Symlink-Ausbruch Read/Write | Hard-Layer blockiert; Write-Zweig zusätzlich redundant | Hard-Layer blockiert auf allen Stufen; kein konkurrierender Write-Zweig |
- **Rest-Risiko:** `decideFileAccess()` ist bewusst eine zweite Stufe und kein
  eigenständiges Hard-Gate; direkte interne Nutzung ohne vorgelagerte
  `assessWorkflowTool()`-Prüfung ist kein Produktionspfad. Die Guard-Reihenfolge
  ist deshalb Teil des Contracts und wird als zusammengesetzter Pfad getestet.
- **Evidenz:** `tests/workflow-mode/permissions.test.mjs` prüft externe
  Reads/Writes und Runtime-Doku-Reads über alle vier Zugriffsstufen nach
  `assessWorkflowTool()` und vor `decideTool()`; die Resilience-Suite prüft
  zusätzlich den echten `tool_call`-Guard. Die entfernten Zweige haben keine
  verbleibenden Test- oder Produktionsaufrufer.

### F-15 – Zwei Module namens frontend-protocol (nur Fakten, keine Entscheidung)

- **Ausgangsverhalten:** `extensions/frontend-protocol/` (intern, EventBus-Vertrag,
  `PROTOCOL_VERSION = "1.1.0"` als String, `state-contract.ts:17`) vs.
  `npm/packages/frontend-protocol/` (eigenständiges npm-Paket
  `@daydaylx/pi-frontend-protocol`, JSONL-Wire-Vertrag, `PROTOCOL_VERSION = 1`
  als Zahl, `src/constants.ts:1`) — unterschiedliche Dateistruktur, kein
  Re-Export zwischen beiden gefunden, **unterschiedlicher Typ** (String vs.
  Zahl), nicht nur unterschiedlicher Wert.
- **Konsumenten:** `frontend-server/index.mjs`, `gui/renderer/interaction-helpers.js`,
  `gui/test/security.mjs`, `gui/test/shortcut-parity.mjs`, `gui/README.md`
  referenzieren „frontend-protocol" — welches der beiden Module im Detail,
  wurde in Phase 0 nicht bis auf Importzeile aufgelöst (Faktenlage für
  Phase 4 ausreichend, da dort ohnehin ein vollständiger Konsumenten-Grep
  nötig ist).
- **Abhängigkeiten:** Namenskollision betrifft Suche/Imports; Divergenzrisiko
  zwischen EventBus- und Wire-Vertrag, falls unabhängig weiterentwickelt.
- **Offene Faktenfragen:** Ist `npm/packages/frontend-protocol` bewusster
  Fork für externe Stabilität oder unbeabsichtigt divergiert? Umbenennung
  eines der beiden Module ist laut Master-Arbeitsauftrag „Paket C" eine
  Vor-Freigabe-Entscheidung.
- **Entscheidung/Änderung:** n/a — Entscheidung erst in Phase 4.

### F-24 – Große Lauf-/Historienartefakte im Repo (nur Fakten, keine Entscheidung)

- **Ausgangsverhalten:** `dist/` (418 MB), `sessions/` (311 MB), `backups/`
  (20 MB), `run-history.jsonl` (1,4 MB), `models-store.json` (328 KB),
  `pi-crash.log`/`pi-debug.log` sind alle per `.gitignore` ausgeschlossen und
  laut `git ls-files` **0 getrackte Dateien** — reiner Laufzeitzustand, kein
  Repo-Bloat. Tatsächlich versioniert (git ls-files) sind zwei Kandidaten:
  `benchmarks/` (90 Dateien, 7,5 MB) und die drei Top-Level-Arbeitsauftragspakete
  `pi_gui_arbeitsauftrag/` (16 Dateien, 64 KB), `pi_gui_cursor_redesign/`
  (29 Dateien, 1,1 MB), `pi_benchmark_befunde_arbeitsauftraege/` (16 Dateien,
  64 KB) — zusammen ca. 1,2 MB, konsistent mit den Größenangaben im
  Original-Audit. `.gitignore` enthält keinen `benchmark`-Eintrag — die
  Versionierung von `benchmarks/` ist damit eine bewusste, keine
  versehentliche Entscheidung (deckt sich mit dem Original-Audit-Hinweis,
  dass die Rohdaten „auf Nutzerwunsch vollständig committet" sind).
- **Reale Wirkung:** Repo-Clone-Größe/-Historie wächst durch diese beiden
  Kandidaten, nicht durch die bereits ausgeschlossenen Pfade.
- **Abhängigkeiten:** Nicht-Ziel im Master-Arbeitsauftrag („Stage 2,
  Benchmarks … unberührt lassen") — keine Löschung/kein Housekeeping ohne
  ausdrückliche Freigabe. `docs/scope-cli-tui-vs-gui.md` referenziert die
  drei Arbeitsauftragspakete.
- **Offene Faktenfragen:** Aufbewahrungszweck von `benchmarks/`
  (Reproduzierbarkeit einzelner Real-Duel-Läufe) und der drei Pakete
  (historisch, Phasen laut `PROJECT_STATE.md` abgeschlossen); definierter
  Rotations-/Housekeeping-Trigger nicht vorhanden.
- **Entscheidung/Änderung:** n/a — Entscheidung („bewusst behalten" vs.
  „deferred" vs. Archivierung mit Freigabe) erst in Phase 4.

## F-10 Performance

Die Prozessbilanz einer stabilen `collectWorkspaceSnapshot()`-Erfassung ist
12 Git-Prozessstarts: je fünf günstige Status-/Index-Abfragen vor und nach der
Erfassung plus zwei gestreamte Patch-Hashes. Die beiden Generationserfassungen
bleiben für die Mutationserkennung erforderlich; sie wurden nicht durch einen
unsicheren Cache ersetzt.

| Szenario | Vorher: Prozesse / Latenz / Speicher | Nachher: Prozesse / Latenz / Speicher | Bewertung |
| -------- | ------------------------------------ | ------------------------------------- | --------- |
| kleiner normaler Workspace, kein Recovery-/Verifier-Gate | 0 / 0 / 0 Snapshot-Arbeit | 0 / 0 / 0 Snapshot-Arbeit | unverändert |
| aktives Recovery-Gate, reiner `read` | 1 Snapshot / 12 Git / untracked content nur im Snapshot | 0 / 0 / 0 | redundante Statusabfrage vollständig entfernt; Read bleibt frei |
| aktives Recovery-Gate, diagnostisches `git status` | 1 Snapshot / 12 Git / Snapshot-Speicher | 0 / 0 / 0 | redundante Statusabfrage vollständig entfernt |
| aktives Recovery-Gate, `write`/`edit` oder nicht-diagnostische Bash | 1 Snapshot / 12 Git / Snapshot-Speicher | 1 / 12 / unverändert | Sicherheitsprüfung bleibt unmittelbar vor der Entscheidung |
| Verifier-Dedup auf unverändertem Diff | 1 Snapshot / 12 Git / Snapshot-Speicher | 1 / 12 / unverändert | fachlich notwendige Evidenz, kein Cross-Tool-Cache |
| großer Diff oder Mutation während Snapshot | 1+ Erfassungen / je 12 Git / bounded patch stream | 1+ / je 12 Git / bounded patch stream | F-01–F-03-Konsistenz und Retries unverändert |

Die Latenzreduzierung auf den beiden übersprungenen Pfaden entspricht dem
vollständig entfallenden Snapshot-Await; auf sicherheitsrelevanten Pfaden gibt
es absichtlich keine Reduktion. Der Regressionstest zählt die Recovery-
Capability-Anfragen und belegt, dass Read/diagnostisches Bash im aktiven Gate
keinen redundanten Snapshot mehr auslösen. Es gibt keinen langlebigen
Tool-/Turn-/Session-Cache.

## Checkpoint-A-Nachweis

F-01–F-10 sind im Arbeitsbaum bearbeitet; der kanonische Abschlusscheck ist
mit Exit 0 abgeschlossen. Es wird kein Commit erzeugt.

- `verify` Exit: 0 — `project_check({ profile: "verify" })`, vollständige Kette grün
- Hauptsuite separat nötig? Ergebnis: ja, `npm --prefix npm test` ist im kanonischen `verify` nicht enthalten; fokussierte Hauptsuite zuletzt grün
- großer Diff / Commit-Gate: grün in `snapshot-gates`/`verification`
- Recovery: grün; Snapshotdefekt bleibt fail-closed
- Verifier-Retry: grün; `completed` ohne Verdict bleibt ungebunden
- TUI/headless Status: grün; Aurora/RPC wird unabhängig von `ctx.hasUI` publiziert
- Git-Commit-Varianten: grün in `verification`
- F-06 Permissionentscheidung: Option 2 gezielt umgesetzt, ADR 022
- F-09 Policygrenzen: vollständige Guard-Matrix grün
- F-10 Messung: Recovery-Read/Diagnose 1 Snapshot → 0; sicherheitsrelevante Pfade unverändert
- F-06 Nachtrag: Redirection-stdin (`python3 < script.py`) ist in der Matrix und im YOLO-Hard-Boundary-Test abgedeckt
- Verifier-PASS: `PASS_WITH_WARNINGS` durch den Sonnet-Review des vorherigen Stands; ein frischer Review nach dem F-06-Follow-up konnte wegen des Sitzungs-Limits (5/5 Subagent-Läufe) nicht gestartet werden — daher kein neuer PASS behauptet
- git status: Arbeitsbaum absichtlich dirty; Audit-Paket bleibt unversioniert

## Checkpoint-A-Abschlussprüfung

Der Checkpoint-A-Nachweis ist für F-01–F-10 vollständig; ein Commit ist nicht
Teil dieses Auftrags.

| Prüfung                            | Exit/Status | Nachweis |
| ---------------------------------- | ----------: | -------- |
| kanonisches `verify`               | **0**       | `project_check({ profile: "verify" })`; Format, Typecheck, Deadcode, Coverage, Patches, Frontend, GUI und Audit grün |
| Hauptsuite / fokussierte Suiten    | **grün**    | Runtime 1495, Workflow 661, LSP 182, Diff 22 sowie übrige Coverage-Suiten ohne Fehlschlag |
| fokussierte Hochrisikoregressionen | **grün**    | F-04–F-10-Regressionen in Runtime-/Workflow-Suiten |
| unabhängiger Verifier              | **PASS_WITH_WARNINGS** (vor Follow-up) | Sonnet; historischer Review mit Baseline-Warning; frischer Review nach dem F-06-Fix steht wegen Sitzungs-Limit aus |
| Gesamtdiff Scopeprüfung            | **grün**    | Änderungen F-04–F-10 zugeordnet; `settings.json` erhalten; Audit-Paket unversioniert |
| git status sauber                  | absichtlich dirty | Kein Commit; bestehende Nutzeränderungen und Audit-Paket bleiben erhalten |

## Bewusst unverändert

(Vorbefüllt aus den Nicht-Zielen des Master-Arbeitsauftrags — inhaltlich erst final zu bestätigen.)

- Shift+Tab/Shortcuts: keine Bedienänderung vorgesehen (Nicht-Ziel).
- LSP-Lebenszyklus: keine Änderung vorgesehen (Nicht-Ziel/vorbildlich laut Original-Audit).
- Electron-Trust-/IPC-Grenze: keine Änderung vorgesehen (Nicht-Ziel/gehärtet laut Original-Audit).
- Plan-Handoff: keine grundlegende Neuarchitektur vorgesehen (Nicht-Ziel).
- Benchmarks/Stage 2: unberührt gelassen (Nicht-Ziel); in Phase 0 keine Benchmark-/Modellläufe gestartet.
- weitere: keine Installation neuer Abhängigkeiten außer `npm ci` nach Lockfile; kein Push/Merge.

## Abschlussurteil

### Critical Remediation

- [x] F-01–F-10 geschlossen (Matrixstatus: behoben)
- [x] kein bestätigter P0/P1 offen/blockiert/deferred
- [x] Checkpoint-A-`verify` grün — kanonischer `project_check({ profile: "verify" })` mit Exit 0
- [x] vorheriger notwendiger Verifier: PASS_WITH_WARNINGS
- [ ] frischer Verifier nach F-06-Follow-up — in dieser Sitzung wegen Subagent-Limit nicht ausführbar

### Gesamtpaket

- [ ] F-01–F-28 klassifiziert
- [x] Checkpoint-A-`verify` grün
- [x] keine Benchmark-/Modellläufe
- [x] keine ungewollte Bedienänderung
- [ ] sauberer Arbeitsbaum

Endurteil: **Phase 2 / Checkpoint-A abgeschlossen.**
F-01–F-10 sind im Arbeitsbaum bearbeitet, in `08_TRACEABILITY_MATRIX.md` als
`behoben` geführt. Der F-06-Follow-up für Redirection-stdin ist durch die
fokussierte Testsuite 661/661 und den anschließenden vollständigen Testcheck
belegt; der kanonische Verify-Lauf auf dem aktuellen Stand ist mit Exit 0
abgeschlossen. Der unabhängige Sonnet-Review des vorherigen Stands meldete
`PASS_WITH_WARNINGS`;
ein frischer Review nach dem Follow-up war in dieser Sitzung wegen des
Subagent-Limits nicht mehr ausführbar. Die historische Warnung zur fehlenden
Einzelhash-Baseline wurde nicht rückwirkend umgedeutet; eine neue Baseline ab
dem aktuellen Stand ist in `10_PROVENANCE_BASELINE.md` dokumentiert. Kein
Commit, Push, Merge, Benchmark-/Modelllauf oder Audit-Paket-Tracking wurde
ausgeführt.
