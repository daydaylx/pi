# Lokale Pi-Runtime-Patches

Die tatsächlich gestartete Pi-Runtime liegt unter
`/home/d/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent` und hat
Version `0.82.1`. Sie enthält bewusst lokale P1-Patches, die nicht Teil dieses
Git-Arbeitsbaums sind.

> **Historie:** Das Upgrade von `0.82.0` auf `0.82.1` hat die gepatchten Dateien
> überschrieben; die Patches waren zwischenzeitlich verloren. Am 2026-07-28
> wurden sie gegen `0.82.1` neu portiert und über `tests/p1-runtime.mjs`
> verifiziert. Ein npm-Update der Runtime entfernt sie erneut — der Test ist die
> einzige Absicherung dagegen.

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
  registriert.
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
