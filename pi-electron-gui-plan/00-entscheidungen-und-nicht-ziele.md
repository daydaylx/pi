# Verbindliche Entscheidungen und Nicht-Ziele

## Ziel

Pi erhält zwei separate Frontends mit gemeinsamem Runtime-Unterbau:

- `pi` startet weiterhin die vorhandene TUI.
- `pi gui` startet Electron.
- Ein Fehler der GUI darf die TUI nicht beschädigen oder blockieren.

## Verbindliche Architekturentscheidungen

### Pi Runtime bleibt Source of Truth

Die GUI darf keinen eigenen fachlichen Agent-State besitzen. Zustände für Workflow, Session, Verification, Permissions, Modelle, Tools und Subagenten stammen aus der aktiven Pi-Runtime.

### `AgentSessionRuntime` statt nackter `AgentSession`

Projekt- und Sessionwechsel müssen cwd-gebundene Dienste, Extensions und Event-Abonnements kontrolliert ersetzen können. Dafür wird die Runtime-Abstraktion verwendet, nicht nur eine einmal erzeugte Session.

### Kleine gemeinsame Präsentationsschicht

Die gemeinsame Schicht heißt sinngemäß `ui-contract` oder `presentation-core`. Sie enthält ausschließlich:

- typisierte Snapshots
- Runtime-zu-UI-Projektionen
- UI-Aktionen
- Events und Schemas
- reine Formatierungs- und Priorisierungsregeln

Sie enthält keine Persistenz, Workflow-Engine, Verification-Entscheidung oder zweite Statusmaschine.

### Electron-Prozessgrenzen

- Main Process: Pi Runtime und privilegierte Operationen
- Preload: schmale, validierte API
- Renderer: React-Oberfläche ohne Node- oder Systemzugriff

### Sessionzugriff

Pro Session ist höchstens ein schreibender Prozess erlaubt. TUI und GUI dürfen dieselbe Session nicht gleichzeitig verändern.

### Bestehende Bedienung

Die TUI und ihre kanonischen Shortcuts bleiben unverändert. Die GUI spiegelt relevante Shortcuts nur im fokussierten Fenster und stellt für jede Aktion eine Mausbedienung bereit.

## GUI-Version 1

Enthalten:

- Projekt- und Sessionauswahl
- Chat, Streaming und Thinking
- Tool-Aktivität und Ergebnisse
- Queue, Steer, Follow-up und Abort
- Workflow-, Modell- und Thinking-Auswahl
- Project Trust und Permissions
- Ask-User-Dialoge
- Changes, Diff und Verification
- Sessionwechsel, Fork und Compaction
- Subagent-Status
- Kontextanzeige
- getrennte GUI-Layout-Einstellungen

## Nicht-Ziele

- kein Code-Editor
- kein Terminal-Emulator
- kein vollständiger Git-Client
- kein Plugin-Marktplatz
- kein Workflow-Builder
- keine neue Workflow- oder Completion-Maschine
- keine eigene Verification-Logik
- keine automatische Planner-Worker-Reviewer-Kette
- keine parallelen Hauptsessions im selben Fenster
- kein Multi-Window in Version 1
- keine frei verschiebbaren Dashboard-Komponenten
- keine permanente rechte Sidebar
- kein dauerhaftes Subagent-Dashboard
- keine automatischen Commits oder Pushes
- keine GUI-exklusiven Workflow-Befehle
- keine zweite Installation einer abweichenden Pi-Runtime

## Änderungsregel

Ein Nicht-Ziel darf nur durch eine bewusste neue Architekturentscheidung aufgehoben werden. Es darf nicht nebenbei während einer Phase in den Umfang rutschen.

