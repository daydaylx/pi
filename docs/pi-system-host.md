# Pi-System-Host

Der Host betreibt genau einen `bin/pi-frontend`-Prozess in einem eigenen
Session-Verzeichnis (`profile-state/system/host-sessions`) und stellt dessen
v1-JSONL-Vertrag über einen lokalen Unix-Socket bereit. Das interaktive
`pis`-TUI bleibt in `profile-state/system/sessions`; beide können nicht
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

Metadaten der Sessionverwaltung werden im Session-Verzeichnis
(`profile-state/system/host-sessions`) in `.frontend-index.json` (Modus `0600`,
atomare Writes) geführt. Gelöschte Sitzungen werden nicht vernichtet, sondern
nach `.trash/<basename>.<timestamp>` (Modus `0700`) verschoben und aus dem Index
entfernt.

## Umgebung des Backends

Der Host reicht nicht die gesamte Host- bzw. systemd-Umgebung an den Backend-Prozess (`bin/pi-frontend`) weiter, sondern filtert die Umgebung über `filterBackendEnv(env)` strikt nach einer Allowlist (OP-H06). Der Host setzt anschließend seine eigenen Pfad- und Profilvariablen (`PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `PI_SYSTEM_WORKSPACE`, `PI_SYSTEM_SESSION_DIR`, `PI_LAUNCH_PROFILE`, `PI_FRONTEND_PI_PATH`).

### Erlaubte Variablen (exakt)
`HOME`, `PATH`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LANGUAGE`, `TERM`, `COLORTERM`, `NO_COLOR`, `FORCE_COLOR`, `TZ`, `TMPDIR`, `TMP`, `TEMP`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `XDG_SESSION_TYPE`, `DBUS_SESSION_BUS_ADDRESS`, `WAYLAND_DISPLAY`, `HYPRLAND_INSTANCE_SIGNATURE`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`, `NIX_PATH`, `NIX_SSL_CERT_FILE`, `LOCALE_ARCHIVE`.

### Erlaubte Präfixe
Variablen mit den Präfixen `LC_` und `PI_` werden automatisch durchgelassen.

### Passthrough über `PI_SYSTEM_HOST_ENV_PASSTHROUGH`
Zusätzliche Variablen können über `PI_SYSTEM_HOST_ENV_PASSTHROUGH` explizit freigegeben werden. Der Wert ist eine durch Kommas getrennte Liste von Variablennamen (jeder Name muss `/^[A-Za-z_][A-Za-z0-9_]*$/` entsprechen; maximal 64 Namen). Ungültige Namen werden ignoriert.

### Blockierte Variablen (Niemals weitergereicht)
Folgende Variablen werden niemals an das Backend durchgelassen – auch nicht über Passthrough oder Präfixe:
`NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `LD_AUDIT`, `DYLD_*`, `NODE_PATH`, `BASH_ENV`, `ENV`, `PYTHONPATH`.

### Provider-Authentisierung
Die reguläre Provider-Authentisierung läuft über `auth.json` im Pi-Agentenverzeichnis. Provider-Keys aus der Umgebung (wie z. B. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) sowie `SSH_AUTH_SOCK`, `GPG_*`, Tokens und der Rest der systemd-Umgebung werden standardmäßig **nicht** an das Backend weitergereicht. Falls Provider-Keys aus der Umgebung benötigt werden, müssen sie explizit per `PI_SYSTEM_HOST_ENV_PASSTHROUGH` freigegeben werden.

## Betriebsgrenzen und Ist-Stand (OP-H05)

- **Singleton / stale Socket**: Der Socket liegt unter `$XDG_RUNTIME_DIR/pi-system-host/frontend.sock` in einem privaten Verzeichnis (Modus `0700`, im Besitz des Nutzers). Vor dem Binden prüft der Host über einen Verbindungstest, ob bereits ein aktiver Host lauscht. Ist ein anderer Host aktiv, bricht der Start ab. Ein verwaister Socket (`ECONNREFUSED`) wird vor dem Start gelöscht.
- **Berechtigungen**: Der Socket gehört dem ausführenden Nutzer und wird mit Modus `0600` betrieben. Netzwerk-Ports werden nicht geöffnet.
- **Client-Limit**: Es werden maximal 8 Clients gleichzeitig akzeptiert (`MAX_CLIENTS = 8`). Überzählige Verbindungen werden sofort geschlossen.
- **Backpressure & Puffergrenzen**:
  - Inflight-Limits: Maximal 32 Anfragen pro Client (`MAX_INFLIGHT_PER_CLIENT = 32`), maximal 128 Anfragen systemweit (`MAX_INFLIGHT_TOTAL = 128`). Bei Überschreitung antwortet der Host mit `SESSION_BUSY` (`retryable: true`).
  - Lese-Puffer: Puffer ohne Zeilenumbruch ist auf 512 KiB begrenzt (`MAX_CLIENT_BUFFERED_CHARS`); bei Überschreitung wird der Client getrennt.
  - Schreib-Puffer: Writable-Buffer auf dem Client-Socket ist auf 1 MiB begrenzt (`MAX_CLIENT_WRITE_BUFFER`); bei Stau wird die Verbindung getrennt.
- **Frame-Limits**:
  - Client-Frames: Maximal 256 KiB (`MAX_FRAME_CHARS`). Größere Frames erhalten `INVALID_REQUEST` und die Verbindung wird getrennt.
  - Backend-Frames: Maximal 8 MiB (`MAX_BACKEND_FRAME_CHARS`). Backend-Zeilen über 8 MiB werden verworfen; laufende Backend-Anfragen werden mit `RESULT_TOO_LARGE` beantwortet und der Host bleibt verfügbar.
- **Request-Timeout**:
  - Client-Requests, die an das Backend weitergeleitet werden, unterliegen einem Timeout von standardmäßig 60.000 ms (konfigurierbar über Konstruktor-Option `requestTimeoutMs` und `PI_SYSTEM_HOST_REQUEST_TIMEOUT_MS`, gültiger Bereich: 1.000 bis 600.000 ms).
  - Bei Ablauf erhält der Client eine Fehlerantwort mit Code `REQUEST_TIMEOUT`, der Pending-Eintrag wird entfernt und eventuelle späte Backend-Antworten werden verworfen.
  - Betrifft alle weitergeleiteten Anfragen (`system.ping`, `session.*`, `agent.*`, `model.*`, `thinking.*`, `workflow.*`, `permission.*`, `command.*`, `verification.run`, `changes.list`, `configuration.get`, `ui.respond`). `agent.prompt` und `agent.followUp` blockieren nicht auf das Ende des Turns, sondern bestätigen lediglich den Start; die Turn-Überlappung wird über `promptStartGraceMs` (5.000 ms) gesteuert.
- **Shutdown mit offenem Dialog**:
  - Beim Herunterfahren (`stop()`) ruft der Host vor dem Beenden des Backends `cancelPendingUi()` auf.
  - Alle offenen Freigaben werden mit `cancelled` beantwortet und verbundene Clients erhalten `extension-ui.resolved` (`outcome: "cancelled"`).
- **Architektur-Grenze (Methoden-Allowlist)**:
  - Eine Methoden-Allowlist je Client-Klasse (z. B. Desktop vs. Android-Client) ist **ausdrücklich NICHT Teil des Hosts**, sondern Aufgabe der Android-Bridge (serverseitige Allowlist, Gate P5). Der Host bietet den vollen v1-Vertrag für alle authentifizierten Socket-Clients an.

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

Die User-Unit setzt `ProtectHome=read-only` und `ProtectSystem=strict`. Schreibbar
sind `~/.pi/agent` für Pi-Einstellungen und Profilzustand sowie das explizite
Arbeits-Repository `~/nixos-config`; andere Home-Pfade bleiben read-only.
`NoNewPrivileges`, private temporäre Dateien sowie Prozess-, CPU- und
Speicherlimits bleiben aktiv. Die Modellverbindung benötigt ausgehenden
Netzwerkzugriff. `TMPDIR` zeigt auf `profile-state/system/tmp`, damit der
jiti-Cache einen Neustart übersteht; mit kaltem Cache überschreitet der Start
das 10-s-Fenster des Hosts. Pi-Core, Provider-Auth und Extensions bleiben die
vorhandene Installation.

## Grenzen des aktuellen Hosts

- Die Autorität endet mit diesem Hostprozess. Der Pi-Session-Store bleibt die
  einzige Nachrichtenquelle; der Host dupliziert keine Prompt-Inhalte.
- Reconnect erhält einen aktuellen Snapshot, aber keinen Replay-Puffer für
  verpasste Stream-Events. Ein Client muss Nachrichten bei Bedarf über
  `session.messages` nachladen.
- Pi-Sitzungen sind persistent; ein separates dauerhaftes Run-/Job-Manifest,
  Crash-Recovery und Statusabgleich gestarteter externer Jobs fehlen. Die
  Host-Epoch gilt nur für den jeweiligen Prozess und bietet keinen Replay-Puffer.
- `pis` als interaktive TUI und der RPC-Host nutzen getrennte
  Session-Verzeichnisse. Eine Attach-/Handoff-Funktion existiert nicht; Verlauf
  und Sessionauswahl werden nicht automatisch zwischen den beiden Profilen
  zusammengeführt.
- Der systemd-Dienst ist nur als Unit-Vorlage vorhanden. Er wurde nicht
  installiert, aktiviert oder gegen eine echte Runtime als Dienst gestartet.
- QuickPanel-, Android-, Root- und Desktop-Adapter sind nicht Teil dieses
  Host-Commits; Hermes bleibt der aktive Rückfallpfad.

Darum ist Gate G5 weiterhin offen. Die isolierten Tests reichen nicht als
Freigabe für einen Desktop- oder Android-Cutover.
