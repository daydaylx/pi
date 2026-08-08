# Lokale Pi-Runtime-Patches

Die tatsächlich gestartete Pi-Runtime liegt unter
`/home/d/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent` und hat
Version `0.84.1`. Sie enthält bewusst lokale P1-Patches, die nicht Teil dieses
Git-Arbeitsbaums sind.

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

## Wiederherstellen

Die Patches liegen in `node_modules` und überleben kein `npm update` der
Runtime. Der Quelltext der Eingriffe steht deshalb versioniert im Repository:

```sh
node scripts/apply-runtime-patches.mjs            # Vorschau, schreibt nichts
node scripts/apply-runtime-patches.mjs --apply    # anwenden
node tests/p1-runtime.mjs                         # verifizieren
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

Mit `--runtime <pfad>` lässt sich eine andere Installation ansprechen.
`tests/runtime-patches.mjs` prüft das Skript selbst (gegen eine Fixture, ohne
eine echte Runtime-Installation) und läuft in `npm run verify` mit.

`npm run test:runtime` (`tests/p1-runtime.mjs`) ist bewusst **kein** Teil von
`npm run verify`/CI: es prüft die tatsächlich gestartete, lokal gepatchte
Runtime unter `PI_RUNTIME_ROOT` — ein Pfad, den kein CI-Runner besitzt. Es
bleibt ein eigenständiges, manuell auszuführendes Skript für das
Upgrade-Gate unten.

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
node /home/d/.pi/agent/tests/p1-runtime.mjs
```

Der Test prüft die Version, die erwarteten Runtime-Eingriffspunkte und zehn
aufeinanderfolgende Reloads ohne liegen gebliebene Event-Provider. Bei einer
anderen Runtime-Installation kann `PI_RUNTIME_ROOT` auf ihr
`@earendil-works/pi-coding-agent`-Verzeichnis gesetzt werden. Ein
Versionsfehler bedeutet: Patch gegen die neue Runtime prüfen und portieren,
nicht den Test abschwächen.
