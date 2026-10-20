# Lokale Pi-Runtime-Patches

Die Pi-Runtime wird nicht aus dem Entwicklungs-`node_modules` erraten. Patch
und Runtime-Test verwenden dieselbe Auflösung: `--runtime <pfad>` hat Vorrang,
dann `PI_RUNTIME_ROOT`, anschließend das auf `PATH` gefundene `pi`.
Ist kein eindeutiges Paket `@earendil-works/pi-coding-agent` auffindbar,
brechen beide mit einer Anleitung zu `--runtime` oder `PI_RUNTIME_ROOT` ab.

> **Historie:** Das Upgrade von `0.82.0` auf `0.82.1` hat die gepatchten Dateien
> überschrieben; die Patches waren zwischenzeitlich unbemerkt verloren. Am
> 2026-07-28 wurden sie gegen `0.82.1` neu portiert und in
> `scripts/apply-runtime-patches.mjs` versioniert, damit sich das Nachschreiben
> von Hand nicht wiederholt.

Am 2026-08-02 wurde der Patch gegen Pi `0.83.0` geprüft und neu gebunden. Am
2026-08-05 kam die Fokusgrenze für globale Extension-Eingaben hinzu, nachdem
ein Fleet-Dock-Listener Pfeiltasten und Escape vor modalen Selectoren konsumiert
hatte.

Am 2026-08-06 wurde der Patch gegen Pi `0.84.0` geprüft und neu gebunden. Dabei
stellte sich heraus, dass Upstream das Problem hinter vier der bisherigen
Eingriffe (`loader-scoped-events`, `loader-unsubscriber-list`, `runner-dispose`,
`session-reload-dispose`) inzwischen selbst löst — siehe **Retirement** unten.
Die verbliebenen sechs Patches griffen unverändert.

Am 2026-08-08 wurde die Runtime auf `0.84.1` aktualisiert, wodurch die Patches
(wie in der Vergangenheit) aus `node_modules` verschwanden. Alle sechs Anker
trafen unverändert; die Patches wurden erneut angewendet, `EXPECTED_RUNTIME_VERSION`
und der Versionspin in `tests/p1-runtime.mjs` wurden auf `0.84.1` nachgezogen.
Zusätzlich wurde die bis dahin bestehende Drift zur gepinnten Pi-Dev-Abhängigkeit
in `npm/package.json` behoben (ebenfalls `0.84.0` → `0.84.1`, inklusive
`npm install` für das Lockfile), siehe `docs/runtime-matrix.md`.

Am 2026-08-11 kamen zwei Patches gegen `dist/core/agent-session.js` hinzu,
nachdem eine Sitzungsanalyse zeigte, dass eine gescheiterte Kompaktierung
spurlos blieb: `compact()` und `_runAutoCompaction()` melden eine
fehlgeschlagene Kompaktierung jetzt zusätzlich über ein neues
`session_compact_failed`-Event an den `ExtensionRunner`, das die
`resilience`-Extension in einen `resilience.compaction-boundary`-Eintrag mit
`boundary: "failed"` und der originalen Fehlermeldung übersetzt.

Am 2026-08-15 wurde Pi auf `0.84.2` aktualisiert. Alle acht aktiven
Patch-Anker trafen unverändert; die Patches wurden erneut angewendet und der
Versionspin auf `0.84.2` nachgezogen.

Am 2026-08-24 wurde Pi auf `0.84.3` aktualisiert. Sechs der acht Anker trafen
unverändert. Die beiden übrigen (`agent-session-compaction-failure-manual`
und `agent-session-compaction-failure-auto`) griffen nicht mehr: Upstream hat
das Problem, das sie lösten, inzwischen selbst mit einer generischen
`_emitSessionCompactFailed()`-Methode auf `AgentSession` gelöst, aufgerufen
sowohl aus `compact()`s catch-Block als auch aus `_runAutoCompaction()` — siehe
**Retirement (0.84.3)** unten. Die verbliebenen sechs Patches wurden erneut
angewendet und `EXPECTED_RUNTIME_VERSION` auf `0.84.3` nachgezogen.

Trotz erneutem Anwenden und grünem `p1-runtime.mjs` blieb `Super+S` (und jeder
andere Shortcut) mit "Die direkte Command-Ausführung fehlt in der
Pi-Runtime" fehlgeschlagen — auch nach vollständigem Neustart des Terminals.
Ursache: `pi`s `bin`-Eintrag (`dist/bundle/cli.js`) lädt gar nicht die oben
gepatchten `dist/core/*`/`dist/modes/*`-Dateien, sondern einen separat
vorgebauten, minifizierten Bundle-Chunk unter `dist/bundle/chunks/*.js`, der
als statisches Build-Artefakt im npm-Tarball mitkommt — kein Rebuild-Schritt
bei der Installation übernimmt Änderungen an den unbebündelten Dateien dort
hinein. Alle sechs Patches (fünf nach Zusammenlegung zweier ineinandergreifender
Edits) wurden zusätzlich in der minifizierten Form auf den Bundle-Chunk
angewendet — siehe **Bundle-Patches** unten. `tests/p1-runtime.mjs` prüfte bis
dahin ausschließlich die unbebündelten Dateien und wäre diese Lücke nie
aufgefallen; es prüft jetzt zusätzlich den Bundle-Chunk.

Beim damaligen Upgrade der aktiven Runtime auf Pi `0.87.1` trafen alle elf
versionierten Patch-Anker weiterhin eindeutig. Runtime- und Bundle-Änderungen
werden gemeinsam geprüft.

Am 2026-10-07 wurden Runtime und Dev-Abhängigkeit auf `1.0.4` angeglichen. Alle
elf Patch-Anker wurden auf die neue Runtime portiert und `tests/p1-runtime.mjs`
bestand. Der Paketmanager-Chunk änderte dabei nur minifizierte lokale Namen;
der Patch bleibt an den vollständigen Methodenkörper gebunden. Pi `1.0.4`
entfernt das interne `npm-shrinkwrap` und pinnt `brace-expansion@5.0.12`
direkt. Der Root-Override ist ebenfalls auf `5.0.12` gesetzt, damit der
Audit-Fix nach einer sauberen `npm ci`-Installation greift.

Am 2026-10-15 wurden Runtime und Dev-Abhängigkeit auf `1.2.0` angehoben. Der
Weg führt über den Pin in `npm/package.json` und `npm install --ignore-scripts`
in `~/.pi/agent/npm`: `pi update` verweigert den Self-Update, weil die
Installation nicht als globales npm-Paket verwaltet wird. Alle elf Patch-Anker
trafen unverändert. Außerhalb der Patches waren zwei Anpassungen nötig:

- **`before_agent_start` feuert jetzt auch für Läufe aus
  `pi.sendMessage(..., { triggerTurn: true })`** (seit `1.1.0`; real genutzt von
  `pi-subagents`-Hintergrundmeldungen und `pi-web-access`).
  `BeforeAgentStartEvent` ist eine Union auf `messageType`; `custom`-Events
  tragen kein `prompt`. Ein `systemPrompt`-Rückgabewert gilt nur für den
  jeweiligen Lauf; ohne Beitrag läuft ein solcher Lauf mit dem nackten
  Basis-Prompt.
  - `aurora-ui` und `context-capsule` überspringen diese Läufe
    (Titel und Zielbeschreibung hängen am Nutzer-Prompt; das
    Event kam für sie vorher gar nicht an).
  - `system-context` liefert für sie den Basiskontext ohne Zusatzkategorien.
  - `resilience` ist prompt-unabhängig und legt für solche Läufe ebenfalls einen
    Turn-Marker an; eine ausstehende Recovery-Anweisung wird ihnen zugestellt.
- **Theme-Schema** liegt jetzt unter `schemas/theme.schema.json` im Paket
  (`tests/suites/runtime/target-config.mjs` liest es von dort). Themes werden
  beim Start nun ebenfalls validiert; alle vier Aurora-Themes bestehen den
  Validator der Runtime.

In `tests/p1-runtime.mjs` wurde das Regex-Fenster für `hideExtensionSelector()`
von 260 auf 400 Zeichen erweitert, weil Upstream dort eine Zeile
(`programStatus.setBlocked`) eingefügt hat; das Verhalten (Fokus zurück auf den
Editor) ist unverändert.

Am 2026-10-17 wurden Runtime und Dev-Abhängigkeit auf `1.3.0` angehoben. Alle
zehn aktiven Patch-Anker trafen unverändert; die Patches wurden auf der
Entwicklungs- und aktiven Runtime angewendet. `tests/p1-runtime.mjs` bestand für
beide Installationen.

## Wiederherstellen

Die Patches liegen in `node_modules` und überleben kein `npm update` der
Runtime. Der Quelltext der Eingriffe steht deshalb versioniert im Repository:

```sh
node scripts/apply-runtime-patches.mjs --runtime /pfad/zur/runtime
node scripts/apply-runtime-patches.mjs --runtime /pfad/zur/runtime --apply
node tests/p1-runtime.mjs --runtime /pfad/zur/runtime
```

Gleichwertig über npm: `npm --prefix npm run patch:runtime -- --apply`.

Eigenschaften des Skripts:

- **Idempotent.** Ein bereits gepatchter Eingriffspunkt wird als `OK` gemeldet
  und nicht angefasst; wiederholte Läufe ändern nichts.
- **Laut statt findig.** Findet es einen Ankertext nicht mehr oder mehrfach,
  bricht der gesamte Lauf ab, bevor irgendetwas geschrieben wurde. Eine
  geänderte Runtime verlangt eine Prüfung, keine Näherung.
- **Alles-oder-nichts.** Alle Eingriffe werden erst geplant, dann geschrieben —
  eine halb gepatchte Runtime kann nicht entstehen.
- **Reversibel.** Vor dem ersten Schreibvorgang landen die Originale unter
  `backups/runtime-patches/<Zeitstempel>/`.
- **Versionsgebunden.** Weicht die installierte Version von
  `EXPECTED_RUNTIME_VERSION` ab, bricht das Skript ab. `--allow-version-drift`
  erzwingt den Lauf ausdrücklich und sichtbar.

Mit `--runtime <pfad>` lässt sich eine Runtime eindeutig wählen;
`PI_RUNTIME_ROOT` ist die portable Alternative für wiederholte lokale Läufe.
`tests/runtime-patches.mjs` prüft das Skript selbst (gegen eine Fixture, ohne
eine echte Runtime-Installation) und läuft in `npm run verify` mit.

`npm run test:runtime` (`tests/p1-runtime.mjs`) ist bewusst **kein** Teil von
`npm run verify`/CI. Es bleibt ein eigenständiges Upgrade-Gate gegen die
explizit gewählte oder lokal erkannte Runtime.

Derselbe Lauf patcht seit 2026-08-24 immer beides: die unbebündelten Dateien
(`PATCHES`) und den Bundle-Chunk (`BUNDLE_PATCHES`) — siehe **Bundle-Patches**
unten. Ein Lauf, der nur eine der beiden Seiten anwendet, lässt den
tatsächlich ausgeführten `pi`-Prozess unverändert.

## Bundle-Patches

`pi`s `package.json` deklariert `"bin": {"pi": "dist/bundle/cli.js"}`. Diese
Datei ist nur ein winziger Loader (`import ... from "./chunks/chunk-XXXX.js"`);
der eigentliche interaktive Code liegt in einem oder mehreren vorgebauten,
minifizierten Chunks unter `dist/bundle/chunks/`. Diese Chunks sind ein
statisches Build-Artefakt des `pi-coding-agent`-Pakets selbst
(`npm run build` dort führt zuerst `tsgo` für die unbebündelten `dist/core/*`-
und `dist/modes/*`-Dateien aus und **danach** einen separaten esbuild-Lauf für
den Bundle) — sie kommen fertig aus dem npm-Tarball, ohne dass `npm install`
im Wurzel-Repo sie neu erzeugt. Patches an den unbebündelten Dateien haben
deshalb keinerlei Wirkung auf den tatsächlich laufenden `pi`-Prozess.

`BUNDLE_PATCHES` in `scripts/apply-runtime-patches.mjs` trägt dieselben
Eingriffe wie `PATCHES`, von Hand an die minifizierte Form angepasst:

- Keine Zeilenumbrüche/Leerzeichen zwischen Tokens — die Anker sind daher
  Ein-Zeiler statt des mehrzeiligen `PATCHES`-Texts.
- `this.*`-Property-Zugriffe und Top-Level-Funktionsnamen (`resourcePrecedenceRank`,
  `matchesAnyExactPattern`, `getOverridePatterns`, `BUILTIN_SLASH_COMMANDS`,
  `createSyntheticSourceInfo`, …) überleben esbuilds Standard-Minifizierung
  unverändert; nur lokale `let`/`const`-Bezeichner und Funktionsparameter
  können umbenannt sein (z. B. `path` → `path14` bei einer Namenskollision).
- Das Command-Inventar (`bundle-agent-session-command-inventory`) wurde am
  2026-10-16 ausgemustert, siehe **Retirement (2026-10-16)**.

Jeder `BUNDLE_PATCHES`-Eintrag trägt bewusst **kein** `file`-Feld: Der
Chunk-Dateiname (`chunk-E5KXRMZK.js` zum Zeitpunkt dieser Entdeckung) ist ein
Content-Hash, den ein Rebuild ändern kann. `findBundleChunkFile()` durchsucht
stattdessen alle `.js`-Dateien unter `dist/bundle/chunks/` zur Laufzeit und
patcht die eine Datei, die den Anker tatsächlich enthält — nach derselben
"laut statt findig"-Regel: null oder mehr als ein Treffer brechen den Lauf ab.

## Umfang

- `dist/modes/interactive/interactive-mode.js`: Die Extension-UI erhält
  `submitSlashCommand()`. Es akzeptiert genau eine Slash-Zeile und reicht sie
  an denselben Dispatcher wie eine manuelle Eingabe weiter. Außerdem werden
  über `onTerminalInput()` registrierte globale Extension-Listener nur bei
  Editorfokus aufgerufen; fokussierte Selector und Overlays erhalten ihre
  Navigation direkt.
- `dist/core/package-manager.js`: neue Funktion
  `applyConfiguredExtensionOrder()`. `toResolvedPaths()` sortiert Extensions
  innerhalb derselben Präzedenz nach der Position ihres `+path`-Eintrags in
  `settings.json`; ohne solche Einträge bleibt die bisherige Sortierung.

## Retirement (0.84.0)

Die Patches `loader-scoped-events`, `loader-unsubscriber-list`,
`runner-dispose` und `session-reload-dispose` bildeten zusammen einen
Mechanismus: Extension-Listener auf `pi.events.on()` an die Lebensdauer ihrer
Extension binden, damit nach einem Reload nicht sowohl die alte als auch die
neue Generation denselben Kanal beantworten.

Pi `0.84.0` löst genau dieses Problem jetzt nativ, mit einem anderen Aufbau:
`createExtensionRuntime()` in `loader.js` führt ein generationsweites
`eventBusUnsubscribers`-Set; `trackEventBusSubscription()` legt dort jeden
`pi.events.on()`-Unsubscriber ab; `runtime.invalidate()` leert das Set.
`ExtensionRunner.invalidate()` ruft `this.runtime.invalidate(message)` auf,
und `agent-session.js` ruft in `reload()` bereits `oldRunner.invalidate()`
direkt nach `emitSessionShutdownEvent` auf — der frühere Anknüpfungspunkt
`this._extensionRunner.dispose()` existiert nicht mehr.

Ein erneutes Aufsetzen dieser vier Patches würde entweder gar nicht mehr
greifen (zwei der vier Anker fehlen inzwischen) oder totes Gewebe erzeugen
(die anderen beiden Anker matchen zufällig noch, aber nichts liest das
Ergebnis mehr). `tests/p1-runtime.mjs` prüft seit diesem Retirement direkt
den nativen Mechanismus statt der alten Patch-Marker.

## Retirement (0.84.3)

Die Patches `agent-session-compaction-failure-manual` und
`agent-session-compaction-failure-auto` fügten `compact()`s catch-Block und
`_runAutoCompaction()` jeweils von Hand einen `session_compact_failed`-Emit
hinzu, weil ohne ihn nur die Mode-Schicht (`compaction_end`) eine fehlgeschlagene
Kompaktierung sah — die `resilience`-Extension blieb blind dafür.

Pi `0.84.3` löst dasselbe Problem jetzt mit einer generischen
`_emitSessionCompactFailed(event)`-Methode auf `AgentSession`, die aus
`compact()`s catch-Block (mit `reason: "manual"`) und aus
`_runAutoCompaction()` (mit `reason: "overflow"`/`"threshold"`) aufgerufen
wird. Ein Wiederaufsetzen der beiden alten Patches würde entweder scheitern
(der `-manual`-Anker existiert nicht mehr in dieser Form) oder totes Gewebe
erzeugen (der `-auto`-Anker matcht nur noch zufällig auf die neue generische
Methode, nicht auf den ursprünglich gemeinten Ort). `tests/p1-runtime.mjs`
prüft seit diesem Retirement direkt den nativen `_emitSessionCompactFailed()`-
Mechanismus statt der alten Patch-Marker.

## Retirement (2026-10-16)

Die Patches `agent-session-builtin-command-import`,
`agent-session-complete-command-inventory` (und im Bundle
`bundle-agent-session-command-inventory`) ergänzten `pi.getCommands()` um Pi-Built-ins
und koppelten Skill-Commands an `enableSkillCommands`. Geprüft gegen den Code:

- Der einzige Verbraucher ist das Command-Center (`extensions/shared/command-center.ts`).
  Es zeigt Built-ins aus dem eigenen Katalog (`command-catalog.ts`); der Abgleich
  mit `BUILTIN_SLASH_COMMANDS` der Runtime 1.2.0 ergibt als einzige Differenz
  `/bug` (Fehlerbericht an die Pi-Entwickler). Mit dem Patch erschien `/bug` als
  Eintrag mit dem falschen Abzeichen „ERWEITERUNG"; ohne ihn fehlt er, was
  gewollt ist.
- `enableSkillCommands` steht auf dem Standardwert `true`; die Kopplung hatte
  keine Wirkung.

Der Patch war damit ohne nachweisbaren Nutzen. Ein frischer `1.2.0`-Bundle mit den
verbliebenen acht Einträgen besteht `tests/p1-runtime.mjs`. Die bereits
installierte Runtime trägt die alten Änderungen weiter, bis sie neu installiert
wird; nichts hängt daran.

## Trust-Gate für Pi-Setup-Dateien (2026-10-16)

Ein echter Agentenlauf (`pi -p`) in einem Projekt mit nur `.pi/verify.json`
führte `project_check` ohne Vertrauensabfrage aus: Upstream fragt nur, wenn
`hasTrustRequiringProjectResources()` (`dist/core/trust-manager.js`) eine der
eigenen Ressourcen (`settings.json`, `mcp.json`, `extensions`, `skills`,
`prompts`, `themes`, `SYSTEM.md`, `APPEND_SYSTEM.md`) findet, und meldet sonst
`trusted = true`, ohne das `project_trust`-Extension-Event auszulösen. Ein
Extension-Hook kann die Lücke deshalb nicht schließen.

Der Patch `trust-manager-setup-resources` (und im Bundle
`bundle-trust-manager-setup-resources`) ergänzt die Liste um `verify.json`,
`setup.json` und `lsp.json`. Damit greifen Abfrage, Trust-Store,
`--approve`/`--no-approve` und `defaultProjectTrust` für diese Dateien wie für
Upstream-Ressourcen; ohne UI gilt das Projekt als nicht vertraut. Ein
Wurzel-`setup.json` (ohne `.pi/`) bleibt davon unberührt; die Projektschicht
darf Berechtigungen nicht lockern und keine Kommandos setzen
(`applyTrustedProjectLayer`). Sollte Upstream die Liste erweitern oder ein
Hook für nicht erkannte Ressourcen anbieten, entfällt der Patch.

## Warum die verbliebenen Patches

| Patch (Quelle + Bundle)                   | Wirkung                                                                                                                  | Native Alternative                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `interactive-submit-slash-command`        | Shortcuts und Menü führen Built-ins (`/model`, `/thinking`, `/login` …) wie eine getippte Zeile aus.                     | Nur für Extension-Commands: `pi.sendUserMessage("/x", { expandPromptTemplates: true })`. Built-ins kennt allein `InteractiveMode.onSubmit`; es gibt keine API.                                                           |
| `interactive-focus-scoped-terminal-input` | Globale Eingabe-Listener (Escape-Abbruch eines Slash-Subagent-Laufs) greifen nicht vor fokussierten Selectoren.          | Keine; der Fleet-Dock, der es ursprünglich auslöste, ist abgeschaltet (`ui.fleetView: false`). Der Patch ist ein Schutz für den Slash-Lauf und entfällt, sobald der Fork den Listener selbst begrenzt.                   |
| `package-manager-order-helper/-use`       | `+extensions/…`-Einträge laden in der deklarierten Reihenfolge (Tool-Call-Handler: `setup-core` vor `mode-permissions`). | Keine; Upstream sortiert innerhalb einer Rangstufe nach Verzeichnisscan. Ein einzelner Sammel-Einstiegspunkt würde die Reihenfolge in Code legen, nähme aber das Ein-/Ausschalten je Extension über `settings.json` weg. |

Für alle drei gilt: ein Upstream-Vorschlag wäre der saubere Weg (API für
Built-in-Dispatch aus Extensions, deklarierte Ladereihenfolge). Er wird hier nicht
eingereicht, weil das eine Veröffentlichung in einem fremden Repository wäre.

## Upgrade-Gate

Vor und nach jedem Pi-Update ausführen:

```sh
node tests/p1-runtime.mjs --runtime /pfad/zur/runtime
```

Der Test prüft die Version, die erwarteten Runtime-Eingriffspunkte und zehn
aufeinanderfolgende Reloads ohne liegen gebliebene Event-Provider. Ein
Versionsfehler bedeutet: Patch gegen die neue Runtime prüfen und portieren,
nicht den Test abschwächen.
