# Zielarchitektur

## Gesamtbild

```text
Pi Launcher
├── Standardpfad
│   └── bestehender TUI-Entry-Point
└── GUI-Pfad
    └── Electron
        ├── Main Process
        │   ├── AgentSessionRuntime
        │   ├── Resource Loader und Extensions
        │   ├── EventBus
        │   ├── Session Lifecycle
        │   ├── Session Locks
        │   ├── Permissions und Project Trust
        │   └── UI Projection
        ├── Preload Bridge
        │   └── validierte, explizite IPC-Methoden
        └── React/Vite Renderer
            ├── Conversation
            ├── Composer
            ├── Thinking und Tools
            ├── Changes und Verification
            └── Overlays und Drawer
```

## Launcher

Nur das exakte erste Argument `gui` wählt den GUI-Pfad. Alle anderen Argumente werden unverändert an den bestehenden CLI-Pfad weitergegeben.

Beispiele:

```text
pi
pi --continue
pi --session <id>
pi gui
pi gui --continue
pi gui --session <id>
pi gui --project <path>
```

## Main Process

Der Main Process besitzt die aktive `AgentSessionRuntime`. Er ist verantwortlich für:

- Aufbau und Austausch der Runtime
- Projekt- und Sessionvalidierung
- Extensions und EventBus
- Auth, Modelle und Einstellungen
- Permission- und Trust-Anfragen
- Session Locks
- Projektion des Runtime-Zustands in UI-Snapshots
- kontrolliertes Beenden und Wiederherstellen

## Runtime-Wechsel

Jeder Runtime-Wechsel folgt einem festen Ablauf:

1. neue Aktionen vorübergehend sperren
2. offene Dialoge abbrechen oder übertragen, niemals automatisch bestätigen
3. laufende Subscriptions entfernen
4. alte Runtime kontrolliert schließen
5. cwd-gebundene Dienste neu erzeugen
6. Extensions und EventBus neu binden
7. Runtime-Generation erhöhen
8. vollständigen Snapshot senden
9. neue Aktionen freigeben

Events tragen eine Runtime-Generation. Verspätete Events einer alten Generation werden verworfen.

## Preload Bridge

Die Bridge exponiert einzelne Aktionen, keine generischen Systemprimitive. Zulässige Kategorien:

- Runtime-Snapshot lesen
- Prompt, Steer, Follow-up und Abort
- Session erstellen, öffnen, wechseln, forken und kompaktieren
- Permission- und Ask-User-Antworten
- Projekt öffnen
- Modell, Thinking und Workflow auswählen
- Verification auslösen
- GUI-Layout-Einstellungen lesen und schreiben

Verboten:

- beliebige Shellbefehle
- beliebige Dateizugriffe
- rohe IPC-Kanäle
- Zugriff auf Prozessumgebung
- Übergabe privilegierter Objekte an den Renderer

## Renderer

Der Renderer darf lokalen View-State halten:

- aktiver Drawer
- Scrollposition
- Panelbreiten
- Fensterbezogene Darstellung
- Entwurfsinhalt im Composer
- reduzierte Animationen

Fachlicher State wird nicht unabhängig gespeichert. Nach einem vollständigen Snapshot muss der Renderer jederzeit wieder einen korrekten Zustand darstellen können.

## Visuelles Grundlayout

```text
┌ Projekt / Session ─ Modus ─ Modell ─ Thinking ┐
│                                                │
│ Unterhaltung                                   │
│ sichtbare, einklappbare Thinking-Blöcke        │
│ kompakte Tool-Aktivität                        │
│                                                │
├────────────────────────────────────────────────┤
│ Eingabe                                  Senden │
├ Status · Änderungen · Verifikation · Kontext ──┤
```

Sekundärinformationen erscheinen als Drawer, Picker oder fokussiertes Overlay. Es gibt keine permanente rechte Sidebar.

