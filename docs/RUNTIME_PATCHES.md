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

`BUNDLE_PATCHES` in `scripts/apply-runtime-patches.mjs` trägt dieselben sechs
Eingriffe wie `PATCHES`, von Hand an die minifizierte Form angepasst:

- Keine Zeilenumbrüche/Leerzeichen zwischen Tokens — die Anker sind daher
  Ein-Zeiler statt des mehrzeiligen `PATCHES`-Texts.
- `this.*`-Property-Zugriffe und Top-Level-Funktionsnamen (`resourcePrecedenceRank`,
  `matchesAnyExactPattern`, `getOverridePatterns`, `BUILTIN_SLASH_COMMANDS`,
  `createSyntheticSourceInfo`, …) überleben esbuilds Standard-Minifizierung
  unverändert; nur lokale `let`/`const`-Bezeichner und Funktionsparameter
  können umbenannt sein (z. B. `path` → `path14` bei einer Namenskollision).
- "agent-session-builtin-command-import" und "agent-session-complete-command-inventory"
  sind zu einem Eintrag (`bundle-agent-session-command-inventory`)
  zusammengelegt, weil beide denselben `getCommands`-Closure-Body treffen und
  im minifizierten Ein-Zeiler nicht unabhängig voneinander anwendbar sind.

Jeder `BUNDLE_PATCHES`-Eintrag trägt bewusst **kein** `file`-Feld: Der
Chunk-Dateiname (`chunk-E5KXRMZK.js` zum Zeitpunkt dieser Entdeckung) ist ein
Content-Hash, den ein Rebuild ändern kann. `findBundleChunkFile()` durchsucht
stattdessen alle `.js`-Dateien unter `dist/bundle/chunks/` zur Laufzeit und
patcht die eine Datei, die den Anker tatsächlich enthält — nach derselben
"laut statt findig"-Regel: null oder mehr als ein Treffer brechen den Lauf ab.

## Umfang

- `dist/core/agent-session.js`: `pi.getCommands()` liefert zusätzlich die 22
  Built-ins und nur dann Skill-Commands, wenn Skill-Commands in den Settings
  aktiviert sind.
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

## Warum die verbliebenen Patches

Ohne den Reihenfolge-Patch ist die Sortierung innerhalb einer Präzedenzstufe die
Verzeichnis-Scan-Reihenfolge, nicht die in `settings.json` deklarierte.

Ohne Inventar- und Dispatcher-Patch könnte `/commands` weder Pi-Built-ins
vollständig anzeigen noch einen gewählten Eintrag direkt ausführen. Shortcuts,
Menü und manuelle Slash-Eingabe würden dann unterschiedliche Ausführungswege
verwenden.

Ohne die Fokusgrenze laufen globale Extension-Terminal-Listener vor der
fokussierten Komponente. Ein Fleet-Dock, das bei leerem Editor Pfeil runter zur
Aktivierung verwendet, kann dadurch dieselbe Taste in einem sichtbaren Selector
verschlucken und anschließend auch Escape konsumieren.

## Upgrade-Gate

Vor und nach jedem Pi-Update ausführen:

```sh
node tests/p1-runtime.mjs --runtime /pfad/zur/runtime
```

Der Test prüft die Version, die erwarteten Runtime-Eingriffspunkte und zehn
aufeinanderfolgende Reloads ohne liegen gebliebene Event-Provider. Ein
Versionsfehler bedeutet: Patch gegen die neue Runtime prüfen und portieren,
nicht den Test abschwächen.
