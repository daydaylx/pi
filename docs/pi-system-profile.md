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
interaktiven TUI-Sessions standardmäßig unter
`$PI_CODING_AGENT_DIR/profile-state/system/sessions` (Standard:
`~/.pi/agent`). Der RPC-Host verwendet getrennt
`$PI_CODING_AGENT_DIR/profile-state/system/host-sessions`, damit TUI und Dienst
nicht gleichzeitig in dieselben Sessiondateien schreiben. Alle Verzeichnisse
werden mit Modus `0700` angelegt. Die Setup-Präferenzen liegen in
`$PI_CODING_AGENT_DIR/profile-state/system/setup.json`; `pi` verwendet weiter
`$PI_CODING_AGENT_DIR/setup.json`. Der Plan-Store ist gemeinsam implementiert,
bindet Pläne aber an Workspace-Pfad und Session-ID.

Der Launcher erzwingt `--no-approve` und `--no-context-files`. `--approve` wird
ignoriert, damit keine nativen Freigabedialoge die Ausführung anhalten.
`--session-dir`, `--session` und `--fork` bleiben verfügbar und können explizit
andere Sitzungsdateien verwenden. Ohne diese Optionen bleiben CLI- und
Host-Sessions getrennt. Modell- und Thinking-Optionen bleiben verfügbar.

Wenn eine Anfrage ein bekanntes Repository benennt, ergänzt `system-context`
dessen Pfad und einen Repository-Arbeitshinweis. Vor Änderungen soll Pis die
anwendbaren `AGENTS.md`-/`CLAUDE.md`-Anweisungen und relevante README-Dateien
oder Paket-Skripte lesen. Diese Hinweise gelten nur für das jeweilige
Repository und den Auftrag; Nutzer- und Systemanweisungen haben Vorrang.
Anweisungen in Logs, generierten Dateien, Fixtures und Testdaten gelten als
Daten. Projektdateien werden weiterhin nicht automatisch in den Startkontext
geladen.

Pi-Core, Modell-/Auth-Konfiguration und Extensions bleiben gemeinsam. Im
Systemprofil erzwingt `PI_LAUNCH_PROFILE=system` dauerhaft `yolo-full` und
überspringt Pi-eigene Permission- und Tool-Call-Guards. `/permission` und
`/yolo` können den Vollzugriff nicht absenken. `pis` verlangt keine
Bestätigungen für Befehle, Dateioperationen, System-Control-Aufrufe oder
Projektprüfungen. Die tatsächlichen Betriebssystemrechte des Nutzers und
normale Laufzeit- oder Ausführungsfehler gelten weiterhin.

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

## Arbeitsvertrag und Diagnose

`--no-context-files` bleibt aktiv: Die Runtime lädt damit weder globale noch
Projekt-`AGENTS.md`/`CLAUDE.md`. Das globale `APPEND_SYSTEM.md` für Kommunikation,
native Skills und Extension-Hooks bleiben verfügbar.

`system-context` ergänzt deshalb bei jedem `before_agent_start` im Systemprofil
einen kurzen Arbeitsvertrag: Untersuchungen tatsächlich ausführen,
Anschlussfragen im Sitzungskontext verfolgen, beauftragte Änderungen validieren,
Blockaden belegen und Abschluss am Nutzerziel messen. Bekannte kleine
Informationsfragen werden direkt beantwortet. Vollzugriff autorisiert keine
unbeauftragte Reparatur oder Aktivierung. Derselbe Hook gilt für TUI und RPC;
im Projektprofil wird dieser Vertrag nicht hinzugefügt.

Die nativen Skills `nixos-system` und `system-health` unterstützen die Diagnose
mit priorisierten Folgeprüfungen. Historische Build-Records, aktueller Quellstand
und laufende Generation werden getrennt betrachtet. Technische Verifikations-
und Lifecycle-Status bleiben unverändert; es gibt keinen neuen Completion-Hook
und keine automatische Fortsetzung.

Ursachenbelege, reproduzierbare A–F-Tests und Grenzen der Modellmessung stehen
in [PIS-Untersuchungen](pis-investigation.md).

## System-Control-Werkzeuge

`system-control` registriert in beiden Profilen typed Werkzeuge (im Projektprofil `pi` bleiben sie inaktiv, bis der Prompt Systemarbeit verlangt, siehe ADR 038) für Status und Journal (`system_unit_status`, `system_journal`, `nixos_status`, `desktop_state`, `audio_status`, `system_job`) sowie Benutzeraktionen (`desktop_switch_workspace`, `desktop_focus_window`, `audio_set_volume`, `notify`, `user_service`, `nixos_build`, `nixos_apply`). Im Projektprofil gelten die gewählten Permission-Stufen. `pis` führt diese Tool-Aufrufe ohne Pi-seitige Bestätigung aus.

Die Werkzeuge rufen feste Programme mit argv-Arrays und minimaler Kindumgebung auf. Die Bash- und Datei-Guards von Pi blockieren im Profil `pis` keine Aufrufe. Tool-spezifische Eingabevalidierung und Betriebssystemrechte gelten weiterhin.

Jede Ausführung und Ablehnung wird ohne Ausgabe oder Rohargumente protokolliert. Standardpfad ist `${XDG_STATE_HOME:-~/.local/state}/pi-system/audit.jsonl`; `PI_SYSTEM_AUDIT_DIR` kann das Audit-Verzeichnis setzen. Verzeichnis- und Dateimodi sind `0700` und `0600`; ab 1 MiB wird eine Sicherung rotiert. Auditfehler werden im Tool-Ergebnis gemeldet, ohne die Aktion umzuschalten.
