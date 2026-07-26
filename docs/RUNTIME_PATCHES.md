# Lokale Pi-Runtime-Patches

Die tatsächlich gestartete Pi-Runtime liegt derzeit unter
`/home/d/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent` und
hat Version `0.82.0`. Sie enthält bewusst lokale P1-Patches, die nicht Teil
dieses Git-Arbeitsbaums sind.

## Umfang

- `dist/core/extensions/loader.js`: Jeder Extension-Listener auf `pi.events`
  wird dem Extension-Lebenszyklus zugeordnet.
- `dist/core/extensions/runner.js` und `dist/core/agent-session.js`: Beim
  Reload und beim Session-Ende werden diese Listener entfernt, bevor eine
  neue Extension-Generation startet.
- `dist/core/package-manager.js`: explizite `+extensions/...`-Einträge aus
  `settings.json` bestimmen innerhalb derselben Konfigurations-Priorität die
  Extension-Reihenfolge.

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
