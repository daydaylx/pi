# Project State

## Aktuelles Ziel

Ein eigenständiges, komfortables und stabiles Pi-Setup mit Aurora-Night-UI,
zentraler Konfiguration, expliziten Berechtigungsgrenzen und einem belastbaren
Plan-/Work-Workflow betreiben.

## Aktuelle Phase

Option 2 mit den Nutzerzusätzen ist implementiert und vollständig verifiziert.
Die Übergabe erfolgt ohne Commit, Push oder Paketinstallation.

## Umgesetzt

- `setup.json` ist die zentrale, validierte Konfiguration für UI, Permissions,
  LSP, Subagenten, Modellrollen und allowlist-basierte Verifikation.
- Aurora Night besitzt Editor, Footer, Activity-Widget und Working-Indikator.
  Die Darstellung reagiert auf Terminalbreite und Motion-Modus und räumt alle
  Session-Ressourcen beim Shutdown auf.
- Der Planworkflow verwendet einen atomaren, versionierten Sidecar und das Tool
  `plan_progress`; Markdown-Checkboxen bleiben lesbare Source of Truth und alte
  Fortschrittsmarker funktionieren weiterhin als Fallback.
- Freier Bash-Zugriff und unbekannte Tools fragen standardmäßig nach. LSP,
  `ask_user`, `plan_progress` und `verify` besitzen kleine explizite
  Capability-Grenzen; LSP nutzt eine exakte Tool-Allowlist und `verify` nur
  die festen Setup-Prüfungen aus dem Agent-Verzeichnis.
- LSP übernimmt zentrale Defaults, behält vertrauensabhängige Projektkonfiguration
  bei und meldet seinen Zustand an Aurora.
- Subagenten laufen mit maximal vier parallelen Tasks und rollenbezogen
  reduzierten Tool-Sets; Testläufe verwenden `verify` statt freien Bash.
- Der Installer ist standardmäßig ein Dry-Run, kopiert nur eine Allowlist,
  schließt Secrets und Laufzeitdaten aus und verweigert Symlinks in Quelle und
  Zielpfad. npm-Manifeste, TypeScript-Konfiguration und Tests werden für eine
  funktionsfähige Greenfield-Verifikation mit ausgeliefert.
- TypeScript läuft strikt; CI und lokale Befehle verwenden dieselbe
  `typecheck`-/`test`-/`verify`-Fassade.
- Plan-, LSP- und Aurora-Provider setzen Session-Overrides zurück und entfernen
  ihre Eventbus-Listener beim Shutdown bzw. Sessionersatz.

## Aktive Entscheidungen

- Gewählt: Aurora Night mit kontextueller Bewegung. `reduced` und `off` bleiben
  über `setup.json` verfügbar.
- Gewählt: `read-write` als Startstufe, aber freie Shell und unbekannte Tools
  standardmäßig nur nach Bestätigung.
- Gewählt: frischer Subagenten-Kontext und maximale Parallelität vier.
- Gewählt: drei kuratierte OpenAI-Codex-Modellrollen (`fast`, `primary`, `deep`).
- Gewählt: alte UI-/Renderer-Dateien bleiben inaktiv erhalten, damit Rückbau
  und Vergleich ohne Datenverlust möglich sind.
- Nicht ausgeführt: Commit, Push, Veröffentlichung oder Abhängigkeitsupdate.

## Bekannte offene Punkte

- Die aktive Pi CLI ist `0.80.7`, Manifest und lokales Dev-Paket sind `0.80.6`.
  `/setup-doctor` weist diese Abweichung als Fehler aus. Eine Angleichung wartet
  auf ausdrückliche Freigabe für die Abhängigkeitsänderung.
- Ein echter Provider-/Authentifizierungsdurchlauf wurde bewusst nicht gestartet
  und `auth.json` nicht gelesen. Theme, Lifecycle, Toolregistrierung und UI-
  Breakpoints sind im Harness geprüft.
- In der eingeschränkten Sandbox schließt der verschachtelte Fake-LSP-Prozess
  sein stdin und erzeugt 26 umgebungsbedingte Fehler. Außerhalb dieser Grenze
  besteht dieselbe Suite vollständig.

## Letzte Verifikation

- `npm run verify`: 439 bestanden, 0 fehlgeschlagen.
- `npm run typecheck`: erfolgreich mit `strict: true`.
- `git diff --check`: erfolgreich.
- Pi CLI `0.80.7`, Node `22.22.2`, npm `10.9.7` festgestellt.
- Installer-Dry-Run und Source-equals-Target-No-op geprüft.

## Nächste sinnvolle Schritte

1. Pi-CLI und Dev-Pin nach ausdrücklicher Zustimmung auf dieselbe Version setzen.
2. Aurora in einer echten authentifizierten TUI-Sitzung visuell abnehmen.
3. Erst danach inaktive Legacy-UI-Pakete und Konfigurationen separat bereinigen.

## Letzte Aktualisierung

2026-07-16 06:20 CEST
