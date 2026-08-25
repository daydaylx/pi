# Phase 1 – GUI-Kandidaten auditieren und Basis wählen

## Ziel

Nicht blind forken. Erst prüfen, welche bestehende GUI wirklich als Presentation Layer für `daydaylx/pi` taugt.

## Pflichtkandidaten

### A
`FaqFirebase/pi-desktop`

### B
`minghinmatthewlam/pi-gui`

Optional nur bei begründetem Bedarf:

### C
`AJSubrizi/Pi-App`

## Prüfdimensionen

Für jeden Kandidaten:

### Architektur
- Electron/Tauri
- React-Version
- State-Management
- Main/Renderer-Trennung
- Preload/IPC
- Pi-Anbindung
- RPC vs. SDK
- Session-Verwaltung

### Wiederverwendbare Komponenten
- Chat
- Markdown
- Tool-Cards
- Diff
- File Tree
- Terminal
- Sessions
- Workspace
- Settings
- Models
- Packaging

### Konflikte
- eigene Agentenlogik?
- eigenes Permission-System?
- eigenes Workflow-Modell?
- eigenes Verification-Modell?
- eigene Session-Wahrheit?
- eigener Model-Katalog?
- harte Pfade?
- Annahmen über Upstream-Pi?

### Wartbarkeit
- Tests
- Codegröße
- Architektur
- Aktivität
- Lizenz
- offene kritische Issues
- Abhängigkeiten

## Pflicht-Prototyp

Für den Favoriten einen **minimalen read-only Integrationstest** gegen `daydaylx/pi` durchführen.

Noch keine echte Migration.

Prüfen:

- Prozessstart
- Sessionstart
- Prompt
- Streaming
- Tool-Event
- Agent-Ende
- Fehler
- Stop/Cancel

## Entscheidung

Am Ende exakt eine Empfehlung:

- Kandidat A
- Kandidat B
- kontrollierter Eigenbau

Mit Begründung und Gegenargumenten.

## Abschlusskriterien

- [ ] A vollständig auditiert.
- [ ] B vollständig auditiert.
- [ ] Unterschiede nachvollziehbar dokumentiert.
- [ ] Favorit praktisch gegen `daydaylx/pi` getestet.
- [ ] keine Core-Anpassung nur für den Kandidaten vorgenommen.
- [ ] Lizenz geprüft.
- [ ] Wiederverwendungsanteil realistisch bewertet.
- [ ] No-Go-Kriterien geprüft.
- [ ] klare Empfehlung vorgelegt.

## STOP-Gate

Der Agent darf den Favoriten **nicht selbstständig forken und integrieren**.

Nach Audit:

```text
STATUS: PHASE 1 COMPLETE
NEXT: PHASE 2 BLOCKED
RECOMMENDATION: <A/B/EIGENBAU>
USER APPROVAL REQUIRED
```
