# Sicherheitsneubau der Pi-Runtime 1.3.0

Der vorbereitete Neubau behebt den bestätigten SRI-Fehler im eingebetteten
Undici, ohne auf eine vom Host nicht unterstützte Runtime-Linie zu wechseln.
Er ersetzt keine installierte Runtime und startet keine Dienste neu.

```sh
npm --prefix npm run build:runtime-security
node scripts/rebuild-runtime-bundle.mjs --output .agent/my-new-runtime-build
node scripts/check-bundled-runtime.mjs --runtime .agent/my-new-runtime-build/packages/coding-agent
```

Voraussetzungen sind die vorhandenen gesperrten npm-Abhängigkeiten, das ausdrücklich
genehmigte `esbuild@0.28.2`, Node 22.23.2 und `tar`. Ein unbekanntes/esbuild-falsches
Buildwerkzeug wird nicht automatisch installiert. Der erste Lauf lädt bekannte
Eingaben; weitere Läufe verwenden den integritätsgeprüften Cache unter
`.agent/runtime-build-cache`.

## Eingaben und Grenzen

`scripts/runtime-build-inputs.json` pinnt den Upstreamcommit
`71023aec1546d6d677a65669c5665c0927ce0dd0` und die SHA-256-Werte des
[offiziellen Buildskripts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/scripts/build-coding-agent-bundle.mjs)
und seiner OAuth-Quellenliste. Die sieben originalen Workspace-Pakete werden aus
den in `npm/package-lock.json` festgehaltenen npm-Artefakten extrahiert. Ihre
Integritäten werden vor der Extraktion geprüft. Es wird aus veröffentlichtem
JavaScript gebündelt, kein vollständiger TypeScript-Quellbuild behauptet.

Die Buildoptionen des offiziellen Skripts bleiben erhalten. Eine zusätzliche
Zeile speichert dessen bereits vorhandene esbuild-Metafiles. Die Abhängigkeiten
stammen aus dem gesperrten installierten Baum. Dessen tatsächlich verwendete
Dateien werden gehasht und ihre Pfade auf die deklarierte Staging-/Dependencywurzel
begrenzt; die gesamten installierten Paketinhalte werden nicht erneut gegen
npm-Tarballs verifiziert.

Die Metafiles müssen tatsächliche Eingaben aus `undici@8.12.2` belegen.
`zod@4.6.7` bleibt im Lockfile erforderlich; in den beobachteten Bundlegraphen
wird Zod nicht eingebettet. Sollte es eingebettet werden, muss auch dessen
Version dem Pin entsprechen. Ein leerer oder unbekannter Undici-Eingabenachweis
ist ein Fehler. Der externe npm-Audit ersetzt diese Prüfung nicht.

Builds schreiben nur in eine neue `.agent`-Wurzel. Vorhandene Ziele,
Symlinkkomponenten, falsche Checksummen und während des Builds geänderte
Pipelinequellen beziehungsweise Lockfiles werden abgewiesen. Fehlgeschlagene
Stagingverzeichnisse bleiben zur Untersuchung erhalten; ein Erfolgsbeleg wird
erst nach allen Prüfungen angelegt.

## Prüfungen und Beleg

Nach dem Bundeln werden die vorhandenen zehn Runtime-Patches unverändert auf die
Staging-Runtime angewendet und mit `tests/p1-runtime.mjs` kontrolliert. Der
SRI-Test kopiert das Bundle vorübergehend, ergänzt ausschließlich in dieser Kopie
einen diagnostischen Export des eingebetteten Undici-Moduls und fragt einen
lokalen HTTP-Server ab:

- Falscher Digest mit `sha256` muss abgelehnt werden.
- Falscher Digest mit `SHA256` muss ebenfalls abgelehnt werden.
- Passender Digest mit `SHA256` muss als positive Kontrolle funktionieren.

Das ursprüngliche Bundle akzeptiert die zweite Probe fehlerhaft. Im Neubau
bestehen alle drei Proben. Es wird weder ein fremder Server angesprochen noch
ein produktiver Agentenauftrag erzeugt. Diese Probe belegt die konkrete
SRI-Regression, keine vollständige Sicherheitsabnahme aller Funktionen.

`build-receipt.json` enthält Eingabehashes, gesperrte Paketquellen, die verwendeten
Pipelinequellen, Ausgabehashes und Prüfergebnisse. `artifactSha256` ist ausdrücklich
**der Hash der Bundleausgaben samt Launcher**. Er identifiziert weder die gesamte
extrahierte Runtime noch ihre Ressourcen, ungebündelten Patchdateien oder
externen/native Abhängigkeiten. Die separaten Quellen- und Lockfilehashes müssen
mit betrachtet werden. Ein Receipt identifiziert keine bereits geladenen Bytes.

Die Vergleichsprobe vom 25.10.2026 belegt identische 80 Ausgabehashes für drei
frische Verzeichnisse auf derselben Maschine mit demselben Abhängigkeitsbaum
und gleicher Verzeichnistiefe. Pfadunabhängige oder plattformübergreifende
Byteidentität wird damit nicht behauptet.

`npm --prefix npm run verify` enthält den Sicherheitsbuild. GitHub Actions führt
`build:runtime-security` zusätzlich als eigenes Matrix-Gate aus. Sieben
Negativregressionen prüfen Integrität, Ziel-/Symlinkgrenzen, tatsächliche
Dependencyeingaben, fehlende/mehrdeutige Module und kanonische Dependencywurzeln
bei geteilten Worktree-Abhängigkeiten.

## Befund am 25.10.2026

Code: `1c0e011`, `35c4785`, `455d865`. Die vollständige Verify-Kette besteht im
Arbeitsbaum und im sauberen Source-Worktree `455d865`; dort werden die vorhandenen
aktualisierten Dependencies geteilt. Ein frisches `npm ci` wurde in diesem
Worktree nicht ausgeführt. GitHub wurde mangels Pushfreigabe nicht neu gestartet.

Der Bundle-Artefakthash lautet
`22ffc42c7815a23b772da1935b3abf4230f01fa177e53c3f7ce80b16345b7e8c`.
Der Beleg erfasst 3360 Build-Eingabedateien und 80 Ausgabedateien. Eine unabhängige
lesende Prüfung hat sämtliche Ausgabehashes, den Aggregathash, den
Runtime-Vertrag und die Guardtests nachvollzogen.

Ein tatsächlicher Luna-`low`-Lauf über `dist/bundle/cli.js` behob beide synthetischen
Rechenfehler und prüfte sie anschließend; eine separate Oracle bestand ebenfalls.
Vier Werkzeugaufrufe, keine Nutzerfrage, 7,466 Sekunden. Diese einzelne Probe ist
keine vollständige PIS-/GUI-Abnahme und kein statistischer Autonomiegewinn.
Maschinenlesbare, ausschließlich synthetische Nachweise:
[`runtime-security-2026-10-25.json`](evidence/runtime-security-2026-10-25.json).

## Vorbereitete Installation

Das vollständige lokale Installationspaket liegt unter
`.agent/runtime-security-2026-10-25/deployment-payload`. Es enthält 436 verwaltete
Setup-Dateien aus dem sauberen Source-Worktree und eine lokale Kopie des geprüften
Dependencybaums mit dem neuen Bundle. Alle 80 Bundlehashes wurden darin erneut
verglichen. Launcher-Version, Runtime-Patchprüfung und Protokollbuild bestehen.
Der Installer wurde außerdem rein lesend gegen das produktive Ziel geplant.

Das ist eine lokale Vorbereitung, keine produktive Installation. Der zuletzt
beobachtete produktive Host war idle, ohne aktiven Run, wartenden UI-Dialog oder
aktive Pi-Job-Unit. Diese Beobachtung muss unmittelbar vor einer genehmigten
Installation erneuert werden.

Nach ausdrücklicher Freigabe: Rückfallkopie der betroffenen verwalteten Dateien
und des alten Dependencybaums sichern; erst bei bestätigtem Leerlauf den Host
stoppen, den vorbereiteten Stand übernehmen und seine Hashes/Verträge prüfen.
Bestehende Einstellungen, Auth-Daten und Sessions erhalten. Danach den Host
starten und Handshake/Zustand unabhängig kontrollieren. Bei Fehlern den
vorherigen Stand wiederherstellen. Kein NixOS-Switch, kein GUI-Austausch und kein
Push sind Bestandteil dieser geplanten Aktivierung.

Die konkreten lokalen Belege und der Plan liegen unter
`.agent/runtime-security-2026-10-25/`; produktive Dateien und Prozesse sind noch
unverändert.

## Nachfolgende ausdrücklich genehmigte Aktivierung

Der vorbereitete Stand wurde anschließend mit gesichertem Rückweg nach
`~/.pi/agent` übernommen. Der Host wurde nur nach erneut bestätigtem Leerlauf
ersetzt und sein neuer Prozess unabhängig geprüft. Der vorangehende Abschnitt
beschreibt den damaligen Vorbereitungsstand. Aktueller Nachweis und
Installationskorrektur `2f2d6a4`: [Aktivierung](runtime-activation-2026-10-25.md).
