# Phase 04 – Electron-Shell und Sicherheitsbasis

## Ziel

Eine produktionsfähige Electron-Prozessgrenze schaffen, bevor fachliche GUI-Funktionen ergänzt werden.

## Aufgaben

1. Main-, Preload- und Renderer-Builds trennen.
2. `nodeIntegration` deaktivieren.
3. `contextIsolation`, Sandbox und `webSecurity` aktivieren.
4. Lokale, gebündelte Renderer-Inhalte laden.
5. Content Security Policy festlegen.
6. Navigation und neue Fenster standardmäßig blockieren.
7. geprüfte externe Linköffnung implementieren.
8. Schmale Preload-API aus dem UI-Contract ableiten.
9. Alle IPC-Payloads validieren.
10. Release-Verhalten von DevTools und Logging definieren.
11. Window-State nur in GUI-eigenem Namespace speichern.

## Nicht erlaubt

- rohes `ipcRenderer`
- generisches `send(channel, payload)`
- generische Shell- oder Dateisystemmethoden
- Remote-Webanwendung im Hauptfenster
- Secrets im Renderer

## Erforderliche Tests

- Renderer hat kein `require` und kein `process`
- unbekannter IPC-Kanal wird abgelehnt
- ungültige Payload wird abgelehnt
- Remote-Navigation wird blockiert
- Popup wird blockiert
- erlaubter externer Link wird kontrolliert geöffnet
- CSP blockiert nicht erlaubte Skripte
- Fensterzustand beeinflusst keine Runtime-Einstellung

## Abschlusskriterien

- [ ] Alle verbindlichen Electron-Sicherheitseinstellungen sind aktiv und getestet.
- [ ] Renderer besitzt keinen direkten Node-, Shell- oder Dateisystemzugriff.
- [ ] Preload exponiert ausschließlich benannte Contract-Aktionen.
- [ ] Jede IPC-Nachricht wird zur Laufzeit validiert.
- [ ] Remote-Navigation und unkontrollierte Fenster sind blockiert.
- [ ] Release-Build lädt nur gebündelte lokale Inhalte.
- [ ] GUI-Layout-Einstellungen sind von Pi-Runtime-Einstellungen getrennt.
- [ ] Sicherheitstests laufen automatisiert.

## Gate

Kein fachliches Feature darf vor Abschluss dieser Sicherheitsbasis in den Renderer integriert werden.

