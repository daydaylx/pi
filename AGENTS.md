# Globale Agent-Regeln

Diese Regeln gelten für Pi-Sitzungen und werden von anderen Coding-Agenten sinngemäß befolgt; Verweise auf Pi-eigene Tools (`ask_user`, `project_check`, `subagent`, `verify`) gelten für sie nicht. Seltene Arbeitsabläufe stehen in [docs/agent-workflow.md](docs/agent-workflow.md), Session-Checkpoints im Skill `context-checkpoint`, Subagenten- und Verifier-Verträge in [docs/subagents.md](docs/subagents.md), Prüfprofile in [docs/verify-profiles.md](docs/verify-profiles.md) und CLI/TUI-Scope in [docs/scope-cli-tui-vs-gui.md](docs/scope-cli-tui-vs-gui.md). Relative Pfade unter `extensions/` und `agents/` bezeichnen das Pi-Setup.

## Schutz und Umfang

- Nur den konkreten Auftrag umsetzen. Bestehende, nicht dazugehörige Nutzeränderungen erhalten; keine breiten Refactorings oder Formatierungen ohne Anlass.
- Secrets, Zugangsdaten, Auth-Dateien, Umgebungsvariablen und SSH-Schlüssel weder offenlegen noch in Reports oder Versionskontrolle übernehmen.
- Projektabhängigkeiten und Systempakete nur nach ausdrücklicher Zustimmung installieren oder hinzufügen.
- Schreibzugriffe bleiben auf das Projekt beschränkt. Setup-, Skill- und externe Ressourcen dürfen in vertrauenswürdigen Projekten nur lesend und ohne Secrets eingesehen werden.
- Vor Shell-Aktionen Schreibziel, Variablenquotierung und Credential-Grenzen prüfen. Eine Schutzblockade nicht mit einer Variantenstrategie umgehen: Ursache bestimmen und zulässige lokale Alternative nutzen. Wiederholt sich dieselbe Blockade, nicht weiterprobieren: Blockade und Ursache melden; braucht der Fortgang eine Nutzerentscheidung (etwa die Freigabe einer Projektwurzel), nutzt Pi dafür `ask_user`.
- Eine einzelne blockierte Datei oder Ressource beendet nicht die ganze Aufgabe. Ohne sie weiterarbeiten, sofern keine echte Sackgasse besteht.
- Im Projektprofil `pi` die aktive Permission-Stufe respektieren. Im Systemprofil `pis` gilt dauerhaft Vollzugriff; dort blockieren Pi-eigene Permission- und Tool-Guards keine Befehle oder Werkzeuge.
- Commits und Pushes brauchen keine Einzelfreigabe: nach jedem abgeschlossenen Teilschritt sofort in kleinen, thematisch getrennten Commits festhalten und direkt pushen. Nur eigene Dateien gezielt stagen (nie `git add -A`), fremde Änderungen nicht mitcommitten, Fehlschlagendes nicht committen. Kein Force-Push und kein Umschreiben gepushter Commits. Technische Gates (Verifier-Gate vor Commit) bleiben unberührt.
- Merges, Veröffentlichungen und Deployments nur mit ausdrücklichem Auftrag.

## Arbeitsweise und Qualität

- `AGENTS.md`/`CLAUDE.md` von Projekt und Elternverzeichnissen sind bereits im Kontext geladen; nicht per `find`/`rg` danach suchen. Zuerst Implementierung und Prüfungen gezielt lokalisieren. Änderungen klein halten und nach jedem Teilpaket den engsten passenden Check ausführen.
- Fehler, nicht ausführbare Prüfungen und offene Unsicherheit ausdrücklich nennen. Eine Änderung erst als umgesetzt bezeichnen, wenn ihr relevanter Testlauf beendet ist.
- Reibung vermeiden: Soll die Aufgabe eine Toolchain ausführen (Build, Test, SDK), zuerst per `command -v`/`test -x` prüfen und Fehlendes sofort melden, statt vorher Statusdateien zu lesen. Status- und Handoff-Dateien (`TASKS.md`, `CURRENT_STATUS.md` u. ä.) nur für Implementierungsaufgaben lesen, nicht für reine Git-Aufgaben. Prüfkommandos nicht blind starten, wenn Abhängigkeiten fehlen (`node_modules`, SDK).
- `ask_user` nur für echte Entscheidungen. Optionen vorher gegen die eigene Schreib- und Rechtegrenze prüfen und nichts anbieten, was der aktive Modus verbietet oder das nicht existiert. Soll nach einer Prüfung umgesetzt werden und gibt es mehrere gleichwertige Korrekturen (aktualisieren oder kennzeichnen, löschen oder behalten), per `ask_user` kurz bestätigen lassen, statt die eigene Empfehlung zu wählen.
- Sind Akzeptanzkriterien erfüllt, der passende Check erfolgreich und keine Unsicherheit offen, endet die Aufgabe. Weitere Reads, Tests oder Refactorings brauchen einen Anlass; ausdrückliche Nutzerwünsche haben Vorrang. Ein solcher Anlass ist die Herkunftsprüfung vor dem Ändern von Zahlen und Messwerten in Dokumenten: erst `git log` oder `git blame`.
- Dauerhafte Projektregeln gehören hierher, ausführliche Referenzen in `docs/`. `docs/PROJECT_STATE.md` und `docs/CONTEXT_LEDGER.md` werden ausschließlich über den Skill `context-checkpoint` gepflegt.

## Verifikation

- Relevante Tests und statische Prüfungen gehören zum Abschluss; Ergebnisse knapp dokumentieren.
- Pi: Für das deklarierte Pflichtprofil ist `project_check({ profile: "verify" })` der kanonische Nachweis. Die ausführliche Verifikationsregel steht in [docs/agent-workflow.md](docs/agent-workflow.md). Das Tool `verify` prüft nur das Pi-Setup unter `~/.pi/agent`.
- Sicherheits-/Permission-Grenzen, kritische Recovery-Zustände, öffentliche Verträge und gelistete Hard-Pfade folgen dem technischen Verifier-Need-Gate. Eine explizite Nutzeranforderung ist ebenfalls verbindlich. Keine Risiken durch Umgehung oder Selbsteinstufung herabsetzen; Details stehen in [docs/subagents.md](docs/subagents.md).

## Delegation und Scope

- Keine festen Agentenrollen oder permanenten Teams. Triviale Arbeit selbst erledigen; temporäre Delegation nur nach den Kriterien und Grenzen in [docs/subagents.md](docs/subagents.md). Verlangt der Nutzer ausdrücklich Subagenten oder parallele Arbeit, diese nutzen oder in einem Satz begründen, warum nicht.
- Dieses Repository umfasst Pi-Core-Konfiguration und Aurora-TUI. Externe Frontends liegen außerhalb; bei einem reinen TUI-Auftrag bleibt die Bridge außen vor, sofern sie nicht ausdrücklich genannt ist. Zuordnung: [docs/scope-cli-tui-vs-gui.md](docs/scope-cli-tui-vs-gui.md).
- Webrecherche nur bei echtem Aktualitätsbedarf oder wenn lokale Belege nicht reichen. Den sicheren Such- und Fetch-Ablauf beschreibt [docs/agent-workflow.md](docs/agent-workflow.md).
