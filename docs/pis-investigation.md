# Eigenständige PIS-Untersuchungen

Prüfstand: 21.10.2026, Ausgangscommit `a6aee70`, lokale und installierte
Pi-Runtime 1.3.0. Die bei Auftragsbeginn bereits geänderte
`npm/package.json` hebt den versionierten Pin 1.2.0 auf 1.3.0 an; diese und
alle anderen fremden Änderungen wurden erhalten und nicht mitcommittet.

## Bestätigte Ursachen und Grenzen der Analyse

- Beide Systemlauncher (`bin/pi system` für TUI und `bin/pi-system-runtime`
  für den Host) setzen `--no-context-files`. Der tatsächliche Resource-Loader
  unterdrückt dadurch globale und lokale `AGENTS.md`/`CLAUDE.md`, einschließlich
  Elternverzeichnissen. Die darin enthaltenen Arbeits- und Abschlussregeln
  erreichen PIS daher nicht über diesen Weg.
- `APPEND_SYSTEM.md` wird unabhängig davon geladen, enthält bisher aber nur
  Kommunikationsregeln. Native Skills werden über `resources_discover`
  angeboten und erst bei Bedarf gelesen. Die beiden Diagnose-Skills enthielten
  überwiegend Schutzregeln, keinen ausreichenden Untersuchungsauftrag.
- `system-context` injizierte einen überholten Zugriffshinweis: angebliche
  Scope-Anforderungen auf einzelnen Stufen und Host-Bestätigungen widersprechen
  dem inzwischen dauerhaft offenen Systemprofil. Der Hinweis wurde ersetzt.
  Dass genau dieser Hinweis den beobachteten Abschluss verursachte, ist nicht
  bewiesen.
- In der lokalen TUI-Sitzung vom 21.10.2026, Beginn 21:06 UTC, beantwortete
  `gpt-6-luna` die Anschlussfrage nach fehlerhaften Einstellungen ohne einen
  Toolaufruf. Die Abschlussantwort nannte selbst noch ungeprüfte Quellen
  (`laptop.nix`, WLAN-/udev-Regeln, Agent-Statuscode und Journal). Erst die
  folgende Aufforderung „du sollst das prüfen“ löste Werkzeugaufrufe aus.
  Im betreffenden Turn ist kein Toolfehler oder technischer Abbruch erkennbar.
- Im vorherigen Turn wurde `git_dirty=16` aus „Last build rec.“ zunächst als
  aktueller Änderungsstand dargestellt, obwohl ein Git-Aufruf einen sauberen
  Arbeitsbaum meldete. Weitere Prüfungen korrigierten die Darstellung. Der
  Befund belegt eine falsche zeitliche Einordnung, keinen Defekt des Statuscodes.
- Task-Tier zählt Aufrufe und Tokens; sein Duplicate-Read-Guard gilt nicht für
  PIS. Resilience protokolliert Fehler/Unterbrechungen. Aurora projiziert
  Lifecycle-Ereignisse; Setup-Core berechnet technische Verifikationsstände.
  In den geprüften Pfaden fand sich kein erzwungener vorzeitiger Abschluss.
  `verified` bezeichnet ausdrücklich Prüfprofil-Abdeckung und kein erreichtes
  Nutzerziel. Ein Build deckte in der Fehlersitzung nur eines von sechs
  Pflichtprofilen ab.

Die Ursache ist damit als Kontextlücke plus beobachtete Modellentscheidung
belegt, nicht als deterministischer Lifecycle-Bug. Ein einzelner Sitzungslog
beweist keine allgemeine Modellschwäche. Keine umfassende Historienprüfung
oder erneute Live-Untersuchung der NixOS-Konfiguration wurde durchgeführt.

Vor den Änderungen waren die geprüften installierten Launcher,
`APPEND_SYSTEM.md`, `system-context`, Diagnose-Skills und `mode-permissions.ts`
mit dem Checkout identisch. `settings.json` wich ab; daraus wird keine Ursache
abgeleitet. Die wirksame Runtime wurde lokal anhand ihres Loaders und
Hook-Dispatchers geprüft, nicht aus einer entfernten Dokumentation vermutet.

## Umsetzung

- `extensions/system-context/index.ts`: kurzer, modellunabhängiger
  System-Arbeitsvertrag im vorhandenen `before_agent_start`, bei jeder Anfrage
  einschließlich Anschlussfragen und Custom-Nachrichten. Untersuchung,
  autorisierte Umsetzung, gezielte Rückfragen, Alternativen, Effizienz und vier
  Abschlusskategorien sind enthalten. Der Projektmodus erhält ihn nicht.
- `extensions/system-context/skills/{nixos-system,system-health}/SKILL.md`:
  priorisierte Diagnose, heutige Gültigkeit alter Berichte, Vergleich von
  Konfiguration und Laufzustand, belegte Einschränkungen, Nachkontrolle und
  Trennung von Build-Record, Quellstand und laufender Generation.
- `tests/system-context.test.mjs`: tatsächlicher Runtime-Loader und
  ExtensionRunner prüfen Prompt, Kontextausschluss, native Skill-Erkennung,
  genau eine Vertragsinstanz je Lauf und Projektparität für TUI/RPC.
- `tests/system-investigation.test.mjs` und `tests/fixtures/system-investigation/`:
  reproduzierbare A–F-Fälle, automatisierte Contract-Tests sowie optionaler
  echter Modelllauf. `tests/run-all.mjs` führt die Contract-Tests regulär aus.
- `docs/pi-system-profile.md`: dokumentierter Ladeweg und Verhaltensgrenzen.

Launcher, Berechtigungslogik und Lifecycle wurden nicht geändert. Es gibt keine
zusätzliche Completion-Engine, keinen Continuation-Hook, keine neuen
Abhängigkeiten und keinen Installations- oder Aktivierungsschritt. Die
installierten Dateien unter `~/.pi/agent` wurden nicht synchronisiert:
Schreibzugriffe außerhalb des Repositories waren nicht Teil dieses Auftrags.
Der neue wirksame Prompt wurde mit den Repository-Extensions getestet.

## Reproduktion und Modellvergleich

```bash
node tests/system-context.test.mjs
node tests/system-investigation.test.mjs
node tests/system-investigation.test.mjs --live gpt-6-luna /tmp/luna.json
node tests/system-investigation.test.mjs --live gpt-6.1-sol /tmp/sol.json
```

Der Live-Harness nutzt das vorhandene SDK und vorhandene Provider-Anmeldedaten
nur über einen Speicher im Prozess. Refreshes verändern keine Auth-Datei.
Es sind ausschließlich feste Fixture-Quellen, ein auf native Skills begrenzter
Reader und eine protokollierende, wirkungslose Aktivierungsattrappe verfügbar.
Test B enthält echte vorbereitete Sitzungsnachrichten. `bindExtensions`
initialisiert den nativen Skill-Katalog vor der Inferenz. Kein Modell erhält
hier Shell- oder echte Systemänderungswerkzeuge. Testbudgets begrenzen nur den
Eval, nicht produktive PIS-Aufträge.

[Aufgezeichnete Ergebnisse](../benchmarks/behavior/system-investigation/results-2026-10-21.json)
enthalten sämtliche finalen Antworten, Quellenaufrufe, Skill-Lektüren,
Modellzähler und die SHA-256-Werte von Fixture und Systemkontext. Die
Contract-Tests prüfen Fixtures, Auswertung und Skill-Anforderungen ohne Inferenz;
die Live-Läufe verwenden echte Modelle, Thinking `high`, je einen Lauf pro Fall.

| Finaler Lauf | A–F | Diagnoseabfragen | Skill-Lektüren | Modellaufrufe | Input | Cache-Read | Output |
| ------------ | --- | ---------------: | -------------: | ------------: | ----: | ---------: | -----: |
| GPT-6 Luna   | 6/6 |               17 |              4 |            15 | 17808 |      11136 |   2336 |
| GPT-6.1 Sol  | 6/6 |               17 |              6 |            16 | 20640 |      12416 |   1917 |

Die Zähler sind unveränderte Provider-Usage-Felder; Cache-Write war jeweils null.
Provider-Caching und die Stichprobengröße erlauben kein belastbares Kosten-
oder Qualitätsranking. Beide lasen in A–C/E/F die relevanten Quellen, trennten
in A den belegten Supplicant-Neustart vom Powersave-Verdacht und erkannten C
als historischen Build-Wert. E blieb korrekt eingeschränkt; F löste keine
Aktivierung aus. D enthielt keine Diagnoseabfrage: Luna las einen Skill,
Sol antwortete direkt. Alle zwölf Antworten wurden zusätzlich inhaltlich
gelesen; Quellabdeckung und Textmuster allein beweisen keine Befundqualität.

In einem explorativen Zwischenlauf fragte Luna bei D eine nicht verfügbare
Quelle ab. Daraufhin wurde die Regel für bekannte einzelne Optionsbedeutungen
präzisiert. Frühere Harness-Läufe ohne vollständig initialisierten nativen
Skill-Katalog werden nicht als finaler Vergleich gewertet. Es gibt keinen
kontrollierten Vorher-/Nachher-Modellvergleich mit dem ursprünglichen Prompt;
der reale Fehlturn und die finalen Fixture-Läufe sind unterschiedliche Kontexte.

## Weitere Prüfungen und Abnahmegrenzen

Erfolgreich: gezielte Systemkontext- und A–F-Tests, Typecheck, Formatprüfung,
Lint der geänderten Code-Dateien (keine Fehler; Security-Hinweise), Knip,
48 Runtime-Patch-Tests, 10 Host-Tests sowie Protokoll-/Serverprüfungen außerhalb
des fehlgeschlagenen Handshakes. Die getrennt ausgeführten weiteren Suiten
bestehen bis auf den Workflow-Block: darunter UI, LSP, 440 Permission-Assertions,
Verifier-Gates/-Tickets, Task-Tier, Launcher-Profil, System-Control und
OpenRouter-Doctor. Keine Berechtigungserweiterung für `pi` wurde implementiert.

Die Gesamtabnahme ist ausdrücklich **nicht vollständig grün**:

- `npm --prefix npm run verify` stoppt nach erfolgreicher Formatprüfung am
  Linter: 81 Fehler. Eine isolierte Prüfung von `benchmark-rohdaten/` ergibt
  dieselben 81 Fehler in ignorierten lokalen Benchmark-Artefakten. Diese
  Dateien wurden nicht bearbeitet. Spätere Verify-Stufen laufen dadurch nicht
  automatisch; Typecheck, Knip und Patchtests wurden separat nachgeholt.
  Coverage und der echte npm-Audit-Lauf wurden nicht nachgeholt.
- Der Runtime-Block meldet 1821 erfolgreiche und fünf fehlgeschlagene
  Assertions. Eine isolierte Kopie von `a6aee70` mit derselben Toolchain meldet
  1822 erfolgreiche und vier fehlgeschlagene Assertions: dieselben
  Filesystem-Snapshot-/Coverage-Bridge-Probleme. Der zusätzliche aktuelle
  Setup-Doctor-Fehler erwartet fest `1.2.0`, während die bereits zu Beginn
  geänderte Manifestdatei `1.3.0` enthält.
- Der Workflow-Block meldet aktuell 1655 erfolgreiche und drei fehlgeschlagene
  Assertions (Git-Gate außerhalb Git und zusätzliche Workspace-Wurzel).
  Auf der isolierten Ausgangsbaseline besteht er mit 1666 Assertions.
  Die betroffenen Implementierungen und Tests wurden hier nicht geändert;
  die Abweichung zwischen den Umgebungen ist nicht abschließend geklärt und
  wird nicht als nachgewiesener Vorbestand ausgegeben.
- Der Handshake-Test erwartet eine Versionsmeldung ohne `1.3.x`, während der
  Ausgangscommit diese Version bereits unterstützt. Nach dem Assertionfehler
  bleibt ein Kindprozess offen. Die Baseline nach Protokoll-Build zeigt
  denselben Versionsfehler; ein begrenzter Lauf endet am Timeout. Der getrennte
  aktuelle Host-Test besteht mit 10/10.
- Erste Sandbox-Läufe scheiterten zusätzlich an Netzwerk-/Git-/Socket-Grenzen.
  Modelltests und relevante Prozessprüfungen wurden mit Freigabe wiederholt;
  fehlgeschlagene oder abgebrochene Läufe zählen nicht als Erfolg.

Es wurde keine NixOS-Konfiguration verändert, gebaut oder aktiviert. Die
Modelltests prüfen begrenzte Fixtures, keinen vollständigen Live-Systemaudit.
Promptregeln verbessern das Verhalten, garantieren aber nicht den Abschluss
beliebiger künftiger Aufgaben. Die erfolgreichen repräsentativen Modellläufe
liefern keinen Anlass für einen zusätzlichen programmgesteuerten Hook.

Implementierungscommits: `3878c44` (Arbeitsvertrag), `5bf164d`
(Diagnose-Skills), `ba8cdee` (Regressionen und Effizienzpräzisierung).
