# Pi System-Profil

`pi system` startet dieselbe Pi-Runtime wie `pi`, mit festem Workspace,
separaten Sessions und eigenen Setup-Präferenzen. Das Profil hängt nicht vom
aktuellen Verzeichnis oder einem Git-Repository ab.

## Installation

Die Synchronisation kopiert `bin/pi` nach `~/.pi/agent/bin/pi`. Den Wechsel des
PATH-Befehls prüft man zuerst:

```bash
npm run install:user -- --dry-run --link-cli
```

Der explizite Anwenden-Schritt lautet:

```bash
npm run install:user -- --apply --link-cli
```

Der Installer ändert `~/.local/bin/pi` nur, wenn es fehlt oder auf die Pi-
Runtime im ausgewählten Agent-Verzeichnis zeigt. Eine reguläre Datei, ein
defekter Symlink oder ein anderer Symlink wird nicht ersetzt. Der vorherige
Symlink kann für den Rückweg wieder auf
`~/.pi/agent/npm/node_modules/.bin/pi` zeigen. Bei einem abweichenden
Agent-Verzeichnis gilt dessen `npm/node_modules/.bin/pi`.

## Start und Profilgrenzen

```bash
pi                         # unverändertes Projektprofil
pi system                  # unabhängiges System-Profil
pi system --continue       # letzte Pi-System-Sitzung fortsetzen
pi system --resume         # Pi-System-Sitzung auswählen
```

`pi system` setzt den Arbeitsordner auf
`$PI_CODING_AGENT_DIR/profile-state/system/workspace` und speichert die
interaktiven TUI-Sessions unter
`$PI_CODING_AGENT_DIR/profile-state/system/sessions` (Standard:
`~/.pi/agent`). Der RPC-Host verwendet getrennt
`$PI_CODING_AGENT_DIR/profile-state/system/host-sessions`, damit TUI und Dienst
nicht gleichzeitig in dieselben Sessiondateien schreiben. Alle Verzeichnisse
werden mit Modus `0700` angelegt. Die Setup-Präferenzen liegen in
`$PI_CODING_AGENT_DIR/profile-state/system/setup.json`; `pi` verwendet weiter
`$PI_CODING_AGENT_DIR/setup.json`. Der Plan-Store ist gemeinsam implementiert,
bindet Pläne aber an Workspace-Pfad und Session-ID.

Der Launcher erzwingt `--no-approve`, `--no-context-files` und das
System-Sitzungsverzeichnis. `--approve`, `--session-dir`, `--session` und
`--fork` werden abgewiesen, damit CLI-Argumente das Profil nicht aus seinem
Sitzungsraum herausführen. Sitzungen wählt man mit `--continue` und `--resume`.
Modell- und Thinking-Optionen bleiben verfügbar.

Pi-Core, Modell-/Auth-Konfiguration und Extensions bleiben gemeinsam. Der
System-Launcher setzt `PI_LAUNCH_PROFILE=system` nur als Kennung für die
Profilkonfiguration und Darstellung. **Diese Kennung autorisiert keine
Systemoperation.** Root-, NixOS- und Desktopfähigkeiten werden über eigene
Host-Policies eingebunden. Ein lokaler gemeinsamer Pi-System-Host ist als
Quellcode vorhanden; QuickPanel und Android sind noch nicht daran angeschlossen.

## Theme und Darstellung

Das System-Profil verwendet `aurora-system` mit Graphitblau, Türkis und
Eisblau. Aurora setzt die Theme-Instanz sitzungsbezogen; der Wechsel schreibt
den Theme-Namen nicht in die globale Pi-Konfiguration zurück. Startbildschirm
und Footer kennzeichnen `PI · SYSTEM` beziehungsweise `SYSTEM`. Das normale
`pi` behält Aurora Forge.

## Prüfung und Grenzen

Der Launcher prüft vor einer Verknüpfung das vorhandene Kommando und ersetzt
nur den erwarteten Runtime-Symlink. Das Profil ändert keine aktive Installation,
startet keinen Dienst und führt keinen NixOS-Build oder -Switch aus.

Die Extension `system-context` fügt ausschließlich im Systemprofil einen
begrenzten read-only Grundkontext hinzu. Flake-, Health-, Desktop- und
Repository-Details werden anhand der Anfrage nachgeladen. Der Cache läuft nach
30 Sekunden ab und wird bei einer Änderung der erkannten Konfigurationsrevision
sofort erneuert. Drei lokale Hinweise für NixOS-Diagnose, Systemgesundheit und
Desktopsteuerung werden nur zur passenden Anfrage geladen. Sie verleihen keine
Berechtigungen.

Der Collector liest keine Credential-Dateien, Journals, Clipboard-Inhalte,
Fenstertitel, IP-Adressen oder Prozesslisten. Websuche, echte Desktopaktionen,
privilegierte Werkzeuge sowie autoritative QuickPanel-/Android-Sitzungen sind
noch nicht integriert oder live abgenommen. Hermes bleibt bis zum Abschluss
aller Paritäts- und Rollback-Gates erhalten.
