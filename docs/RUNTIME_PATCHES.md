# Lokale Pi-Runtime-Patches

Die tatsächlich gestartete Pi-Runtime liegt unter
`/home/d/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent` und hat
Version `0.83.0`. Sie enthält bewusst lokale P1-Patches, die nicht Teil dieses
Git-Arbeitsbaums sind.

> **Historie:** Das Upgrade von `0.82.0` auf `0.82.1` hat die gepatchten Dateien
> überschrieben; die Patches waren zwischenzeitlich unbemerkt verloren. Am
> 2026-07-28 wurden sie gegen `0.82.1` neu portiert und in
> `scripts/apply-runtime-patches.mjs` versioniert, damit sich das Nachschreiben
> von Hand nicht wiederholt.

Am 2026-08-02 wurde der Patch gegen Pi `0.83.0` geprüft und neu gebunden. Alle
neun Anker waren unverändert; der Patch-Umfang selbst blieb gleich.

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
`tests/runtime-patches.mjs` prüft das Skript selbst und läuft in
`npm run verify` mit.

## Umfang

- `dist/core/extensions/loader.js`: `createExtension()` führt eine Liste
  `eventUnsubscribers`; `createExtensionAPI()` reicht statt des rohen Event-Bus
  einen Wrapper durch, dessen `on()` den Unsubscriber dort ablegt. `emit` und
  `clear` bleiben unverändert durchgereicht.
- `dist/core/extensions/runner.js`: neue Methode `ExtensionRunner.dispose()`.
  Sie ruft `invalidate()` und ruft anschließend alle `eventUnsubscribers` jeder
  Extension auf. Ein scheiternder Unsubscriber blockiert die übrigen nicht.
- `dist/core/agent-session.js`: `reload()` ruft `dispose()` direkt nach
  `emitSessionShutdownEvent` — bevor die neue Generation ihre Listener
  registriert. `pi.getCommands()` liefert zusätzlich die 22 Built-ins und nur
  dann Skill-Commands, wenn Skill-Commands in den Settings aktiviert sind.
- `dist/modes/interactive/interactive-mode.js`: Die Extension-UI erhält
  `submitSlashCommand()`. Es akzeptiert genau eine Slash-Zeile und reicht sie
  an denselben Dispatcher wie eine manuelle Eingabe weiter.
- `dist/core/package-manager.js`: neue Funktion
  `applyConfiguredExtensionOrder()`. `toResolvedPaths()` sortiert Extensions
  innerhalb derselben Präzedenz nach der Position ihres `+path`-Eintrags in
  `settings.json`; ohne solche Einträge bleibt die bisherige Sortierung.

## Warum diese Patches

Ohne den Listener-Patch beantworten nach einem Reload sowohl die alte als auch
die neue Extension-Generation denselben Kanal: `pi.events.on()` registriert auf
einem geteilten Bus, der beim Generationswechsel nicht geleert wurde. Das
betrifft insbesondere die Capability-Bridges zwischen Workflow, Permissions und
Thinking, die über `respond()`-Callbacks arbeiten.

Ohne den Reihenfolge-Patch ist die Sortierung innerhalb einer Präzedenzstufe die
Verzeichnis-Scan-Reihenfolge, nicht die in `settings.json` deklarierte.

Ohne Inventar- und Dispatcher-Patch könnte `/commands` weder Pi-Built-ins
vollständig anzeigen noch einen gewählten Eintrag direkt ausführen. Shortcuts,
Menü und manuelle Slash-Eingabe würden dann unterschiedliche Ausführungswege
verwenden.

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
