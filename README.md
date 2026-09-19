# Pi Core CLI/TUI — Aurora Setup

## 1. Projektübersicht

Dieses Repository ist **kein vollständiger Fork** einer Pi-Runtime. Es ist ein
**Setup- und Extension-Layer** um die fest gepinnte externe Runtime
`@earendil-works/pi-coding-agent` (aktuell gegen Version `0.84.3` validiert,
siehe Abschnitt 14). Das Repo besitzt und versioniert:

- `settings.json`, `setup.json`, `keybindings.json`, `models.json`,
  `web-search.json` — die aktive Laufzeitkonfiguration,
- `extensions/` — Core-Extensions (Setup, Permissions, Plan Mode, LSP,
  Resilience, Subagenten-Reduktion, Frontend-Bridge, …) und die
  Terminal-Oberfläche **Aurora**,
- `agents/` — die drei zugelassenen Subagenten-Rollenprompts,
- `skills/`, `prompts/`, `schemas/` — Skill- und Prompt-Konfiguration,
- `tests/`, `benchmarks/` — Regressions- und Leistungsprüfungen,
- `gui/` — eine **im selben Repository liegende** Electron-Desktop-Oberfläche
  (siehe Abschnitt 12 für den genauen, teils widersprüchlichen Stand dazu).

Die Root-Skripte delegieren Installation, Typecheck, Tests und Verifikation an
die etablierte Abhängigkeitsgrenze `npm/` (eigenes `package.json` und
`package-lock.json`, eigene `node_modules`). Der Repository-Root selbst hat
keine eigenen `dependencies` — nur Scripts, die in `npm/` bzw. `gui/`
weiterreichen.

## 2. Architekturübersicht

```text
Core-Runtime und -Extensions (dieses Repo, Layer über @earendil-works/pi-coding-agent)
          |
          +--> neutraler Frontend-State-Bus --> Aurora TUI (extensions/aurora-ui/)
          |
          +--> Frontend-Bridge/-Server --> versioniertes JSONL Frontend API v1
                                             |
                                             +--> gui/ (Electron-Desktop-GUI,
                                                   liegt aktuell IN diesem Repo)
```

- `extensions/aurora-ui/` ist Terminal-UI und bleibt in diesem Repo. Sie ist
  **trotz des Namens keine Electron-GUI** (siehe `docs/scope-cli-tui-vs-gui.md`).
- `extensions/frontend-protocol/` definiert den Vertrag (Commands, Events,
  State-Contract, Shortcut-Mapping) zwischen Core und einer externen
  Frontend-Oberfläche. Er ist zusätzlich unter `npm/packages/frontend-protocol/`
  gepackt und dort unabhängig als `@daydaylx/pi-frontend-protocol` baubar.
  `frontend-server/` (gestartet über `bin/pi-frontend`) adaptiert die
  Runtime-RPC auf diesen stabilen Vertrag.
- `extensions/frontend-bridge/` aggregiert Core-Zustände (Workflow, Task,
  Verification, Changes, Subagenten, Permissions, LSP) für diese Schnittstelle.
- Core-Zustand ist maßgeblich. Frontends dürfen transienten Anzeigezustand
  halten, aber keine Permission-, Workflow-, Modellrouting-, Verifikations-,
  Subagenten- oder Session-Speicherlogik dupliziert implementieren.

**Bekannter, ungelöster Architektur-Widerspruch:** `docs/repository-split-audit.md`
(Stand 2026-09-06) analysiert, `gui/` in ein eigenständiges Repository
`pi-gui` auszulagern, und beschreibt das als **empfohlene Zielstruktur** —
also als noch nicht umgesetzt. Der tatsächliche Repository-Inhalt bestätigt
das: `gui/` liegt vollständig, mit eigenem `package.json`, eigenen Tests und
Electron-Main-Prozess, in diesem Repo (Abschnitt 12). Ältere Formulierungen
(frühere Fassung dieser README, `docs/architecture.md`) behaupten dagegen,
`daydaylx/pi-gui` sei bereits eine **separate** Anwendung/Repository. Dieser
Widerspruch wird hier bewusst nicht stillschweigend aufgelöst — siehe
Abschnitt 12 und die Zusammenfassung am Ende dieser Überarbeitung.

## 3. Voraussetzungen

Exakt gepinnt, nicht nur als Mindestversion (`.nvmrc`, `package.json#engines`,
`packageManager`, sowie `npm/package.json` mit denselben Werten):

- **Node.js `22.23.2`**
- **npm `10.9.8`**
- `git`
- Linux (CI läuft auf `ubuntu-latest`; das ist die einzige durch dieses Repo
  belegte Zielplattform. Andere Betriebssysteme sind nicht durch Code oder CI
  abgedeckt).
- Ein separat installiertes, ausführbares `pi` auf `PATH`, das zu
  `@earendil-works/pi-coding-agent` gehört (siehe Kasten unten). Ohne dieses
  Executable liefert `bin/pi` einen Fehler, und Runtime-Patches sowie
  `tests/p1-runtime.mjs` können keine Runtime finden.
- Für die optionale Desktop-GUI (Abschnitt 12) zusätzlich: die
  Systembibliotheken, die Electron zum Öffnen eines Fensters braucht
  (X11/Wayland-Anzeige bzw. `xvfb` für headless-Smoke-Läufe). Dieses Repo
  installiert oder dokumentiert diese Systempakete nicht; `gui/README.md`
  nennt nur die Aufruf-Kommandos, keine Paketliste.

> **Woher kommt die eigentliche Pi-Runtime?**
> `npm/package.json` führt `@earendil-works/pi-coding-agent` nur als
> **Dev-Dependency** (Version `0.84.3`, für Typecheck/Tests in diesem
> Checkout). Das tatsächlich gestartete `pi`-Executable wird davon
> **ausdrücklich nicht** übernommen: `shared/runtime-resolution.mjs` sucht
> ausschließlich über `--runtime <pfad>`, die Umgebungsvariable
> `PI_RUNTIME_ROOT` oder ein `pi` auf `PATH` — Dev-Dependencies sind nie
> Kandidaten. Wie und woher diese eigenständige Runtime-Installation zu
> beziehen ist, ist **nicht Teil dieses Repositorys** und wird hier nicht
> vermutet; maßgeblich ist die Dokumentation von
> `@earendil-works/pi-coding-agent` selbst. Die Version, gegen die die
> lokalen Runtime-Patches aktuell geschrieben und getestet sind, ist `0.84.3`
> (`EXPECTED_RUNTIME_VERSION` in `scripts/apply-runtime-patches.mjs`).

## 4. Fresh Installation

Reihenfolge für einen leeren Linux-Rechner (z. B. frisches Fedora):

```bash
# 1. Node/npm exakt gemäß .nvmrc bereitstellen (z. B. per nvm)
nvm install 22.23.2 && nvm use 22.23.2

# 2. Repository klonen
git clone <repo-url> pi && cd pi

# 3. Geplante Synchronisation nach ~/.pi/agent prüfen (Dry-Run, Standardziel)
npm run install:user

# 4. Synchronisation tatsächlich ausführen
npm run install:user -- --apply
```

`install:user` (`scripts/install-user.mjs`) kopiert **ausschließlich** eine
feste Allowlist von Pfaden aus diesem Checkout in ein Zielverzeichnis
(Standard `~/.pi/agent`, überschreibbar mit `--target <pfad>` oder der
Umgebungsvariable `PI_CODING_AGENT_DIR`):

```text
AGENTS.md, APPEND_SYSTEM.md, README.md, package.json, settings.json,
setup.json, tsconfig.json, keybindings.json, subagent-tool-description.md,
bin/pi, bin/pi-frontend, frontend-server/, agents/, docs/, prompts/,
extensions/, npm/package.json, npm/package-lock.json,
npm/packages/frontend-protocol/, schemas/, scripts/, shared/, skills/, tests/,
themes/
```

Ausdrücklich **nicht** kopiert, auch innerhalb erlaubter Verzeichnisse:
`auth.json`, `sessions/`, `backups/`, `.git/`, jedes `node_modules/` sowie
`docs/archive/session-logs/`. Ein Symlink im Quell- oder Zielpfad bricht die
Installation kontrolliert ab. Bei einem Upgrade entfernt der Installer
zusätzlich eine feste Liste bekannter Altlasten (`LEGACY_MANAGED`):
`.pi/subagent-tool-description.md`, `agents/planner.md`, `agents/worker.md`,
`agents/reviewer.md`, `extensions/aurora-ui/editor.ts`.

**`gui/`, `bin/pi-gui` und `scripts/package-gui.mjs` stehen nicht in dieser
Allowlist** — die Desktop-GUI wird durch `install:user` nicht installiert
(Details in Abschnitt 12).

```bash
# 5. Abhängigkeiten im installierten Zielverzeichnis bauen
npm ci --prefix ~/.pi/agent/npm --engine-strict
npm --prefix ~/.pi/agent run build
```

`npm run build` baut **nur** das Paket `packages/frontend-protocol` (via
`tsc`). Die übrigen Extensions werden zur Laufzeit direkt über `jiti`
geladen und brauchen keinen eigenen Build-Schritt.

```bash
# 6. Lokale Runtime-Patches auf die installierte Pi-Runtime anwenden
npm --prefix ~/.pi/agent run patch:runtime -- --runtime <pfad-zur-runtime> --apply
```

Ersetzt `<pfad-zur-runtime>` durch die Paketwurzel des installierten
`@earendil-works/pi-coding-agent` (oder `PI_RUNTIME_ROOT` setzen und den Pfad
weglassen). Das Skript bricht kontrolliert ab, wenn die installierte
Runtime-Version von `0.84.3` abweicht; `--allow-version-drift` erzwingt den
Lauf dann ausdrücklich (siehe Abschnitt 14).

```bash
# 7. Patches gegen genau diese Runtime verifizieren
node ~/.pi/agent/tests/p1-runtime.mjs --runtime <pfad-zur-runtime>
```

```bash
# 8. Pi starten
pi
```

Anmeldung/Provider-Zugangsdaten (`auth.json`) werden von der externen
Pi-Runtime selbst verwaltet, nicht von diesem Repository — hier gibt es dazu
keinen dokumentierten oder automatisierten Schritt. Lokal legt die Runtime
`auth.json` mit Zugriffsrechten `0600` ab (siehe Abschnitt 15).

Optional, nur aus dem vollständigen Dev-Checkout heraus (siehe Abschnitt 12):

```bash
npm ci --prefix gui
bin/pi-gui
```

## 5. Update bestehender Installation

```bash
npm run install:user            # Dry-Run: zeigt an, was sich ändern würde
npm run install:user -- --apply # führt Synchronisation + Legacy-Cleanup aus
npm ci --prefix ~/.pi/agent/npm --engine-strict
npm --prefix ~/.pi/agent run build
```

Nach jedem Update der externen Pi-Runtime (`npm update`, neue global
installierte Version) zusätzlich:

```bash
node ~/.pi/agent/tests/p1-runtime.mjs --runtime <pfad-zur-runtime>
```

Ein Versionsfehler bedeutet laut `docs/RUNTIME_PATCHES.md`: die Patches gegen
die neue Version prüfen und portieren (`EXPECTED_RUNTIME_VERSION` in
`scripts/apply-runtime-patches.mjs` nachziehen), nicht den Test abschwächen.
Runtime-Updates haben die Patches in der Vergangenheit wiederholt aus
`node_modules` entfernt — erneutes Anwenden nach jedem Update ist erwartetes
Verhalten, kein Sonderfall.

## 6. Verzeichnisstruktur

| Pfad | Inhalt |
| --- | --- |
| `bin/` | Entry-Points: `pi` (Shim/Delegation), `pi-frontend` (Frontend-Server), `pi-gui` (Electron-Start) |
| `extensions/` | Core-Extensions + Aurora-TUI + Permissions/Shared-Hilfsmodule (Abschnitt 7) |
| `agents/` | Rollenprompts der drei Subagenten (`investigator.md`, `debugger.md`, `verifier.md`) |
| `frontend-server/` | Adapter der Runtime-RPC auf das versionierte JSONL Frontend API v1 |
| `gui/` | Electron-Desktop-GUI „pi gui" — **im Repo, nicht in der install:user-Allowlist** |
| `npm/` | Eigenständige Abhängigkeitsgrenze: `package.json`, `package-lock.json`, `packages/frontend-protocol/` |
| `docs/` | Referenzdokumentation, Decision Log (`docs/decisions/`), Archiv (`docs/archive/`) |
| `skills/` | Skill-Definitionen (u. a. `context-checkpoint`, `security-audit`, `test-ci`, `repo-analyse`) |
| `prompts/` | Prompt-Vorlagen (`analyse.md`, `docs-check.md`, `review.md`, `ui-review.md`) |
| `schemas/` | JSON-Schema für `setup.json` (`setup.schema.json`) |
| `scripts/` | `install-user.mjs`, `apply-runtime-patches.mjs`, `check-npm-audit.mjs`, `check-versioned-tree.mjs`, `check-relative-imports.mjs`, `check-theme-contrast.mjs`, `package-gui.mjs` |
| `shared/` | Wurzelnahe Helfer, die zur Laufzeit importiert werden (`runtime-resolution.mjs`, `workspace-snapshot.mjs`) |
| `tests/` | Regressionssuiten (`run.mjs`-Domänen, `workflow-mode.mjs`, `coverage.mjs`, `p1-runtime.mjs`, `runtime-patches.mjs`, `plan-eval/`, `openrouter-doctor/`) |
| `themes/` | `aurora-night.json` (aktives Theme), `aurora-day.json` |
| `types/` | Globale TS-Shims (`shims.d.ts`) |
| `benchmarks/` | Eigenständiges Duel-Benchmark-Paket (`benchmarks/real-duel/`), nicht Teil von `verify`/CI |
| `settings.json`, `setup.json`, `keybindings.json`, `models.json`, `web-search.json` | Aktive Laufzeitkonfiguration |
| `AGENTS.md`, `APPEND_SYSTEM.md` | Globale Agentenregeln und Kommunikations-Prompt-Zusätze |
| `subagent-tool-description.md` | Sichtbare Beschreibung des reduzierten `subagent`-Tools (Abschnitt 10) |

**Historische Arbeitsauftragspakete im Root**, git-getrackt, aber **nicht**
Teil der install:user-Allowlist und nicht Teil von `verify`/CI:
`pi-audit-remediation-improved-e8196d6/`, `pi-second-opinion-agent/`,
`pi_benchmark_befunde_arbeitsauftraege/`, `pi_gui_arbeitsauftrag/`,
`pi_gui_cursor_redesign/`, `phase2-plan.md`. Sie dokumentieren abgeschlossene
oder historische Arbeitsaufträge und werden hier nur der Vollständigkeit
halber genannt — kein aktiver Code liegt darin.

## 7. Aktive Extensions

Aus `settings.json#extensions` (14 aktive `+`-Einträge, `!extensions/**`
sperrt alles andere per Default):

| Gruppe | Extension(s) | Zweck |
| --- | --- | --- |
| Core / Setup | `extensions/setup-core/index.ts` | Setup, `verify`-Tool (Agent-Verzeichnis), `project_check`, Kontext-/Abhängigkeitsdiagnose |
| Workflow / Plan Mode | `extensions/plan-mode/index.ts` | `work`/`simple_plan`/`detailed_plan`, `plan_write`, hashgebundene Freigabe (Abschnitt 8) |
| Permissions | `extensions/mode-permissions.ts` (Logik in `extensions/permissions/`) | Einziger Interceptor für `tool_call`/`user_bash`; Berechtigungsstufen, YOLO-Stufen, `headless` (Abschnitt 9) |
| LSP | `extensions/lsp/index.ts` | Optionale, read-only LSP-Integration; Server werden erst beim ersten `lsp_*`-Tool-Aufruf gestartet |
| Ask User | `extensions/ask-user.ts` | `ask_user`-Tool: Entscheidungskarte mit 2–4 Optionen inkl. Freitext |
| Diff / Tools | `extensions/diff-viewer/index.ts`, `extensions/compact-tools/index.ts`, `extensions/control-plane.ts` | Session-basierte Diff-Darstellung; kompaktierte `bash`/`read`/`grep`/`find`/`ls`/`write`-Ergebnisse; globale Tastaturkürzel (dispatchen kanonische Slash-Commands) |
| Aurora TUI | `extensions/aurora-ui/index.ts` | Footer, Session-Panel, Task-Dashboard, Aktivitätsanzeige (Abschnitt 11) |
| Resilience / Session Health | `extensions/resilience/index.ts`, `extensions/session-health/index.ts` | Kompakte Fehler-Telemetrie + Recovery-Marker in der Session-JSONL; `/session-health` als read-only Auswertung derselben Datei |
| Frontend Bridge | `extensions/frontend-bridge/index.ts` (Vertrag in `extensions/frontend-protocol/`) | Bringt Core-Zustände über die RPC-Grenze für externe Frontends |
| OpenRouter Doctor | `extensions/openrouter-doctor/index.ts` | `/openrouter-doctor`: diagnostiziert konfigurierte OpenRouter-Modelle, verändert nie Konfiguration |
| Second Opinion | `extensions/second-opinion/index.ts` | `second_opinion`-Tool: unabhängige Zweitmeinung eines separat konfigurierbaren Providers/Modells, mit Secret-Redaktion und Größenlimits im Kontext-Manifest |

`extensions/shared/` ist keine eigene Extension, sondern eine fachübergreifende
Helfer-Bibliothek (Permission-Policy, Command-Katalog, Layout, Menüs, …), die
von mehreren der obigen Extensions importiert wird.

## 8. Workflow / Plan Mode

Drei flüchtige, nicht persistierte Modi: `work`, `simple_plan`,
`detailed_plan`. Shift+Tab wählt nur den Modus und startet **keinen**
Agent-Turn.

1. **Planen** — nächster echter Nutzer-Turn erhält den Planning-Prompt; das
   Ergebnis landet ausschließlich über das Tool `plan_write` in
   `~/.pi/agent/plans/<workspace-key>/<session-id>.md` (bzw. unter
   `PI_CODING_AGENT_DIR`), nie im Arbeitsbaum.
2. **Entscheiden** — `/plan-decide` bietet **Plan ausführen**, **Weiter
   planen** oder **Ohne Ausführung nach Work wechseln**.
3. **Umsetzen** — nur „Plan ausführen" bzw. `/plan-approve` startet einen
   Work-Turn mit dem unveränderten, hashgebundenen Plan.

Die Freigabe ist an genau diesen Plan-Hash, diese Session und diesen einen
Turn gebunden; ein bloßer Moduswechsel nach `work` führt nichts aus und
aktiviert nie YOLO. Der Plan wird als separate `role: custom`-Nachricht
übergeben, nicht in den Systemprompt interpoliert (`plan-mode/prompts.ts` /
`plan-context.ts`); Kontrollzeichen und die Datenblock-Begrenzer werden
bereinigt. Größenlimits: `plan_write` lehnt Pläne über 64 KiB hart ab;
eingefügt werden maximal 24 KiB, mit sichtbarem Kürzungshinweis.

Während `simple_plan`/`detailed_plan` blockiert der Mutationsschutz jeden
Schreibzugriff in den Arbeitsbaum (nur `plan_write` darf schreiben); positiv
erlaubt bleiben `read`, `grep`, `find`, `ls`, `recovery_check`, `ask_user`,
lokale LSP-Tools, vertrauensgebundene read-only-Webtools sowie
`verify({ check: "typecheck" })`. Im Plan-Modus ist genau eine synchrone,
artefaktfreie `investigator`-SINGLE-Delegation erlaubt; `debugger`, `verifier`
und alle Management-Aktionen bleiben dort gesperrt. Details:
[`extensions/plan-mode/README.md`](extensions/plan-mode/README.md),
[`docs/decisions/012-plan-mode-mutation-guard.md`](docs/decisions/012-plan-mode-mutation-guard.md),
[`docs/decisions/020-explicit-plan-approval.md`](docs/decisions/020-explicit-plan-approval.md).

## 9. Permissions

`extensions/mode-permissions.ts` ist die **einzige** Extension, die
`tool_call`/`user_bash` abfängt. Fünf Stufen existieren im Code
(`extensions/shared/workflow-status.ts`); vier davon sind über `/permission`
wählbar:

| Stufe | Auswahl | Beschreibung |
| --- | --- | --- |
| `readonly` | `/permission` | Projekt lesen, sichere Inspect-Shell; im Plan-Modus nur der Plan selbst beschreibbar |
| `project-write` | `/permission` | Gewöhnliche Projektänderungen; riskante/destruktive/externe Aktionen einzeln bestätigen |
| `confirm-all` | `/permission` | Jede Mutation und jede externe Aktion einzeln bestätigen |
| `yolo` (3 Stufen) | `/permission`, `/yolo 1\|2\|3` | Temporärer Bypass, siehe unten |
| `headless` | **nicht** im `/permission`-Menü (explizit ausgefiltert) | Automatischer Default für einen frischen Session-Start **außerhalb der TUI** ohne persistierte Wahl |

**YOLO in drei Stufen** (Entscheidung 029, `/yolo 1|2|3`):

- **YOLO 1** (`yolo`) — sichtbarer Bypass ohne Rückfragen innerhalb des
  Projekts; harte Secret-, System-, Symlink- und Trust-Grenzen sowie der
  Plan-Mode-Schreibschutz bleiben aktiv.
- **YOLO 2** (`yolo-ask`) — wie YOLO 1, aber jede harte Grenze (sudo,
  Systempfade, Secrets, Pfade außerhalb des Projekts, opake Interpreter)
  fragt einzeln mit Gefahr-Dialog nach.
- **YOLO 3** (`yolo-full`) — voller Zugriff ohne Rückfragen, auch sudo,
  Systempfade, Secrets und externe Pfade; nur Trust-Grenze und
  Plan-Mode-Schreibschutz bleiben aktiv.

**`headless`** — ohne TUI-Kanal gibt es keinen Bestätigungsdialog:
projektlokale Build-/Test-/Lint-/Typecheck-Kommandos sind erlaubt (inkl.
eng gefasstem `npx`/`npm exec`-Carve-out für bekannte Dev-Tools), jede sonst
bestätigungspflichtige Aktion (Secrets, Systemgrenzen, destruktive Befehle,
externe Schreibzugriffe, opake Interpreter) bricht strukturiert ab statt zu
fragen. Diese Stufe ist für nicht-interaktive/RPC-artige Session-Starts
gedacht und taucht bewusst nicht in der interaktiven Stufenwahl auf.

Subagenten-Delegationen (`subagent`) sind auf `project-write`, `confirm-all`
und `yolo` ohne zusätzliche Bestätigung erlaubt (Entscheidung 018);
`readonly` bleibt für Delegationen vollständig gesperrt.

Für Bash sind auf eingeschränkten Stufen nur `git status`/`diff`/`log`, `rg`,
`find` ohne mutierende Optionen sowie reine Lesewerkzeuge (`pwd`, `ls`,
`cat`, `head`, `tail`, `wc`, `stat`, `du`, `df`, `tree`, `sort`, `uniq`)
zulässig. Harte Trust-, Secret-, Symlink-, Projekt- und Systemgrenzen bleiben
auf **jeder** Stufe blockiert, YOLO 1 eingeschlossen — Schreibzugriffe auf
`.git/`, `.pi/lsp.json` und `.pi/verify.json` erfordern immer eine
Bestätigung, weil dort Geschriebenes später ausgeführt wird. Details:
[`docs/decisions/029-yolo-three-stufen.md`](docs/decisions/029-yolo-three-stufen.md),
[`docs/decisions/016-plan-mode-yolo-lock-and-recovery-gate.md`](docs/decisions/016-plan-mode-yolo-lock-and-recovery-gate.md).

## 10. Subagenten

Genau drei lokale, read-only Rollen (`agents/*.md`), gespeist aus dem exakt
gepinnten Fork `daydaylx/pi-subagents`:

| Rolle | Tools | Verantwortung | Modell | Thinking | Fallback |
| --- | --- | --- | --- | --- | --- |
| `investigator` | `read, grep, find, ls` | unbekannte Änderungssurface/Kontrollfluss belegt eingrenzen | `openai-codex/gpt-5.6-luna` | `high` | `qwen-token-plan-individual/qwen3.8-max` |
| `debugger` | `read, grep, find, ls, bash` | unbekannte, intermittierende oder gescheiterte Bugs reproduzieren | `openai-codex/gpt-5.6-luna` | `high` | `qwen-token-plan-individual/qwen3.8-max` |
| `verifier` | `read, grep, find, ls, bash` | riskante Umsetzung unabhängig gegen Auftrag/Diff/Checks prüfen | `anthropic/claude-sonnet-5` | `high` | `openai-codex/gpt-5.6-terra` |

(`settings.json#subagents.agentOverrides`, `settings.json#subagents.modelScope`
mit `enforce: true`.) Keine der drei Rollen besitzt `edit`/`write` oder ein
Delegations-Tool — keine verschachtelte Delegation, kein Chain/Parallel/
Worktree. Alle starten mit frischem Kontext (`defaultContext: fresh`,
`inheritProjectContext: true`, `inheritSkills: false`).

`settings.json#subagents.disableBuiltins: true` deaktiviert alle
Paket-Builtins des Forks vollständig. `extensions/subagent/config.json` setzt
zusätzlich:

```json
{
  "toolSchemaMode": "harness",
  "toolDescriptionMode": "custom",
  "maxSubagentSpawnsPerSession": 5,
  "ui": { "showAsyncWidget": false, "fleetView": false }
}
```

`toolSchemaMode: "harness"` reduziert das `subagent`-Tool-Schema auf
SINGLE-Ausführung plus `list`/`status`/`stop`/`interrupt`; Chain, Parallel,
Agent-CRUD, Scheduling, Worktrees und Sharing scheitern bereits an der
Argumentvalidierung. `toolDescriptionMode: "custom"` steuert nur den
sichtbaren Beschreibungstext (`subagent-tool-description.md`). Es gibt keine
Parallelitätskonfiguration — das Harness führt keine parallelen Subagenten
aus.

Der `verifier` ist nur bei den in `AGENTS.md` definierten
`HARD_VERIFIER_REQUIRED`-Kriterien verpflichtend; Diffgröße allein löst keine
Delegation aus. Eine Verifier-Delegation ohne die in
[`docs/subagents.md`](docs/subagents.md) vorgeschriebenen Abschnitte (Diff,
Baseline, Content-Fingerprints, Akzeptanzkriterien) oder mit einem per Run
gesetzten `turnBudget` wird vor dem Start technisch geblockt.

**Git-Pin:** `settings.json#packages` pinnt
`git:github.com/daydaylx/pi-subagents@f59fc0d26bf055632363e9a4ca778ab1f09b5252`
sowie `npm:pi-web-access@0.24.2`; derselbe Commit-Hash steht als
Tarball-Referenz in `npm/package.json#dependencies.pi-subagents` und im
aufgelösten Eintrag in `npm/package-lock.json`. **Achtung:**
`docs/subagents.md` nennt unter „Live-Pin-Status" einen abweichenden
Commit-Hash (`54c701242710b1dab39a47f23ef8020f40b82bd4`) — das ist ein
veralteter Stand dieser Dokumentationsdatei, nicht die aktuell wirksame
Pin-Konfiguration. Maßgeblich für den tatsächlich geladenen Fork ist
ausschließlich `settings.json#packages`.

`npm/node_modules/pi-subagents` ist eine von `settings.json#packages`
unabhängige zweite Kopie: Sie dient ausschließlich Auroras eigenem Testbaum
(`npm --prefix npm run test`/`verify`), nicht einer echten Pi-Sitzung.

## 11. Aurora TUI

`extensions/aurora-ui/` besitzt Footer, festes Session-Panel, gerahmtes
Task-Dashboard und Arbeitsanzeige. Sie installiert keinen eigenen Editor —
Editing, Historie, Autovervollständigung und Shortcuts kommen aus der Runtime
selbst (`docs/decisions/013-aurora-keeps-the-native-editor.md`). Theme:
`themes/aurora-night.json` (aktiv über `settings.json#theme`), alternativ
`themes/aurora-day.json`. Bewegungsstufe und Dashboard-Darstellung kommen aus
`ui.motion`/`ui.dashboard` der effektiven Setup-Konfiguration
(`contextual`/`reduced`/`off`). Der Footer ist rein lesend: Er startet keinen
Prozess, prüft weder Git noch LSP aktiv und liest keine Datei — alles war
bereits im Laufzeitzustand vorhanden.

## 12. Frontend / GUI

Dieser Abschnitt ist bewusst genau und ohne Beschönigung, da Architektur- und
Vorgängerdokumentation sich hier tatsächlich widersprechen (siehe Abschnitt 2).

**Realer aktueller Zustand:** `gui/` ist eine vollständige, eigenständige
Electron-Anwendung (`package.json#name: "pi-gui-minimal"`, eigenes
`package-lock.json`, eigene `devDependencies.electron` `^44.0.0`), die **in
diesem Repository liegt** — main-Prozess (`gui/main/`), Renderer
(`gui/renderer/`), Tests (`gui/test/`). Sie ist **nicht** Teil der
`install:user`-Allowlist (Abschnitt 4) und wird deshalb **nicht** nach
`~/.pi/agent` installiert. Um die GUI zu nutzen, ist der vollständige
Dev-Checkout dieses Repos nötig, darin separat:

```bash
npm ci --prefix gui
bin/pi-gui                    # startet ./gui/node_modules/.bin/electron gegen ./gui
PATH="$PWD/bin:$PATH" pi gui  # gleichwertig über den bin/pi-Shim
```

`bin/pi` ist nur ein Shim: Bei `pi gui` reicht es an `bin/pi-gui` weiter, bei
jedem anderen Unterbefehl sucht es das erste **andere** `pi`-Executable auf
`PATH` und führt es aus. `bin/pi-gui` selbst führt danach `pi --mode rpc` als
Kindprozess aus und spricht mit ihm über das JSONL Frontend API v1
(`docs/frontend-api.md`); Kernzustände liefert die `frontend-bridge`.

Seit „GUI-v2" (`docs/gui-v2/`) ist die Oberfläche eine eigenständige
Desktop-Coding-Agent-Oberfläche (Chat als Hauptfläche mit sicherem
Markdown-Rendering, kompakte Icon-Navigationsleiste, Inspector rechts statt
Dauer-Dashboard) statt einer 1:1 in Electron übertragenen TUI. Sicherheit:
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, IPC nur
über eine validierte Whitelist (`gui/main/ipc-handlers.js`), CSP
`default-src 'none'`.

```bash
npm --prefix gui test          # Unit-, Session-RPC-, Shortcut-Paritäts-, Security-, Stabilitätstests
node gui/test/e2e-rpc.mjs      # E2E gegen echtes pi (braucht Modellzugriff, NICHT Teil von verify/CI)
npm --prefix gui run smoke     # headless-Smoke via xvfb
node scripts/package-gui.mjs   # -> dist/pi-gui-linux.tar.gz (Linux, primäre Zielplattform)
```

`npm --prefix gui test` läuft ohne vorheriges `npm ci --prefix gui`, weil die
betroffenen Test-Dateien `electron` nur lazy innerhalb einzelner
Funktionen benötigen (`require("electron")` in `gui/main/ipc-handlers.js`),
nicht beim Modul-Import. Deshalb taucht in `.github/workflows/verify.yml`
kein `npm ci --prefix gui`-Schritt auf, obwohl `npm --prefix npm run verify`
`test:gui` einschließt (Abschnitt 13). Echtes Starten der GUI
(`bin/pi-gui`, `smoke`, `smoke:dialogs`) braucht dagegen ein installiertes
`gui/node_modules/electron` und damit `npm ci --prefix gui`.

**Der Architektur-Widerspruch im Detail:** `docs/repository-split-audit.md`
listet `gui/`, `bin/pi-gui` und `scripts/package-gui.mjs` explizit als
„fehlplatziert" und schlägt als **Zielstruktur** ein eigenes Repository
`pi-gui` vor — mit eigenem `bin/pi-gui`, `src/main`, `src/renderer` usw. Das
ist eine Analyse/ein Vorschlag, kein abgeschlossener Schritt: Das Audit-Dokument
selbst formuliert „Abschlusskriterien Phase 1" und hält fest, dass bis zu
seiner Fertigstellung keine Migrationsverschiebungen vorgenommen wurden. Der
aktuelle Commit-Stand von `gui/` liegt sogar **nach** diesem Audit-Datum,
ohne dass eine Auslagerung stattgefunden hat. Aussagen wie „die separate
Desktop-Anwendung `daydaylx/pi-gui`" (frühere README-Fassung,
`docs/architecture.md`) sind durch den aktuellen Repository-Inhalt **nicht
gedeckt** und werden hier als offener, nicht durch dieses Dokument gelöster
Punkt behandelt statt stillschweigend übernommen.

## 13. Verification

Drei unterschiedliche, nicht austauschbare Prüfebenen:

**a) Setup-Verifikation** (`setup.json#verification`, unveränderlich, läuft
immer im Agent-Verzeichnis):

```bash
npm --prefix npm run typecheck   # tsc --noEmit -p tsconfig.json
npm --prefix npm run test        # test:frontend-contracts && tests/run-all.mjs
```

**b) Projekt-Verifikationsprofile** (`.pi/verify.json`, nur in vertrauten
Projekten, über das Tool `project_check`, siehe
[`docs/verify-profiles.md`](docs/verify-profiles.md)) — ergänzt a), ersetzt es
nicht.

**c) Der volle Release-Gate** (identisch zu `.github/workflows/verify.yml`):

```bash
npm --prefix npm run verify
```

Führt der Reihe nach aus:

| Schritt | Was tatsächlich geprüft wird |
| --- | --- |
| `format:check` | `prettier --check` über das gesamte Repo (`.prettierrc.json`: 80 Spalten, doppelte Quotes aus, Trailing Commas) |
| `typecheck` | `tsc --noEmit -p tsconfig.json` über `extensions/**/*.ts`, `npm/packages/**/*.ts`, `types/**/*.d.ts` |
| `deadcode` | `knip` (siehe `knip.json`) — unbenutzte Exporte/Dateien ausgehend von den 14 Extension-Entry-Points, den Test-Runnern und `scripts/*.mjs` |
| `test:coverage` | `tests/coverage.mjs` führt `tests/run-all.mjs` unter V8-Coverage-Instrumentierung aus und prüft jeden Extension-Entry-Point gegen eine committete Baseline (`tests/coverage-baseline.json`) |
| `test:patches` | `tests/runtime-patches.mjs` — prüft `scripts/apply-runtime-patches.mjs` gegen Fixtures, **ohne** eine echte Runtime anzufassen |
| `test:frontend-contracts` | baut `packages/frontend-protocol` und führt dessen Contract-Tests plus `frontend-server/test/*.test.mjs` aus |
| `test:gui` | `gui/test/format-check.mjs` + `npm --prefix gui test` (Unit/Contract/Security/Stability, kein echter Electron-Start) |
| `audit:check` | `scripts/check-npm-audit.mjs` — `npm audit` gegen eine explizite, im Skript dokumentierte Allowlist bereits bekannter, upstream-bedingter Advisories |

`tests/run-all.mjs` selbst führt die domänengefilterten Suiten
(`tests/run.mjs` je Domäne wie `runtime`, `ui`, `lsp`, `diff`, …,
`tests/workflow-mode.mjs`, einen Relative-Import-Check) in fester Reihenfolge
aus derselben Registry wie der Domänenfilter selbst. Einzelne Domänen lassen
sich isoliert ausführen: `PI_TEST_SUITE=<domäne> node tests/run.mjs`.

**Explizit nicht Teil von `verify`/CI:**

- `npm run test:runtime` (`tests/p1-runtime.mjs`) — eigenständiges
  Upgrade-Gate gegen die echte, installierte Runtime (Abschnitt 14).
- `node gui/test/e2e-rpc.mjs` — braucht echten Modellzugriff; laut
  `gui/README.md` trotzdem Pflicht vor jedem GUI-Release.

`npm run typecheck`, `npm run test`, `npm run verify`, `npm run install:user`
und `npm run patch:runtime` existieren auch am Repository-Root
(`package.json#scripts`) und delegieren 1:1 an die gleichnamigen
`npm/`-Skripte; `format`/`deadcode` gibt es nur unter `npm --prefix npm run
…`, nicht als Root-Script.

Nur ein `project_check`-Aufruf (bzw. innerhalb der Pi-Session das `verify`-Tool
für Ebene a) aktualisiert den sitzungsinternen Verifikations-Footer/-Ledger.
Ein direkter `bash`-Lauf derselben Befehle zählt lokal, verändert aber diesen
Status nicht.

## 14. Runtime-Patches

Die Pi-Runtime wird nicht aus `node_modules` erraten (Abschnitt 3). Patch und
Runtime-Test lösen identisch auf: `--runtime <pfad>` zuerst, dann
`PI_RUNTIME_ROOT`, dann das auf `PATH` gefundene `pi`.

```bash
node scripts/apply-runtime-patches.mjs --runtime /pfad/zur/runtime           # Dry-Run
node scripts/apply-runtime-patches.mjs --runtime /pfad/zur/runtime --apply   # Anwenden
node tests/p1-runtime.mjs --runtime /pfad/zur/runtime                        # Verifizieren
# äquivalent über npm:
npm --prefix npm run patch:runtime -- --apply
```

Eigenschaften: **idempotent** (bereits gepatchte Anker werden als `OK`
gemeldet), **laut statt findig** (fehlender oder mehrfacher Ankertreffer
bricht den gesamten Lauf ab, bevor geschrieben wird), **alles-oder-nichts**,
**reversibel** (Originale landen unter `backups/runtime-patches/<Zeitstempel>/`),
**versionsgebunden** (`EXPECTED_RUNTIME_VERSION = "0.84.3"`;
`--allow-version-drift` erzwingt einen Lauf gegen eine andere Version bewusst
und sichtbar).

Seit 2026-08-24 patcht derselbe Lauf **immer beides**: die unbebündelten
`dist/core/*`/`dist/modes/*`-Dateien (`PATCHES`) **und** den minifizierten
Bundle-Chunk unter `dist/bundle/chunks/*.js` (`BUNDLE_PATCHES`) — denn `pi`s
`bin`-Eintrag lädt nur diesen vorgebauten Chunk, nicht die unbebündelten
Dateien. Ein Lauf, der nur eine Seite anwendet, lässt den tatsächlich
laufenden `pi`-Prozess unverändert.

Aktueller Umfang (sechs aktive Patches, Stand `0.84.3`):

- `dist/core/agent-session.js`: `pi.getCommands()` liefert zusätzlich die 22
  eingebauten Built-in-Commands, Skill-Commands nur wenn in den Settings
  aktiviert.
- `dist/modes/interactive/interactive-mode.js`: `submitSlashCommand()` für
  Extension-UI; globale `onTerminalInput()`-Listener respektieren
  Editor-Fokus (Fleet-Dock-Fix).
- `dist/core/package-manager.js`: `applyConfiguredExtensionOrder()` sortiert
  Extensions innerhalb derselben Präzedenzstufe nach ihrer Position in
  `settings.json`.

Zwei frühere Patch-Gruppen sind **retired**, weil Upstream die gelösten
Probleme inzwischen nativ löst: die vier Reload-Dispose-Patches (ersetzt durch
`0.84.0`s `eventBusUnsubscribers`-Mechanismus) und die zwei
Compaction-Failure-Patches (ersetzt durch `0.84.3`s
`_emitSessionCompactFailed()`). `tests/p1-runtime.mjs` prüft seither direkt
den jeweils nativen Mechanismus statt der alten Marker — Details und
vollständige Historie in [`docs/RUNTIME_PATCHES.md`](docs/RUNTIME_PATCHES.md).

`node tests/p1-runtime.mjs --runtime <pfad>` prüft Version, alle erwarteten
Eingriffspunkte (unbebündelt **und** Bundle-Chunk) sowie zehn
aufeinanderfolgende Extension-Reloads ohne liegen gebliebene Event-Provider.

## 15. Lokale Daten und Secrets

Aus `.gitignore` und dem tatsächlichen Code, klar getrennt:

| Kategorie | Pfade | Hinweis |
| --- | --- | --- |
| Secrets | `auth.json` | nie versioniert; Runtime legt es lokal mit `0600` an |
| Session-/Plan-Daten | `sessions/`, `docs/archive/session-logs/`, `plans/` | `plans/` fällt im Dev-Checkout mit dem Repo-Root zusammen, ist aber Operator-Laufzeitzustand, nie Repo-Inhalt |
| Backups | `backups/`, `*.bak-*`, `*.backup.*` | u. a. `backups/runtime-patches/<Zeitstempel>/` (Abschnitt 14) |
| Laufzeit-/Diagnosedateien | `run-history.jsonl`, `pi-crash.log`, `pi-debug.log`, `models-store.json` | von der Runtime selbst geschrieben, `0600`; siehe Hinweis unten |
| Subagent-Laufzeitkopien | `.pi-subagents/`, `pi-subagents/` | `pi-subagents/` = npm-Paket-Arbeitskopie (Laufzeitabhängigkeit), `/git/github.com/daydaylx/pi-subagents/` = optionaler Upstream-Clone für Entwicklung |
| Lokale Git-Checkouts | `/git/` | Arbeitsbereich für lokale Klone von Upstream-Paketen, kein Repo-Inhalt |
| OpenRouter-Cache | `openrouter-free-models.json` | regeneriert über `/or-free-refresh` |
| GUI-Build-Artefakte | `gui/node_modules/`, `gui/.npm-cache/`, `gui/.cache/`, `dist/` | `dist/` ist Ziel von `scripts/package-gui.mjs` |
| Agent-Scratch | `.agent/` | Sitzungs-Scratch (Pläne, Debug-Skripte), nie Repo-Inhalt |
| Externe Integrationen | `extensions/tty7/` | maschinenlokale Drittanbieter-Integration, nie Repo-Inhalt |

`auth.json`, `run-history.jsonl`, `pi-crash.log` und `pi-debug.log` tragen
`0600`. Die Runtime schreibt die letzten drei selbst; legt sie eine davon neu
an, muss der Modus erneut gesetzt werden:

```bash
chmod 600 run-history.jsonl pi-crash.log pi-debug.log
```

Reproduzierbarer Repository-Zustand ist alles, was `git ls-files` zeigt und
nicht in obiger Tabelle steht; maschinenlokale Konfiguration und
Laufzeitdaten sind es nicht, auch wenn sie im selben Checkout-Verzeichnis
liegen (z. B. `plans/`).

## 16. Troubleshooting

| Symptom | Ursache | Behebung |
| --- | --- | --- |
| `bin/pi-frontend`: „protocol build missing" (Exit 78) | `npm/packages/frontend-protocol/dist/index.js` fehlt | `npm run build` im jeweiligen Repo/Installationsverzeichnis ausführen |
| `bin/pi`: „echtes pi-Binary nicht gefunden" | kein zweites `pi` auf `PATH`, oder `PI_GUI_REAL_PI` nicht gesetzt | eigenständige Pi-Runtime installieren (Abschnitt 3) bzw. `PI_GUI_REAL_PI` setzen |
| `apply-runtime-patches.mjs` bricht mit Versionsfehler ab | installierte Runtime weicht von `EXPECTED_RUNTIME_VERSION` (`0.84.3`) ab | Patches gegen die neue Version prüfen/portieren, oder bewusst `--allow-version-drift` |
| `apply-runtime-patches.mjs` bricht mit „Ankertext nicht gefunden/mehrfach" ab | Runtime-Interna haben sich strukturell geändert | Patch-Quelle in `scripts/apply-runtime-patches.mjs` gegen die neue Runtime-Version neu abgleichen, nicht blind erzwingen |
| `install-user.mjs`: „Symlink im Deployment-Manifest/Zielpfad nicht erlaubt" | Quelle oder Ziel enthält einen Symlink | Symlink auflösen/entfernen; die Installation folgt bewusst keinen Symlinks |
| `verify` bleibt bei `changed_unverified`, obwohl lokal alles grün lief | Prüfung lief direkt über `bash` oder in einem Subagenten statt über `project_check`/das `verify`-Tool | den kanonischen `project_check({ profile: "verify" })`-Aufruf ausführen |
| `pi-gui`/`smoke` scheitert mit fehlendem Electron-Modul | `npm ci --prefix gui` wurde nicht ausgeführt | `npm ci --prefix gui` im Dev-Checkout nachholen (Abschnitt 12) |
| Verifier-Delegation wird vor dem Start geblockt | Pflichtabschnitte (Diff, Baseline, Fingerprints, Akzeptanzkriterien) fehlen, oder `turnBudget` wurde gesetzt | Delegationsvorlage aus [`docs/subagents.md`](docs/subagents.md) vollständig übernehmen, kein `turnBudget` setzen |

## 17. Entwicklungsbefehle

```bash
# Aus dem Repo-Root:
npm run build           # baut nur packages/frontend-protocol
npm run typecheck       # tsc --noEmit
npm run test            # frontend-contracts + volle Regressionssuite
npm run verify          # voller Release-Gate (Abschnitt 13)
npm run install:user    # Dry-Run der ~/.pi/agent-Synchronisation
npm run patch:runtime   # Runtime-Patches anwenden (--runtime/--apply nötig)

# Feingranular, aus npm/:
npm --prefix npm run format          # prettier --write .. (ganzes Repo)
npm --prefix npm run format:check
npm --prefix npm run deadcode        # knip
npm --prefix npm run test:coverage
npm --prefix npm run test:patches
npm --prefix npm run test:frontend-contracts
npm --prefix npm run test:gui
npm --prefix npm run audit:check
npm run test:runtime   # NICHT Teil von verify; braucht --runtime/PI_RUNTIME_ROOT

# GUI, aus dem Dev-Checkout:
npm ci --prefix gui
npm --prefix gui test
node gui/test/e2e-rpc.mjs   # braucht echten Modellzugriff
node scripts/package-gui.mjs
```
