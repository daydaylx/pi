# Phase 7 – Hardening, Sicherheit und Packaging

## Ziel

Aus dem funktionsfähigen Prototyp eine verlässliche Anwendung machen.

## Sicherheit

Pflicht:

- contextIsolation aktiv
- Renderer Sandbox
- kein freier Node-Zugriff
- IPC-Whitelist
- Payload-Validierung
- kein beliebiger Shell-IPC
- CSP
- sichere externe Links
- keine Geheimnisse im Renderer

## Stabilität

Testen:

- Pi-Prozess beendet sich
- GUI beendet sich
- Provider-Fehler
- Tool-Fehler
- Session-Fehler
- Cancel während Tool
- Cancel während Streaming
- sehr langer Chat
- große Diff-Datei
- kleines Fenster
- maximiertes Fenster
- Neustart
- Resume

## Packaging

Mindestens Zielplattformen klar definieren.

Primär:

- Linux

Optional erst nach Freigabe:

- Windows
- macOS

## Regressionen

Pflicht:

- bestehendes `npm run verify`
- bestehende Pi-Tests
- GUI-Tests
- End-to-End
- Shortcut-Parität
- State-Divergenz

## Abschlusskriterien

- [ ] Sicherheitscheck bestanden.
- [ ] keine kritische IPC-Lücke.
- [ ] Crash-Szenarien getestet.
- [ ] Sessiondaten bleiben intakt.
- [ ] Linux-Paket läuft.
- [ ] `pi` läuft weiterhin unverändert.
- [ ] `pi gui` läuft stabil.
- [ ] Tests sind reproduzierbar.
- [ ] bekannte Einschränkungen dokumentiert.
- [ ] Rollback dokumentiert.

## STOP-Gate

```text
STATUS: PHASE 7 COMPLETE
NEXT: PHASE 8 BLOCKED
USER APPROVAL REQUIRED
```
