# Pi-Aktivierung am 25.10.2026

Der Nutzer hat die Übernahme nach `~/.pi/agent` und den Hostneustart bei erneut
bestätigtem Leerlauf ausdrücklich freigegeben. Die Installation ist abgeschlossen.
NixOS, GUI und Git-Push waren von der Freigabe ausgenommen und wurden nicht geändert.

## Installierter und laufender Stand

- Verwalteter Codestand: `2f2d6a4`.
- Runtime: Pi 1.3.0 mit geprüftem eingebettetem Undici 8.12.2.
- Bundle-Artefakthash:
  `22ffc42c7815a23b772da1935b3abf4230f01fa177e53c3f7ce80b16345b7e8c`.
- Vorherige Prozesskette: Host 1957, Adapter 1967, Pi-Runtime 1990.
- Neue Prozesskette: Host 56486, Adapter 56498, Pi-Runtime 56529.
- Hosthandshake: Pi 1.3.0, Protokollserver 1.4.0, neuer Host-Epoch.
- Ping erfolgreich, Aktivität `idle`, kein aktiver Run, kein wartender UI-Dialog.

Die Pi-Runtimeprozesse wurden zusätzlich über Prozessnamen und Elternbeziehung
zum bekannten Host identifiziert. `release-state.mjs` allein erkennt bei durch
`process.title` überschriebenen Argumenten nicht jeden Runtimeprozess. Die
Identifikation oben behauptet keinen direkten Hash des geladenen
JavaScriptspeichers. Sie bindet geprüfte Dateien an die danach frisch gestartete
Prozesskette und den beobachteten Handshake.

## Sichere Übernahme

Unmittelbar vor dem Stop wurden Runzustand, Aktivität, offene Nutzerentscheidungen,
Systemjob-Units und zusätzliche eigenständige Pi-CLI-Prozesse geprüft. Die einzige
Pi-Runtime gehörte zum idle Host. Es gab keine aktiven Pi-Systemjobs.

Die betroffenen verwalteten Dateien wurden privat gesichert. Der vorherige
Dependencybaum wurde nach dem Stop unverändert in den Rückweg verschoben; der
vorbereitete geprüfte Baum wurde atomar an seine Stelle gesetzt. Dadurch war kein
neuer Dependencybuild im produktiven Ziel erforderlich. Bestehende Einstellungen
wurden bytegetreu erhalten. Auth-Dateien und Sessions wurden vom Deployment
weder kopiert noch gelöscht oder zurückgesetzt.

Der vorherige Dependencybaum liegt unter:

```text
/home/g/.pi/agent/backups/deployment-2026-10-25T15-38-06.587Z-19979e40/node_modules
```

Die zugehörigen gesicherten verwalteten Dateien, der Rückwegmanifest und private
Prüflogs liegen im Projekt unter
`.agent/runtime-security-2026-10-25/activation-backup-2026-10-25T15-38-06.587Z-19979e40/`.
Die aktivierte Releasequittung ist `~/.pi/agent/release-receipt.json`.
Ein Rückweg darf nur nach erneuter Leerlaufprüfung ausgeführt werden; es wurde
kein unnötiger Rollback auf dem laufenden System provoziert.

## Nachweise nach der Installation

Alle 80 installierten Bundledateien entsprechen dem geprüften Artefakt.
Runtime-Patchprüfung, Launcher-Version, relative Importprüfung und die drei
HTTP-SRI-Proben bestehen am installierten Stand. Die bekannten Launcher-, Host-,
Adapter- und Run-Dateien stimmen laut `release-state.mjs` mit dem Checkout überein.

Ein zusätzlicher echter Modelllauf verwendete den installierten Launcher
`~/.pi/agent/bin/pi` mit dem vollständigen installierten Erweiterungsprofil,
Luna und Thinking `low`. Beide synthetischen Rechenfehler wurden behoben und
geprüft; eine separate Oracle bestand ebenfalls. Unveränderte Testeingaben,
vier Werkzeugaufrufe, keine Nutzerfrage, 11,014 Sekunden. Die aktive
`task-tier.turn`-Telemetrie des Laufs verwendet Schema 3 mit `reads: 2` und
`dupReadsObserved: 0`. Damit ist die neue Telemetrie im tatsächlich installierten
Profil beobachtet, nicht bloß in einem Quelltest.

Die Einstellungen stimmen auch nach diesem Modelllauf mit dem gesicherten
Vorstand überein. Die einzelne Probe beweist keinen allgemeinen Autonomiegewinn
und ersetzt keine vollständige PiSystem-/PIS-Verhaltensmatrix. Die zuvor
beobachteten vorzeitigen Analyseabschlüsse bleiben ein offener Befund.

## Vor der Übernahme gefundener Paketierungsfehler

Die zusätzliche echte Importprüfung im vorbereiteten Installationsziel schlug
zunächst fehl: Der neue Regressionstest importierte
`benchmarks/autonomy/evidence.mjs`, diese Datei fehlte in der Installer-Allowlist.
Das wurde vor jeder produktiven Änderung in `2f2d6a4` korrigiert. Genau die
Hilfsdatei wird jetzt mitgeliefert; Modelltreiber und Benchmark-Rohdaten bleiben
außerhalb der Installation.

Die Greenfield-Regression prüft relative Imports in den Standardverzeichnissen
`extensions`, `scripts`, `shared`, `tests` der tatsächlich erzeugten Zielstruktur.
Sie ist kein vollständiger dynamischer Importnachweis aller Dateien. Alle vier
Installersektionen bestehen mit 112 Assertions, die finale Importprüfung mit
fünf Assertions und der installierte Autonomie-Evidenztest mit fünf Tests. Der
kritische Zwei-Datei-Diff wurde unabhängig lesend mit PASS geprüft.

Maschinenlesbarer, von Auth-/Sessioninhalten freier Nachweis:
[`runtime-activation-2026-10-25.json`](evidence/runtime-activation-2026-10-25.json).
Bauverfahren und dessen Grenzen: [Runtime-Sicherheitsbuild](runtime-security-build.md).

## Zusätzliche Proben der installierten Profile

Je eine weitere reine Analyse wurde über die vollständigen installierten Launcher
`pi` und `pis` ausgeführt: jeweils genau ein erfolgreicher Read, keine mutierende
Werkzeugaktion, keine Nutzerfrage, unveränderte Fixture und eine manuell
kontrollierte korrekte Diagnose beider Rechenfehler. Laufzeiten: 9,343 Sekunden
für `pi`, 13,688 Sekunden für `pis`. Auch diese beiden Läufe zeichnen die neue
Telemetrie mit Schema 3 auf. Sie sind einzelne positive Beobachtungen und heben
die historischen vorzeitigen Abschlüsse in anderen Konfigurationen nicht auf.

## Nachträglicher Audit-Gate-Hotfix

Eine abschließende Registryabfrage lieferte vorübergehend E400 über den veralteten
Quick-Audit-Fallback. Der bisherige Wrapper deutete das Fehler-JSON fälschlich
als leeren Bericht und gab PASS aus. Dieser Prüflauf zählt deshalb nicht als
Sicherheitsnachweis, auch wenn das npm-Skript damals Exit 0 zurückgab.

Commit `1bff5ef` behebt diese Auswertung: Vollständigkeit des v2-Berichts,
konsistente Findings und tatsächliche Advisoryquellen werden geprüft.
Infrastrukturfehler, Signale, Bufferfehler, unerklärte Clean-Berichte bei Exit 1
und quellenlose Referenzzyklen liefern kein Sicherheitsurteil. Reguläre Findings
bei npm-Exit 1 und gültige Referenzzyklen mit Advisoryquelle bleiben auswertbar.
CLI-Fehlertexte geben keine aufgefangenen Prozessdaten aus.

Acht Regressionstestgruppen und drei zusätzliche CLI-Gegenproben bestehen. Die
unabhängige Prüfung hat beide zunächst noch vorhandenen Randfälle beanstandet;
diese wurden vor dem Commit korrigiert und anschließend mit PASS geprüft. Der
erneut gelieferte echte vollständige npm-Bericht enthält null Findings.

Der Hotfix und seine Tests wurden atomar in der genehmigten Installation
übernommen, ohne weiteren Hostneustart. Die Releasequittung führt den
Hoststartstand `2f2d6a4` und den nachfolgenden Stand `1bff5ef` getrennt.
Die fremden Advisory-Ausnahmen im Checkout wurden nicht mitcommittet und nicht
in die Installation übernommen.
