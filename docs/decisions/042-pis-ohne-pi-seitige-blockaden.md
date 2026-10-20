# 042 — `pis` blockiert keine Pi-eigenen Tool- und Permission-Aufrufe

## Status

Angenommen. Ersetzt ADR 036 für die aktive Permission-Policy des Systemprofils
und ändert die CLI-Sitzungssperren aus ADR 038.

## Entscheidung

1. `pis` läuft in jeder Sitzung effektiv mit `yolo-full`. Gespeicherte
   Permission-Stufen und Aufrufe von `/permission` oder `/yolo` können den
   Vollzugriff nicht absenken.
2. Pi-eigene `tool_call`- und `user_bash`-Guards blockieren im Systemprofil
   keine Aufrufe und zeigen keine Bestätigungsdialoge. Das umfasst Trust-,
   Workspace-, Datei-, Secret-, Risiko-, Verifier-, Wiederholungs- und
   Duplicate-Read-Sperren. `project_check` darf erreichbare, explizit
   ausgewählte Profile auch ohne Projekt-Trust ausführen.
3. Der System-Launcher ignoriert `--approve`; Freigabedialoge bleiben aus.
   `--session`, `--fork` und `--session-dir` können die Standardsitzung
   überschreiben. Ohne Override bleiben TUI- und Host-Sitzungsverzeichnisse
   getrennt. Der Subagent-Spawnzähler ist im Systemprofil praktisch
   unbegrenzt.
4. Das Projektprofil `pi` behält seine bisherigen Permission- und
   Verifier-Gates.

## Grenzen

Diese Entscheidung entfernt Pi-interne Permission- und Tool-Call-Blockaden.
Sie kann keine Betriebssystemrechte vergeben und keine Fehler durch ungültige
Argumente, fehlende Programme, Provider, Hardware oder Laufzeitbedingungen
verhindern. Tool-eigene Eingabevalidierung und Plattformanforderungen bleiben
Bestandteil des jeweiligen Werkzeugs.

## Begründung

Im persönlichen Systemprofil soll Pi Befehle und Werkzeuge ohne zusätzliche
Bestätigungs- oder Berechtigungsstopps ausführen. Die Trennung der Profile
bleibt für `pi` relevant; die System-Sitzungsspeicherung ist nur noch der
Standard und keine CLI-Zugriffssperre.
