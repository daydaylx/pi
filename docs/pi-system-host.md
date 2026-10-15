# Pi-System-Host

Der Host betreibt genau einen `bin/pi-frontend`-Prozess in einem eigenen
Session-Verzeichnis (`profile-state/system/host-sessions`) und stellt dessen
v1-JSONL-Vertrag über einen lokalen Unix-Socket bereit. Das interaktive
`pi system`-TUI bleibt in `profile-state/system/sessions`; beide können nicht
versehentlich dieselbe Sessiondatei beschreiben. Der Socket liegt unter
`$XDG_RUNTIME_DIR/pi-system-host/frontend.sock`, gehört dem ausführenden Nutzer
und hat Modus `0600`; ein Netzwerkport wird nicht geöffnet. Verbundene Clients
erhalten jeweils einen aktuellen Zustands-Snapshot und anschließend denselben
Ereignisstrom. Der Host serialisiert neue Prompts und weist parallele Starts mit
`SESSION_BUSY` zurück.

Der Host begrenzt Client-Frames auf 256 KiB und Backend-Frames auf 8 MiB.
Überschreitet eine Backend-Zeile das Limit, verwirft er sie bis zum nächsten
Zeilenumbruch, beantwortet laufende Anfragen mit `RESULT_TOO_LARGE` und bleibt
verfügbar. Nachrichten werden seitenweise mit höchstens 100 Einträgen und
100.000 serialisierten Zeichen geladen. Freigaben laufen nach 120 Sekunden ab;
`PI_SYSTEM_APPROVAL_TTL_MS` konfiguriert den Wert im Bereich von 5 bis 600
Sekunden. Jede Host-Instanz meldet eine zufällige `hostEpoch` für die Dauer
ihres Prozesses. Sie ermöglicht Resync-Erkennung, speichert aber keine Events.

## Quellcode prüfen

```bash
npm run build
node --test frontend-server/test/host.test.mjs
```

Die Host-Tests verwenden einen isolierten Fake-Runtime-Prozess. Sie prüfen einen
gemeinsamen Runtime-Owner, Snapshot bei Reconnect, parallele Prompts, fremde
Socket-Besitzer und den Timeout-Fall. Sie belegen keine Live-Kompatibilität mit
dem installierten Modellanbieter oder einem echten QuickPanel-/Android-Client.

## Installation und optionaler Start

Der Installer kopiert Launcher, Host, Protokollpaket und User-Unit. `--apply`
legt außerdem die privaten Profilverzeichnisse für systemd an. Danach müssen
die Abhängigkeiten im Agent-Verzeichnis installiert und das Protokoll gebaut
sein:

```bash
npm run install:user -- --dry-run
npm run install:user -- --apply
npm install --ignore-scripts --prefix ~/.pi/agent/npm
npm --prefix ~/.pi/agent run build
```

Die Unit liegt anschließend unter
`~/.pi/agent/systemd/pi-system-host.service`. Sie wird nicht automatisch in
systemd installiert, aktiviert oder gestartet. Falls der Host später manuell
freigegeben wird, kann die Unit in den User-Unit-Pfad kopiert, mit
`systemctl --user daemon-reload` eingelesen und einzeln gestartet werden. Ein
Quellcode-Installer-Aufruf schaltet Hermes oder eine aktive Oberfläche nicht
um.

Die Unit begrenzt Schreibzugriff auf
`~/.pi/agent/profile-state/system`, nutzt `NoNewPrivileges`, `ProtectSystem`
und private temporäre Dateien und setzt Prozess-, CPU- und Speicherlimits. Die
Modellverbindung benötigt ausgehenden Netzwerkzugriff. `TMPDIR` zeigt auf
`profile-state/system/tmp`, damit der jiti-Cache einen Neustart übersteht; mit
kaltem Cache überschreitet der Start das 10-s-Fenster des Hosts. Pi-Core, Provider-Auth
und Extensions bleiben die vorhandene Installation.

## Grenzen des aktuellen Hosts

- Die Autorität endet mit diesem Hostprozess. Der Pi-Session-Store bleibt die
  einzige Nachrichtenquelle; der Host dupliziert keine Prompt-Inhalte.
- Reconnect erhält einen aktuellen Snapshot, aber keinen Replay-Puffer für
  verpasste Stream-Events. Ein Client muss Nachrichten bei Bedarf über
  `session.messages` nachladen.
- Pi-Sitzungen sind persistent; ein separates dauerhaftes Run-/Job-Manifest,
  Crash-Recovery und Statusabgleich gestarteter externer Jobs fehlen. Die
  Host-Epoch gilt nur für den jeweiligen Prozess und bietet keinen Replay-Puffer.
- `pi system` als interaktive TUI und der RPC-Host nutzen getrennte
  Session-Verzeichnisse. Eine Attach-/Handoff-Funktion existiert nicht; Verlauf
  und Sessionauswahl werden nicht automatisch zwischen den beiden Profilen
  zusammengeführt.
- Der systemd-Dienst ist nur als Unit-Vorlage vorhanden. Er wurde nicht
  installiert, aktiviert oder gegen eine echte Runtime als Dienst gestartet.
- QuickPanel-, Android-, Root- und Desktop-Adapter sind nicht Teil dieses
  Host-Commits; Hermes bleibt der aktive Rückfallpfad.

Darum ist Gate G5 weiterhin offen. Die isolierten Tests reichen nicht als
Freigabe für einen Desktop- oder Android-Cutover.
