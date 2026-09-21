# GUI-001 — Standard-Electron-Start aktiviert die State-Bridge nicht

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** GUI, Frontend-Bridge, UX
- **Ziel:** Der normale Electron-Launcher muss denselben fachlichen Bridge-State liefern wie der neue Frontend-Adapter.

## Betroffene Bereiche

- `gui/main/pi-rpc-manager.js`
- `gui/main/ipc-handlers.js`
- `bin/pi-gui`
- `extensions/frontend-bridge/index.ts`
- Renderer-State und GUI-E2E-Tests

## Verbindliche Regeln

1. Kein manueller Umgebungsparameter darf für den Standardpfad erforderlich sein.
2. Die Bridge darf nur im dafür vorgesehenen Frontend-Modus aktiv werden.
3. TUI-Sessions dürfen nicht unbeabsichtigt Bridge-Einträge persistieren.
4. Der Integrationstest muss den echten Standard-Launcher verwenden.

## Todos

- [ ] Tatsächlichen Electron-Spawn und Env-Aufbau prüfen.
- [ ] `PI_FRONTEND_RPC=1` dort setzen oder den gemeinsamen Adapter verwenden.
- [ ] Renderer-Erwartungen für Workflow, Permissions, Änderungen, Verifier und Subagenten prüfen.
- [ ] Bestehende Bridge-Unit-Tests um Standardstart erweitern.
- [ ] E2E-Test in die tatsächlich ausgeführte GUI-Testkette aufnehmen.

## Pflicht-Regressionstests

- Start über `pi gui` ohne manuelle Env-Variable.
- Bridge-Eintrag nach erfolgreichem Handshake.
- Fehler beim State-Handshake sichtbar als unbekannt/fehlerhaft, nicht als fertiger Default.
- Normale TUI-Session ohne Bridge-Persistenz.

## Abnahmekriterien

- Der Standard-Electron-Start liefert aktuellen Fachstatus.
- Kein Test setzt die fehlende Variable heimlich selbst.
- GUI- und Bridge-E2E-Test sind Teil der CI oder klar begründeter verpflichtender Integration.

## Abhängigkeiten

- Gemeinsamer State-Vertrag; mögliche Verbindung zu GUI-002.

## Risiken

- Ein gemeinsamer Adapter kann bestehende GUI-RPC-Erwartungen verändern.

## Erforderlicher Abschlussnachweis

PR mit Launcher-Änderung und E2E-Log des Standardstarts.
