# 038 — `pi` ist der gemeinsame Einstieg, die Profile bleiben darunter getrennt

## Status

Angenommen. Ergänzt ADR 034 (System-Control) und ADR 036 (offene Policy des
Systemprofils). Ersetzt aus ADR 034 nur den Satz, Systemwerkzeuge seien
außerhalb des Systemprofils nicht registriert.

## Ausgangslage

`pi` (Projektprofil) und `pis` (Systemprofil) unterscheiden sich über
Umgebungsvariablen, die der Launcher beim Prozessstart setzt: Arbeitsordner,
Sitzungsspeicher, Setup-Datei, Theme, `--no-approve`, Systemwerkzeuge,
System-Kontext und die offene Policy. Das Profil lässt sich in einer laufenden
Sitzung nicht wechseln, ohne Sitzung, Verlauf und Trust zu verlieren. Wer in
`pi` nach der CPU-Last fragte, hatte weder Werkzeug noch Kontext.

## Entscheidung

Kleinste tragfähige Variante: **ein Einstieg, keine Weiterleitung.**

1. Die typisierten System-Control-Werkzeuge werden in beiden Profilen
   registriert. Im Projektprofil bleiben sie inaktiv und gelangen erst in die
   aktive Werkzeugliste, wenn der **eigene Prompt** eindeutiges
   Systemvokabular enthält (ganze Wörter: CPU, RAM, NixOS, WLAN, Hyprland …).
   Dateiinhalte und Werkzeugausgaben entscheiden nie.
2. Rechteklassen (lesen / Benutzeraktion / privilegiert), die Trust-Ausnahme
   für diese Werkzeuge, die Audit-Spur und die Prüfung geschützter
   NixOS-/sudo-Befehle hängen am Werkzeugnamen und der Berechtigungsstufe,
   nicht am Profilnamen. Das Profil ist keine Rechtefreigabe.
3. Im Projektprofil fragt auf `project-write` dasselbe Risiko-Modul wie im
   Systemprofil (`system-open-policy.ts`) vor Git-Verlust, Rechte-,
   Datenträger-, Dienst- und Paketoperationen. YOLO behält seine Bedeutung.
4. Der System-Kontext wird im Projektprofil nur bei passender Anfrage
   geladen. Ein begrenzter, gecachter Repo-Index (HOME, `PI_REPO_ROOTS`,
   Tiefe 2, kein Voll-Scan) ergänzt benannte Repositories mit Pfad; das eigene
   Projekt wird nie wiederholt. Schreiben in ein fremdes Repository bleibt
   `workspace_add` (eine Freigabe je Repository und Sitzung), weil diese
   Freigabe ausführbaren Projekt-Trust gewährt.

## Verworfen

- **Gemeinsamer Launcher mit Auto-Weiterleitung:** bräuchte die Aufgabe vor
  dem Start oder einen Sitzungswechsel mit verlorenem Verlauf.
- **Gemeinsame TUI, getrennte Ausführung:** zweiter Agenten-Orchestrator mit
  eigenem Zustand; widerspricht der Vorgabe, nichts Neues zu routen.
- **Anbindung über den Pi-System-Host:** ein zweiter Prozess, eine zweite
  Sitzung, Kontextübertragung per Hand; der Host bleibt für QuickPanel und
  Android zuständig.
- **Projekt-Trust im Systemprofil oder umgekehrt:** bleibt getrennt. Weder
  übernimmt `pis` Projekt-Trust, noch erhält `pi` die Scope-freie offene
  Policy.

## Grenzen

- Die Prompt-Erkennung ist eine Wortliste, kein Verständnis; ein
  nicht erkannter Systemwunsch aktiviert die Werkzeuge nicht. Der Nutzer kann
  sie mit einem passenden Wort oder `pis` erreichen.
- Die Shell-Heuristik ist Unfallschutz, keine Sandbox (ADR 034, 036).
- Sitzungsspeicher bleiben getrennt (`~/.pi/agent/sessions/…` für `pi`,
  `profile-state/system/{sessions,host-sessions}` für `pis` und Host).

## Rollback

`git revert` der Commits `29dd8f6`, `efe42f5` und des Hinweis-Commits stellt
den Stand vor dieser Entscheidung wieder her. Für die laufende Installation
liegen die vorherigen Dateien in
`~/.pi/agent/backups/single-entry-20261015/`; zurückkopieren und
`systemctl --user restart pi-system-host`.
