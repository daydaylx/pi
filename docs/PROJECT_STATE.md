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
- Der Planworkflow verwendet Sidecar v2 mit stabiler `planId`, Revision,
  Lifecycle, Todo-Hash und gebundener `executionId`; Lock/CAS-Schreibvorgänge
  und konservative Migration schützen ältere oder konkurrierende Zustände.
  Markdown-Checkboxen bleiben lesbare Source of Truth und alte
  Fortschrittsmarker funktionieren weiterhin als Fallback.
- Gespeicherte Ausführungen werden ausschließlich als `paused` geladen und
  brauchen in `/work` eine explizite Resume-Bestätigung. Decision Briefs werden
  nur bei passender, im Workflow gespeicherter Hash-Verknüpfung übernommen.
- Planning, Review, Decision, Execution, Paused, Blocked und Ready besitzen
  technisch erzwungene Workflow-Capabilities; die jeweilige Phase begrenzt
  Lesen, Rückfragen, Verifikation und Fortschrittsmeldungen unabhängig von der
  globalen Berechtigungsstufe.
- Unbekannte Tools fragen in Read+Write, Full und YOLO immer nach und sind in
  strengeren Stufen blockiert; Setup bleibt absolut gesperrt. LSP,
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
- Gewählt: `read-write` als Startstufe; unbekannte Tools bleiben auch in Full
  und YOLO bestätigungspflichtig, in strengeren Stufen blockiert und in Setup
  absolut gesperrt.
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

## Umgesetzt

- P0.1: `containsExternalPath` in permission-policy.ts erweitert: Optionswerte mit `=` werden jetzt als Pfade geprüft
- P0.1: Regressionstests für `diff --from-file=/etc/passwd` und ähnliche Muster hinzugefügt
- P0.2: LSP-Tools: `toAbsolute` prüft nun absolute Pfade auf Projektzugehörigkeit
- P0.2: Symlink- und Größenprüfung (10 MB Limit) in `openOrSync` (documents.ts) eingeführt
- P0.3: Test-Assertion für Modellvertrag angepasst: Rollen müssen Teilmenge von enabledModels sein
- P0.3: settings.json defaultModel auf `openai-codex/gpt-5.4` gesetzt (primary Rolle)
- P1.1: Single-Flight-Promise (`pendingAcquire`) in registry.ts implementiert
- P1.1: `remove()` ruft nun `shutdownEntry()` auf für ordnungsgemäßen Prozessabbau
- P1.2: Boolean-/Integer-Validierung in `mergeConfig` durch Typ-Prüfungen ersetzt (fail-closed)
- P1.2: Argumentlimit (max 12) in `resolveProfileOverrides` implementiert

## Bekannte offene Punkte

- P0.4 (Fresh Checkout): Root-package.json bleibt unversioniert, ist aber mit ALLOWLIST dokumentiert
- P1.3 (Test-Wartbarkeit): Temp-Cleanup-Hooks wurden noch nicht eingeführt (da nicht kritisch für aktuelle Tests)

## Letzte Aktualisierung

2026-07-16 06:20 CEST
