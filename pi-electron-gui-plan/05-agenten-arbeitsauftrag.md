# Arbeitsauftrag für den Coding-Agenten

## Rolle

Du arbeitest als Senior Engineer für TypeScript, Node.js, Electron, React, Desktop-Sicherheit und AI-Agent-Runtimes im Repository `daydaylx/pi`.

## Ziel

Implementiere eine separate Electron-GUI, die über `pi gui` startet, während `pi` unverändert die vorhandene TUI startet. Beide Frontends müssen dieselbe Pi-Runtime und dieselben fachlichen Zustände verwenden.

## Verbindliche Regeln

1. Lies zuerst alle Dokumente dieses Pakets.
2. Rekonstruiere den aktuellen Codezustand. Dokumentation ist nicht automatisch wahr.
3. Arbeite streng in der angegebenen Phasenreihenfolge.
4. Beginne keine Folgephase, solange Abschlusskriterien der aktuellen Phase fehlen.
5. Pi Runtime bleibt einzige Source of Truth.
6. Implementiere keine zweite Workflow-, Verification-, Permission- oder Sessionlogik.
7. Verwende `AgentSessionRuntime` für Projekt- und Sessionwechsel.
8. Verändere die bestehende TUI und ihre Shortcuts nicht ohne zwingenden, dokumentierten Grund.
9. Der Electron-Renderer erhält keinen Node-, Shell- oder direkten Dateisystemzugriff.
10. Verwende keine generische IPC-Methode wie `execute`, `readFile` oder `send(channel, payload)`.
11. Vermeide eine zweite Installation oder gebündelte abweichende Version von `@earendil-works/pi-coding-agent`.
12. Entferne Listener, Timer und Dialoge bei Runtime-Wechseln vollständig.
13. Eine geschlossene Permission-Anfrage darf niemals als Zustimmung gelten.
14. TUI und GUI dürfen dieselbe Session nicht gleichzeitig beschreiben.

## Vorgehen pro Phase

1. Relevanten aktiven Code und Tests identifizieren.
2. Ist-Zustand und Abweichungen vom Plan dokumentieren.
3. Kleinste tragfähige Änderung planen.
4. Änderung implementieren.
5. gezielte Tests ergänzen.
6. bestehende Tests ausführen.
7. jedes Abschlusskriterium mit Nachweis abhaken.
8. offene Risiken dokumentieren.
9. erst dann nächste Phase beginnen.

## Umgang mit Abweichungen

Stoppe und dokumentiere die Abweichung, wenn eine Phase nur durch Folgendes möglich wäre:

- Patchen privater TUI-Renderer
- zweiter persistenter Runtime-State
- abweichende Pi-Paketversion
- direkter Node-Zugriff im Renderer
- Umgehung vorhandener Permissions
- gleichzeitiges Schreiben derselben Session
- große neue Abhängigkeit ohne nachgewiesenen Nutzen

## Erforderliche Abschlussausgabe pro Phase

- geänderte Dateien
- Architekturentscheidung
- ausgeführte Tests und Resultate
- Nachweis je Abschlusskriterium
- bekannte Restprobleme
- Entscheidung: `GO`, `NO-GO` oder `GO MIT DOKUMENTIERTEM RESTRISIKO`

## Endabnahme

Nach Phase 11 wird zusätzlich die gesamte Test- und Paritätsmatrix ausgeführt. Ein Release ist nur zulässig, wenn die Gesamt-Definition-of-Done erfüllt ist.

Schwierigkeiten: 9/10 | Thinking: xhigh
