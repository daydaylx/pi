# Gesamtabschluss – Definition of Done

Die Electron-GUI ist erst releasefähig, wenn alle folgenden Punkte nachgewiesen sind.

## Frontendtrennung

- `pi` startet ausschließlich die bestehende TUI.
- `pi gui` startet ausschließlich die Electron-GUI.
- Ein GUI-Fehler verändert den TUI-Pfad nicht.
- TUI-Argumente, Exit-Codes und Signale bleiben kompatibel.

## Gemeinsame Runtime

- TUI und GUI verwenden dieselbe gepinnte Pi-Runtime-Version.
- Es existiert keine zweite Workflow-, Session-, Permission- oder Verification-Implementierung.
- GUI-Snapshots sind reine Projektionen vorhandener Quellen.
- Projekt- und Sessionwechsel verwenden `AgentSessionRuntime`.
- Alte Listener und Events werden zuverlässig entfernt beziehungsweise verworfen.

## Sicherheit

- Renderer besitzt keinen Node-, Shell- oder direkten Dateisystemzugriff.
- IPC ist schmal, typisiert und laufzeitvalidiert.
- Remote-Navigation und unkontrollierte Fenster sind blockiert.
- Project Trust und Permission-Modi funktionieren vollständig.
- Dialogabbruch oder Fensterschließen kann niemals still erlauben.
- Logs enthalten keine Credentials.

## Sessions

- Pro Session existiert höchstens ein Writer.
- TUI/GUI-Konflikte werden vor dem Schreiben erkannt.
- stale Locks sind sicher wiederherstellbar.
- verschiedene Sessions dürfen parallel verwendet werden.
- Schließen während eines Turns verlangt eine klare Entscheidung.

## Funktionsparität

- Chat und Streaming
- Thinking und Tools
- Queue, Steer, Follow-up und Abort
- Session erstellen, öffnen, wechseln, benennen und forken
- Compaction
- Modelle und Thinking
- Workflows
- Permissions und Trust
- Changes und Diff
- Verification
- Subagent-Status
- Kontextanzeige

## UX und Performance

- keine permanente Sidebar oder Dashboard-Überladung
- Fehler und Blockaden haben visuelle Priorität
- Thinking ist sichtbar und einklappbar
- Tool-Ausgaben bleiben kompakt
- lange Sessions und Diffs blockieren die Oberfläche nicht
- alle Shortcuts besitzen eine Mausalternative
- TUI-Shortcuts wurden nicht verändert

## Qualitätssicherung

- alle Phasen-Abschlusskriterien erfüllt
- Paritätsmatrix abgearbeitet
- Unit-, Integrations- und Smoke-Tests grün
- reproduzierbarer Linux-Release-Build
- Installations- und Starttest auf sauberer Umgebung
- keine offenen P0- oder P1-Fehler
- verbleibende P2-Risiken dokumentiert

