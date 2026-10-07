# Globale Agent-Regeln

Diese Regeln gelten für Pi-Sitzungen und werden von anderen Coding-Agenten sinngemäß befolgt; Verweise auf Pi-eigene Tools (`ask_user`, `plan_write`, `project_check`, `recovery_check`, `subagent`, `verify`) gelten für sie nicht. Seltene Arbeitsabläufe stehen in [docs/agent-workflow.md](docs/agent-workflow.md), Session-Checkpoints im Skill `context-checkpoint`, Subagenten- und Verifier-Verträge in [docs/subagents.md](docs/subagents.md), Prüfprofile in [docs/verify-profiles.md](docs/verify-profiles.md) und CLI/TUI-Scope in [docs/scope-cli-tui-vs-gui.md](docs/scope-cli-tui-vs-gui.md). Relative Pfade unter `extensions/` und `agents/` bezeichnen das Pi-Setup.

## Schutz und Umfang

- Nur den konkreten Auftrag umsetzen. Bestehende, nicht dazugehörige Nutzeränderungen erhalten; keine breiten Refactorings oder Formatierungen ohne Anlass.
- Secrets, Zugangsdaten, Auth-Dateien, Umgebungsvariablen und SSH-Schlüssel weder offenlegen noch in Reports oder Versionskontrolle übernehmen.
- Projektabhängigkeiten und Systempakete nur nach ausdrücklicher Zustimmung installieren oder hinzufügen.
- Schreibzugriffe bleiben auf das Projekt beschränkt. Setup-, Skill- und externe Ressourcen dürfen in vertrauenswürdigen Projekten nur lesend und ohne Secrets eingesehen werden.
- Vor Shell-Aktionen Schreibziel, Variablenquotierung und Credential-Grenzen prüfen. Eine Schutzblockade nicht mit einer Variantenstrategie umgehen: Ursache bestimmen und zulässige lokale Alternative nutzen. Wiederholt sich dieselbe Blockade, nicht weiterprobieren; Pi nutzt `ask_user` für die konkrete Blockade.
- Eine einzelne blockierte Datei oder Ressource beendet nicht die ganze Aufgabe. Ohne sie weiterarbeiten, sofern keine echte Sackgasse besteht.
- Den aktiven Permission- und Workflow-Modus respektieren. Planfreigabe und Moduswechsel sind UI-Aktionen; eine Sperre nie über alternative Schreibwege umgehen.
- Keine Commits, Pushes, Merges, Veröffentlichungen oder Deployments ohne ausdrücklichen Auftrag.

## Arbeitsweise und Qualität

- Zuerst relevante Projektanweisungen, Implementierung und Prüfungen gezielt lokalisieren. Änderungen klein halten und nach jedem Teilpaket den engsten passenden Check ausführen.
- Fehler, nicht ausführbare Prüfungen und offene Unsicherheit ausdrücklich nennen. Eine Änderung erst als umgesetzt bezeichnen, wenn ihr relevanter Testlauf beendet ist.
- `extensions/task-tier/` stuft Aufgaben automatisch ein; NORMAL ist der Default. FAST bleibt auf kleine, risikoarme Aufgaben beschränkt und wird bei echter Komplexität hochgestuft. Die Kriterien stehen in [docs/decisions/033-task-tiers.md](docs/decisions/033-task-tiers.md).
- Sind Akzeptanzkriterien erfüllt, der passende Check erfolgreich und keine Unsicherheit offen, endet die Aufgabe. Weitere Reads, Tests oder Refactorings brauchen einen Anlass; ausdrückliche Nutzerwünsche haben Vorrang.
- Dauerhafte Projektregeln gehören hierher, ausführliche Referenzen in `docs/`. `docs/PROJECT_STATE.md` und `docs/CONTEXT_LEDGER.md` werden ausschließlich über den Skill `context-checkpoint` gepflegt.

## Verifikation

- Relevante Tests und statische Prüfungen gehören zum Abschluss; Ergebnisse knapp dokumentieren.
- Pi: Für das deklarierte Pflichtprofil ist `project_check({ profile: "verify" })` der kanonische Nachweis. Die ausführliche Verifikationsregel steht in [docs/agent-workflow.md](docs/agent-workflow.md). Das Tool `verify` prüft nur das Pi-Setup unter `~/.pi/agent`.
- Sicherheits-/Permission-Grenzen, kritische Plan-/Recovery-Zustände, öffentliche Verträge und gelistete Hard-Pfade folgen dem technischen Verifier-Need-Gate. Eine explizite Nutzeranforderung ist ebenfalls verbindlich. Keine Risiken durch Umgehung oder Selbsteinstufung herabsetzen; Details stehen in [docs/subagents.md](docs/subagents.md).

## Delegation und Scope

- Keine festen Agentenrollen oder permanenten Teams. Triviale Arbeit selbst erledigen; temporäre Delegation nur nach den Kriterien und Grenzen in [docs/subagents.md](docs/subagents.md).
- Dieses Repository umfasst Pi-Core-Konfiguration und Aurora-TUI. Externe Frontends liegen außerhalb; bei einem reinen TUI-Auftrag bleibt die Bridge außen vor, sofern sie nicht ausdrücklich genannt ist. Zuordnung: [docs/scope-cli-tui-vs-gui.md](docs/scope-cli-tui-vs-gui.md).
- Webrecherche nur bei echtem Aktualitätsbedarf oder wenn lokale Belege nicht reichen. Den sicheren Such- und Fetch-Ablauf beschreibt [docs/agent-workflow.md](docs/agent-workflow.md).
