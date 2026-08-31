# 08 – Phase 6: Changes & Review

## Ziel

Dateiänderungen direkt in den Task-Lifecycle integrieren.

## Zusammenfassung im Workspace

```text
4 files changed   +132 -48

layout.ts            +61 -18
composer.ts          +29 -10
activity.tsx         +38 -18
styles.css            +4  -2

[ Review changes ]
```

## Review-Ansicht

Minimal:

```text
┌───────────────────┬────────────────────────────────────┐
│ Changed Files     │ Diff                               │
│                   │                                    │
│ layout.ts         │ - old                              │
│ composer.ts       │ + new                              │
│ activity.tsx      │                                    │
└───────────────────┴────────────────────────────────────┘
```

## Nicht-Ziel

Kein vollständiger Editor.

## Anforderungen

- taskbezogene Änderungen
- Diff direkt erreichbar
- geänderte Dateien kompakt auflistbar
- staged/uncommitted/committed nur dann unterscheiden, wenn Daten zuverlässig vorhanden sind
- Review-Zustand muss mit Taskstatus verknüpft werden können

## Abschlusskriterien

- alle geänderten Dateien eines Tasks sichtbar
- Diff funktioniert
- große Diffs bleiben performant
- Review kann ohne externes Programm erfolgen
- Taskwechsel zeigt korrekte Changes
- Build/Test erfolgreich
