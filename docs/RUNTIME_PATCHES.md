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
- `dist/core/agent-session.js`: `compact()` und `_runAutoCompaction()` melden
  eine gescheiterte manuelle oder automatische Kompaktierung zusätzlich zum
  bestehenden `compaction_end`-Event (das nur die Mode-Schicht sieht) über
  `session_compact_failed` an den `ExtensionRunner`. Ohne diesen Patch sah die
  `resilience`-Extension einen fehlgeschlagenen Kompaktierungsversuch nicht:
  im Session-JSONL blieb nur ein `resilience.compaction-boundary`-Eintrag mit
  `boundary: "started"` ohne passendes `"completed"`, ohne Fehlermeldung.

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
