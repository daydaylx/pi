# Zielarchitektur

## Grundsatz

Die GUI wird **nicht** zum neuen Pi-Core.

Sie ist ein Client des bestehenden Pi-Unterbaus.

## Zielstruktur

```text
daydaylx/pi
│
├── core / runtime
│   ├── agent runtime
│   ├── tools
│   ├── extensions
│   ├── sessions
│   ├── providers
│   ├── models
│   ├── workflows
│   ├── permissions
│   ├── verification
│   └── subagents
│
├── frontend-protocol
│   ├── commands
│   ├── state
│   ├── events
│   ├── schemas
│   └── compatibility
│
├── Aurora TUI
│   └── pi
│
└── Desktop GUI
    ├── Electron main
    ├── preload bridge
    ├── React renderer
    └── pi gui
```

## Frontend-Protokoll

Die GUI darf möglichst nicht auf konkrete Aurora-Komponenten zugreifen.

Stattdessen werden semantische Zustände und Befehle verwendet.

Beispiele:

```text
commands:
- workflow.open
- workflow.set
- model.open
- model.set
- thinking.open
- thinking.set
- permissions.open
- permissions.set
- session.open
- session.create
- session.resume
- verification.run
- inspector.open
```

```text
state:
- session
- workflow
- task
- activity
- changes
- verification
- subagents
- model
- thinking
- permissions
- context
- lsp
```

## Shortcut-Prinzip

Nicht:

```text
Shift+Tab -> AuroraWidget42 öffnen
```

Sondern:

```text
Shift+Tab -> command: workflow.open
```

Frontend-spezifische Darstellung:

```text
Aurora -> TUI Overlay
GUI    -> Modal / Drawer / Command Surface
```

## Zustandsbesitz

### Core-owned

- Workflow
- aktives Modell
- Thinking/Effort
- Berechtigungsmodus
- Verification-Status
- Session-Zustand
- Tool-Lifecycle
- Subagent-Lifecycle
- Changes
- Context
- LSP-Zustand

### Frontend-owned

- Fenstergröße
- Panelbreite
- Theme
- Sidebar offen/geschlossen
- aktive GUI-Ansicht
- Tool-Card expandiert/eingeklappt
- lokale Scrollposition
- visuelle Dichte

## IPC-Sicherheitsmodell

Electron-Renderer erhält **keinen freien Node-Zugriff**.

Vorgabe:

```text
Renderer
  ↓
preload / contextBridge
  ↓
whitelist API
  ↓
Electron main
  ↓
Pi frontend adapter / RPC
```

Verboten:

- `nodeIntegration: true`
- beliebige Shell-Kommandos aus dem Renderer
- ungeprüfte dynamische IPC-Kanäle
- Core-Zugriff direkt aus React-Komponenten

## Kompatibilitätsziel

TUI und GUI müssen dieselben semantischen Commands verwenden, wo dies sinnvoll möglich ist.

Die Oberfläche darf anders aussehen.

Das Verhalten darf nicht auseinanderlaufen.
