# Pi System-Profil

`pis` startet dieselbe Pi-Runtime wie `pi`, mit festem Workspace,
separaten Sessions und eigenen Setup-Präferenzen. Das Profil hängt nicht vom
aktuellen Verzeichnis oder einem Git-Repository ab.

## Installation

Die Synchronisation kopiert `bin/pi` und `bin/pis` nach `~/.pi/agent/bin/`.
Den Wechsel der PATH-Befehle prüft man zuerst:

```bash
npm run install:user -- --dry-run --link-cli
```

Der explizite Anwenden-Schritt lautet:

```bash
npm run install:user -- --apply --link-cli
```

Der Installer legt `~/.local/bin/pi` und `~/.local/bin/pis` an. `pi` wird nur
ersetzt, wenn es auf die Pi-Runtime im ausgewählten Agent-Verzeichnis zeigt;
`pis` wird nur angelegt oder beibehalten, wenn es auf den zugehörigen Launcher
zeigt. Reguläre Dateien und fremde oder defekte Symlinks werden nicht ersetzt.
Der vorherige `pi`-Symlink kann für den Rückweg wieder auf
`~/.pi/agent/npm/node_modules/.bin/pi` zeigen. Bei einem abweichenden
Agent-Verzeichnis gilt dessen `npm/node_modules/.bin/pi`.

## Start und Profilgrenzen

```bash
pi                         # unverändertes Projektprofil
pis                        # unabhängiges System-Profil
pis --continue             # letzte Pi-System-Sitzung fortsetzen
pis --resume               # Pi-System-Sitzung auswählen
```

`pi system` bleibt als kompatibler Alias erhalten. `pis` setzt den Arbeitsordner
auf `$PI_CODING_AGENT_DIR/profile-state/system/workspace` und speichert die
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
Fenstertitel, IP-Adressen oder Prozesslisten. QuickPanel-/Android-Sitzungen
sind noch nicht integriert oder live abgenommen. Hermes bleibt bis zum
Abschluss aller Paritäts- und Rollback-Gates erhalten.

## System-Control-Werkzeuge

`system-control` registriert in beiden Profilen typed Werkzeuge (im Projektprofil `pi` bleiben sie inaktiv, bis der Prompt Systemarbeit verlangt, siehe ADR 038) für Status und Journal (`system_unit_status`, `system_journal`, `nixos_status`, `desktop_state`, `audio_status`, `system_job`) sowie Benutzeraktionen (`desktop_switch_workspace`, `desktop_focus_window`, `audio_set_volume`, `notify`, `user_service`, `nixos_build`, `nixos_apply`). Lesezugriffe sind auf allen Permission-Stufen freigegeben. Benutzeraktionen benötigen je Aufruf eine Freigabe; `nixos_apply` benötigt sie auch in YOLO-Stufen. Readonly, Headless und Plan Mode sperren Mutationen.

Die Werkzeuge rufen ausschließlich feste Programme mit argv-Arrays und minimaler Kindumgebung auf. Es gibt keinen Shell- oder sudo-Fallback. Root-Aktionen laufen über `nixos-agent-apply`; die feste Service-Allowlist schließt `agent-control`, `quickshell-quickpanel` und `pi-system-host` aus. Geschützte NixOS-/sudo-Befehle in Bash und interaktiver Shell benötigen in jedem Profil (ausgenommen die YOLO-Stufen von `pi`) ebenfalls eine Freigabe, sofern keine bestehende harte Sperre greift. Die Erkennung durchsucht Shell-Tokens und zerlegt passende Nutzlasten wie `bash -c` rekursiv bis Tiefe drei. Sie ist Unfallschutz, keine Grenze gegen ein adversariales Modell: Variablenindirektion, Kodierung und Skriptdateien werden nicht erkannt. Harmlose Token-Treffer wie `echo sudo` können eine Rückfrage auslösen; `grep -r nixos-agent docs` bleibt wegen des unvollständigen Namens erlaubt. Ausgaben werden auf 16.000 Zeichen begrenzt und bekannte Tokenmuster redigiert; `desktop_state` projiziert nur freigegebene Felder und gibt keine Fenstertitel aus.

Jede Ausführung und Ablehnung wird ohne Ausgabe oder Rohargumente protokolliert. Standardpfad ist `${XDG_STATE_HOME:-~/.local/state}/pi-system/audit.jsonl`; `PI_SYSTEM_AUDIT_DIR` kann das Audit-Verzeichnis setzen. Verzeichnis- und Dateimodi sind `0700` und `0600`; ab 1 MiB wird eine Sicherung rotiert. Auditfehler werden im Tool-Ergebnis gemeldet, ohne die Aktion umzuschalten.
