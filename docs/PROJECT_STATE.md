# Project State

> Flüchtiger Arbeitszustand (aktuelle Phase, letzte Verifikation, nächste
> Schritte). Dauerhafte Fakten — bestätigte Entscheidungen, Architektur­ent­schei­dungen,
> Nicht-Ziele, Einschränkungen, offene Risiken, Projektregeln — stehen im
> Context Ledger: `docs/CONTEXT_LEDGER.md`. Hier nicht duplizieren, sondern
> referenzieren.

## Aktuelles Ziel

Ein eigenständiges, komfortables und stabiles Pi-Setup mit Aurora-Night-UI,
zentraler Konfiguration, expliziten Berechtigungsgrenzen und einem belastbaren
Plan-/Work-Workflow betreiben. Nicht-Ziele und aktive Entscheidungen: siehe
`docs/CONTEXT_LEDGER.md`.

## Aktuelle Phase

Option 2 mit den Nutzerzusätzen ist implementiert und vollständig verifiziert.
Die Übergabe erfolgt ohne Commit, Push oder Paketinstallation.

## Umgesetzt

- `setup.json` ist die zentrale, validierte Konfiguration für UI, Permissions,
  LSP, Subagenten, Modellrollen und allowlist-basierte Verifikation.
- Aurora Night besitzt Editor, Footer, Activity-Widget und Working-Indikator;
  die Darstellung reagiert auf Terminalbreite und Motion-Modus und räumt alle
  Session-Ressourcen beim Shutdown auf.
- Der Planworkflow verwendet Sidecar v2 mit stabiler `planId`, Revision,
  Lifecycle, Todo-Hash und gebundener `executionId`; Lock/CAS-Schreibvorgänge
  und konservative Migration schützen ältere oder konkurrierende Zustände.
- Plan-, Review-, Decision- und Completion-Ergebnisse werden erst bei
  `agent_settled` finalisiert; Retries zählen nur mit ihrem letzten Ergebnis.
- Planning, Review, Decision, Execution, Paused, Blocked und Ready besitzen
  technisch erzwungene Workflow-Capabilities.
- LSP nutzt eine exakte Tool-Allowlist; `verify` nur die festen Setup-Prüfungen.
- Subagenten laufen mit maximal vier parallelen Tasks und rollenbezogen
  reduzierten Tool-Sets; Testläufe verwenden `verify` statt freien Bash.
- Der Installer ist standardmäßig ein Dry-Run mit Allowlist, schließt Secrets
  und Laufzeitdaten aus und verweigert Symlinks.
- Context Ledger: getrennte, dauerhafte `docs/CONTEXT_LEDGER.md` plus
  deterministische Auto-Konsolidierung (ohne Modell-Turn) an den plan-mode-
  Checkpoints und eine kompakte Recovery-Kopfzeile bei `session_start`.

## Letzte Verifikation

- `npm run verify`: typecheck grün; Testsuite grün bis auf die bekannte
  umgebungsbedingte Baseline (Pfad- und CLI-Versionsdrift außerhalb von
  `~/.pi/agent`).
- `git diff --check`: erfolgreich.

## Bekannte offene Punkte

- P0.4 (Fresh Checkout): Root-`package.json` bleibt unversioniert, ist aber mit
  ALLOWLIST dokumentiert.
- P1.3 (Test-Wartbarkeit): Temp-Cleanup-Hooks wurden noch nicht eingeführt.
- Weitere dauerhafte Einschränkungen/Risiken: siehe `docs/CONTEXT_LEDGER.md`.

## Nächste drei Schritte

1. Benchmark-Aufgabe 11 (Context-Ledger-Survival) real gegen die Baseline laufen
   lassen und Messgrößen 13–15 auswerten.
2. Token-Schwelle des Compaction-Proxys unter realer Last beobachten und ggf.
   justieren.
3. Ledger-Größe bei fortlaufender Nutzung prüfen und veraltete Einträge
   kuratieren, statt den Ledger wachsen zu lassen.

## Letzte Aktualisierung

2026-07-23
