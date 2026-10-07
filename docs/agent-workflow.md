# Seltene Agent-Abläufe

Die globalen Vorgaben stehen in `AGENTS.md`. Diese Referenz enthält Abläufe,
die nur bei bestimmten Aufgaben relevant sind. Die technischen Grenzen in
Extensions und Policies bleiben maßgeblich.

## Recherche und Dateiarbeit

- Suche Code und Dateien gezielt mit `rg` bzw. den verfügbaren Suchwerkzeugen.
  Lies nur den relevanten Bereich und bestätige Pfade, bevor du sie änderst.
- Lies den Zielbereich unmittelbar vor einer Änderung frisch. Nach einem
  fehlgeschlagenen Read, Pfadzugriff oder Patch-Kontext lies den tatsächlichen
  Zustand neu, statt den Versuch blind zu variieren.
- Teile größere Änderungen in kleine Schritte. Führe zuerst den engsten
  betroffenen Test aus. Starte Tests im Paketverzeichnis, das CI verwendet.
- Weise vorbestehende Fehler nur mit einer belegten Ausgangsbaseline als
  solche aus.
- Begrenze Logs und große JSON-Ausgaben. Vor vollständigen Diffs zuerst
  `git diff --stat`, dann nur die betroffenen Dateien lesen. Markiere sichtbar,
  wenn eine Ausgabe gekürzt ist.
- Pi: `!!command` nur verwenden, wenn die Nutzerin oder der Nutzer die Ausgabe
  sehen soll, der Agent sie aber nicht weiter auswerten muss.
- Nach einer Recovery-Sperre einmal den vorgesehenen Recovery-Check ausführen;
  eine Sperre nicht mit einem anderen Schreibweg umgehen.
- Im Planmodus nur die für diesen Modus freigegebenen Leseaktionen ausführen.
  Bash-Aufrufe dort einzeln und einfach halten; keine Verkettungen,
  Umleitungen oder Prozesssubstitutionen. Die durchsetzbare Policy ist
  maßgeblich.

## Verifikation

- Pi: Das deklarierte Pflichtprofil wird für den Abschluss mit
  `project_check({ profile: "verify" })` ausgeführt. Nur dieser Aufruf
  aktualisiert Verifikations-Footer und -Ledger. Ein direkter Lauf von
  `npm run verify` dient dem Debugging und ersetzt ihn nicht. Das Pi-Setup-Tool
  `verify` prüft ausschließlich `~/.pi/agent`.
- FAST: gezielter Test und passende Syntax-/Typprüfung; kein globales Verify
  ohne Anlass. Bei NORMAL/DEEP die relevante Suite und betroffene
  Subsystem-Prüfungen verwenden.
- Einen vollständigen Testlauf nicht ohne Änderung am geprüften Stand
  wiederholen. Nach dem gezielten Test nur noch fehlende Pflichtnachweise
  ergänzen.
- Ein Verifier-Ergebnis `FAIL`, `INCOMPLETE` oder `UNVERIFIABLE` bleibt ein
  Befund. Vor Commit oder Push beheben und erneut prüfen oder den offenen Punkt
  ausdrücklich benennen.
- Profile, Trust-Gates und Statusbedeutungen stehen in
  `docs/verify-profiles.md`; Verifier-Need-Gate und Übergabevertrag in
  `docs/subagents.md`.

## Planmodus

- Ein expliziter Umsetzungsauftrag im Planmodus hebt die Modussperre nicht auf.
  Den Wechsel muss die Nutzerin oder der Nutzer in der UI vornehmen.
- Planfreigabe und Wechsel nach Work sind getrennte Aktionen. Den Plan nur über
  `plan_write` persistieren; keine alternative Schreibroute verwenden.
- Details: ADR `docs/decisions/020-explicit-plan-approval.md`.

## Git-Veröffentlichung

Commit, Push, Merge, Branch-Veröffentlichung und Deployment nur ausführen, wenn
die Nutzerin oder der Nutzer es ausdrücklich beauftragt hat. Commit und Push
sind getrennte Schritte. Vor einem Commit mit verifier-pflichtigem Diff muss
der erforderliche Verifier-Nachweis für denselben Workspace-Fingerprint
vorliegen. Nach einem Push-Fehler lokalen Commit- und Upstream-Status prüfen;
höchstens einen gezielten Retry durchführen.

## Webrecherche

Websuche nur, wenn Aktualität, externe Dokumentation oder ein lokal nicht
prüfbares Verhalten sie erfordert. Zuerst gezielt suchen, danach nur relevante
HTTP(S)-Quellen öffnen. Keine lokalen Pfade, Auth-Daten oder Repository-Klones
an Fetch-Werkzeuge übergeben. Lokale Repository-Fragen zuerst lokal klären.

## Sitzungsfortsetzung

Für bewusste Checkpoints und die Pflege von `docs/PROJECT_STATE.md` sowie
`docs/CONTEXT_LEDGER.md` ausschließlich den Skill `context-checkpoint`
verwenden. Keine automatische Projektdatei pro Compaction erzeugen.

## Verhaltensvergleich für P2

Die folgenden typischen Aufgaben wurden regelweise gegen die vorherige
globale Fassung verglichen. „Ergebnis“ nennt die erwartete Verhaltensparität,
nicht einen automatisierten Modell-Eval.

| Typische Aufgabe | Vorher | Jetzt | Ergebnis |
| --- | --- | --- | --- |
| Tippfehler in einer Dokumentation | FAST-Grenzen und Stop-Regel direkt in `AGENTS.md` | Task-Tier bleibt global beschrieben; Kriterien in ADR 033 | FAST und gezielter Check bleiben erhalten |
| Kleine TUI-Textänderung | TUI/Bridge-Ausschluss direkt in `AGENTS.md` | Globaler Scope-Hinweis mit Verweis auf `docs/scope-cli-tui-vs-gui.md` | Bridge bleibt bei TUI-Auftrag außen vor |
| Lokaler Bugfix mit Regressionstest | kleine Schritte und Baseline-Regel in `AGENTS.md` | dieselben Regeln in `docs/agent-workflow.md` | zuerst engster Test; keine unbelegte Baseline |
| Permission- oder Recovery-Änderung | Hard-Pfade und Verifier-Gate ausführlich global | globale Schutzregel plus `docs/subagents.md` und technische Policy | kein Risiko durch Dokumentenverschiebung freigegeben |
| Öffentliche API-/IPC-Änderung | Need-Gate/Verifier-Trigger global erklärt | globaler Boundary-Hinweis plus `docs/subagents.md` | Hard-Pfad und Need-Gate bleiben maßgeblich |
| Plan während Planmodus umsetzen | UI-Wechsel und Planfreigabe ausführlich global | kurzer globaler Modusschutz, Detail in Workflow-Referenz und ADR 020 | keine Umgehung der Modussperre |
| Commit und Push | expliziter Auftrag und Verifier-Regeln global | expliziter Auftrag global, Ablauf in Workflow-Referenz | kein Commit ohne Auftrag; Schritte getrennt |
| Aktuelle externe Provider- oder API-Frage | Bedingung, Such-/Fetch-Reihenfolge global | kurze globale Bedingung, Ablauf in Workflow-Referenz | lokale Fragen bleiben lokal; externe Quellen gezielt |
| Lange Sitzung oder Compaction | Checkpoint-Regel global, Skillbeschreibung nannte auch jede Analyse | seltene Auslöser im Skill; globaler Verweis | kein Routine-Checkpoint und kein automatisches Ledger |
| Unbekannter Bug mit möglicher unabhängiger Analyse | Delegationskriterien und Limits global | globaler Nicht-Rollen-Hinweis plus `docs/subagents.md` | temporäre Delegation nach Nutzen und Grenzen |

Diese Matrix ist eine Verhaltensprüfung, kein zusätzlicher Workflow und keine
Ausnahme von Nutzeranweisungen.

### Umfangsmessung

| Text | Vorher | Nachher |
| --- | ---: | ---: |
| `AGENTS.md` | 265 Zeilen, 16.103 UTF-8-Bytes, 1.826 Wörter | 34 Zeilen, 4.533 UTF-8-Bytes, 481 Wörter |
| Beschreibung von `context-checkpoint` | 340 UTF-8-Bytes | 251 UTF-8-Bytes |

Damit sinkt `AGENTS.md` um 71,9 % Bytes und 73,7 % Wörter; die Skill-
Beschreibung um 26,2 % Bytes. Als reproduzierbare Token-Näherung gilt
`ceil(UTF-8-Bytes / 4)`: etwa 4.026 auf 1.134 Tokens für `AGENTS.md` und 85
auf 63 für die Skill-Beschreibung. Das ist kein modellgenauer Tokenizer.

Die übrigen elf Skill-Beschreibungen wurden geprüft und blieben unverändert:
ihre Aktivierung ist auf die jeweilige Aufgabe beschränkt und sie versprechen
keine zusätzlichen Rechte.
