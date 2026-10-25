# Pi/PiSystem: Stabilisierung am 25.10.2026

## Ergebnis und Abnahmegrenze

Die lokale vollständige Pi-Prüfkette besteht, einschließlich eines separaten
sauberen Source-Worktrees auf `a83a30b`. Dieser verwendet die vorhandenen,
aktualisierten npm-Abhängigkeiten per Symlink; ein frisches `npm ci` wurde dabei
nicht ausgeführt. Die spätere Änderung an `docs/verify-profiles.md` wurde separat
mit Prettier und Diffprüfung geprüft. GitHub Actions wurde nicht neu ausgelöst:
der Auftrag erlaubt lokale Commits, aber keinen Push.

M-11 ist im Checkout behoben. PiSystem baut und seine drei Qt-Testprogramme
bestehen. Reale Modellläufe liefern konkrete erfolgreiche Fixture-Ergebnisse und
auch dokumentierte Fehlversuche. Ein allgemeiner Autonomiegewinn und die
Aktivierung der Änderungen auf dem produktiven Host sind nicht nachgewiesen.
Ein Sicherheitsrest im eingebetteten Runtime-Bundle bleibt offen.

## Ausgangszustand

- Pi: `/home/g/Projekte/pi`, `main`, zunächst `330a7f1`.
- PiSystem: `/home/g/Projekte/pisystem`, `main`, `2141df0`, sauber.
- NixOS: `/home/g/nixos-config`, `1a3ef6c`; ausschließlich gelesen. Vorbestehend
  geändert: `README.md`, `docs/systempruefung-2026-10-21.md`, `laptop.nix`.
- Auftragsreferenz: `/home/g/Downloads/Pi_PiSystem_Vereinfachung_Auftragsordner_2026-10-23`.
- Pi hatte sechs fremde Änderungen: zwei Aurora-Dateien, ESLint-Konfiguration,
  zwei Protokoll-Dateien und `scripts/check-npm-audit.mjs`. Ausschließlich die
  beiden reinen Protokoll-Formatkorrekturen wurden nach ausdrücklicher Freigabe
  übernommen. Die anderen vier Änderungen bleiben uncommittet erhalten.
- Jüngster betrachteter GitHub-Lauf: `40099760367` auf `330a7f1`, fehlgeschlagen.
  Die historischen Format-, Coverage- und Auditbefunde wurden bestätigt.

Die Änderungen seit dem 23.10. wurden anhand des tatsächlichen Gitverlaufs
abgeglichen: insbesondere Run-Recovery, Verifikationswartezeit, Hostreservierung,
Release-Diagnose und Session-Health in Pi sowie Transport, Cursorpersistenz,
Refresh-Bündelung und nachfolgende UI-Änderungen in PiSystem. Alte Ergebnistexte
wurden nicht als Ersatz für aktuelle Tests gewertet.

## Reparaturen

1. `e227cd8`: Duplicate-Reads werden in beiden Profilen ausschließlich beobachtet.
   Kein blockierender Read-Zweig und keine profilabhängige Ausnahme mehr.
   Telemetrie-Schema 3 verwendet `dupReadsObserved`; der weiterhin benötigte
   Read-Tracker erkennt Wiederholungen, Änderungen und Resetgrenzen.
2. `0bf88c1`: System-Control-Tests prüfen echten Datei-Readback vor/nach Reparatur,
   Symlink-, Verzeichnis- und Missing-Ablehnung, ungültige Systemziele und den
   echten Fehlerpfad des Prozessadapters. Die Funktionscoverage steigt von
   88,9 % auf 27/27 Funktionen. Keine Grenzwerte geändert; dies ist keine Aussage
   über vollständige Branchcoverage oder einen positiven Live-Systemreadback.
3. `6ec2465`: ausschließlich `undici` 8.11.2 → 8.12.2, `zod` 4.4.3 → 4.6.7 und
   `smol-toml` 1.7.1 → 1.9.1 aktualisiert. `undici` ist über `pi-web-access`
   produktiv und über die Entwicklungs-Runtime erreichbar; `zod` liegt im
   Entwicklungs-/optionalen SDK-Pfad, `smol-toml` ausschließlich unter `knip`.
   Node 22.23.2 erfüllt die Engine-Anforderung von `undici`.
4. `b305b67`: die freigegebenen Prettier-Korrekturen in Protokollschema und
   Contract-Test übernommen, ohne fachliche Änderung.
5. `52ecc68`: `workspace_add` beschreibt ausdrücklich einen Verzeichnispfad.
   Der gemeinsame Arbeitsvertrag unterscheidet Parameterfehler von tatsächlich
   verweigerten Rechten. Regression: falscher Dateipfad erzeugt keinen fiktiven
   Nutzerdialog; ein anschließender gültiger Verzeichnisaufruf erreicht die
   unveränderte Autorisierung. Keine Permission-Entscheidung geändert.
6. `a83a30b`: reproduzierbare echte RPC-Fixtures, unabhängige Ergebnisprüfung,
   fünf Regressionstests für die Evidenzauswertung und anonymisierte Messwerte.
7. `5ee0542`: M-05 teilweise bearbeitet: Dokumentation trennt die verpflichtende
   technische Arbeitsregel von einem automatischen Abschluss-Gate und benennt
   mögliche `npm ci`-/Build-Schreibwirkungen von `project_check` ausdrücklich.

Die unabhängige lesende Prüfung bestätigte die Permission-Textänderung und die
M-11-/Dependency-/Readback-Diffs. Ihre Befunde zur zunächst zu großzügigen
Eval-Auswertung wurden korrigiert und durch Negativtests abgesichert.

## Tatsächlich ausgeführte Prüfungen

| Prüfung                                                                               | Ergebnis                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `npm --prefix npm run verify`                                                         | PASS, komplette Kette bis Audit                          |
| Gleiche Kette im sauberen Source-Worktree `a83a30b`                                   | PASS, ohne die vier fremden Änderungen                   |
| Prettier, ESLint, Typecheck, Knip                                                     | PASS; ESLint hat weiterhin Warnungen, keine Fehler       |
| Gesamte Regression/Integration über Coverage                                          | PASS; `system-control` 27/27, `task-tier` 6/6 Funktionen |
| Workflow-/Permission-Suite                                                            | 1686 Assertions bestanden                                |
| System-Control                                                                        | 14 Tests bestanden                                       |
| Runtime-Patchtests                                                                    | 48 Assertions bestanden                                  |
| Protokoll-/Frontend-Verträge                                                          | 18 Pakettests und 66 Server-/Hosttests bestanden         |
| `p1-runtime.mjs --runtime <Checkout-Runtime>`                                         | PASS; kein Nachweis für bereits geladene Prozesse        |
| `test:benchmark`                                                                      | PASS                                                     |
| Roher `npm audit --json`, auch `--omit=dev`                                           | jeweils 0 Schwachstellen                                 |
| Autonomie-Evidenzregressionen                                                         | 5 Tests bestanden                                        |
| PiSystem: `cmake --build build -j2` und Offscreen-`ctest` in vorhandenem Nix-devShell | 3/3 Testprogramme bestanden                              |
| `git diff --check`                                                                    | PASS                                                     |

Frühe Gesamtläufe scheiterten an der bestätigten Coverage-Lücke. Ein Lauf während
der Quelltextänderung mischte alte und neue Jiti/V8-Funktionsoffsets und meldete
scheinbar abgesunkene Permission-Coverage; dieser Lauf zählt nicht als
Abschlussnachweis. Der abschließende unveränderte Source-Worktree besteht.
Ein anfänglicher ESLint-Fehler im neuen Treiber wurde ebenfalls korrigiert.

Die Codex-Umgebung bietet kein `project_check`-Werkzeug. Die direkte kanonische
npm-Kette aktualisiert daher keinen Pi-Footer und keinen Sitzungsledger.

## Reale Agentenläufe

Details: [`benchmarks/autonomy/README.md`](../benchmarks/autonomy/README.md) und
[`results-2026-10-25.json`](../benchmarks/autonomy/results-2026-10-25.json).
Verwendet wurden Luna mit Thinking `low`, die ESM-CLI `dist/cli.js` des Checkouts,
echte Werkzeuge und synthetische eigene Gitwurzeln. Das produktive gebündelte
CLI, sämtliche installierten Extensions und der produktive Host wurden damit
nicht gemeinsam abgenommen.

Die ausgewählten sechs Abschlussproben bestehen: zwei unabhängige Rechenfehler,
Fortsetzung nach transientem Test-Setupfehler, unabhängige Ergebnisprüfung,
verweigerte zusätzliche Projektfreigabe bei fortgesetzter lokaler Reparatur,
echter Abbruch mit erneutem Prozess und Sessionzustandsprüfung sowie lesende
Analyse mit tatsächlichem Read und Diagnose. Die fünf Reparaturfixtures enthalten
jeweils dieselben zwei künstlichen Fehler, keine zehn verschiedenen Produktbugs.

Für diese sechs ausgewählten Läufe: 65,619 Sekunden, 42.589 frische Inputtokens,
2.057 Outputtokens, 86.912 Cache-Readtokens. Das ist nicht der Gesamtverbrauch
aller Vorproben. Es gab einen erwarteten fehlgeschlagenen Test nach einer
Änderung, eine berechtigte und abgelehnte Nutzerfrage, keine anderen Fragen und
keinen ungeprüften Erfolg innerhalb dieser sechs Proben. Ein fachlich falscher
erster Codepatch wurde damit nicht als erfolgreich repariert nachgewiesen.

Historische Gegenbefunde bleiben erhalten: falscher Dateiparameter wurde als
Nutzerablehnung ausgegeben; mehrere lesende Läufe endeten lediglich mit einer
Arbeitsankündigung. Ein späterer erfolgreicher Analyselauf beseitigt diese
Zuverlässigkeitsgrenze nicht. Die erste Auswertung wertete bloße
Unverändertheit irrtümlich als Analyseerfolg; der Ergebnisbericht korrigiert dies
explizit zu FAIL.

Ein Regeltextvergleich mit `4fd97fd^` besteht ebenfalls bei den beiden
Rechenfehlern. Runtime und Werkzeuge blieben dabei aktuell: kein vollständiger
Software-Vorhervergleich und kein gemessener Gewinn. Ein kleiner Systemprofil-
Smoke besteht; die vollständige produktive PIS-Konfiguration, destruktive
Rückfragen und weitere Wiederholungen sind nicht abgenommen. M-04 bleibt offen.

## Sicherheitsrest im Runtime-Bundle

Der rohe npm-Dependencybaum ist ohne Allowlist sauber. Die fremden neuen
Allowlist-Einträge wurden weder als Behebung gewertet noch mitcommittet.
Das Bundle der gepinnten Runtime enthält jedoch eingebetteten Undici-Code in
`dist/bundle/chunks/chunk-66G7ITPS.js`, SHA-256
`b3654bd51711c6f763c8e41fa3ca790748f3ac5818aebab028b79cdf29cd9b42`.
Dieser wird von einem externen npm-Override nicht ersetzt.

Die isoliert ausgewertete eingebettete Funktion `parseMetadata` akzeptiert
`sha256-AAAA`, verwirft aber `SHA256-AAAA`. Ihre tatsächliche Algorithmusmenge
enthält ausschließlich `sha256`, `sha384`, `sha512`; vor deren Abfrage fehlt die
Normalisierung. Das entspricht dem weiterhin vorhandenen Parserproblem aus
[GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472).
Dies ist eine lokale Funktionsprobe, kein Live-HTTP-Exploit und kein vollständiger
Nachweis zu den anderen eingebetteten Advisories.

Der sichere externe Fix liegt in
[Undici 8.12.2](https://github.com/nodejs/undici/releases/tag/v8.12.2).
Ein Runtimewechsel ist hier kein ungeprüfter Ausweg: das verfügbare
`@earendil-works/pi-coding-agent@1.4.0` deklariert weiterhin `undici: 8.10.2`, und
der bestehende Frontend-Kompatibilitätstest weist Runtime 1.4.0 ausdrücklich ab.
Es braucht ein nachvollziehbar neu gebautes kompatibles Runtime-Artefakt oder
einen gesondert getesteten Upgradepfad. Keine manuelle Minified-Code-Ersetzung
und keine Lockerung des Hostvertrags wurden vorgenommen.

## Installation und aktive Version

Checkout-Runtime und Runtime auf Platte: 1.3.0. Die installierten
`frontend-server/host.mjs`, `index.mjs`, `runs.mjs` unterscheiden sich vom
Checkout. Auch installierte `APPEND_SYSTEM.md`, `task-tier/index.ts` und
`mode-permissions.ts` stimmen nicht mit den neuen Änderungen überein.
M-11 und die Promptverbesserung sind deshalb nicht als produktiv aktiv gemeldet.

Beobachtete Prozesse: Host PID 1957 und Adapter PID 1967, gestartet aus
`/home/g/.pi/agent`. Deren bereits geladene JavaScriptbytes bleiben unbekannt.
Kein laufender GUI-Prozess wurde erkannt. Das installierte PiSystem-Binary liegt
unter `/nix/store/w9zvx0cpghlykmf1g7gkpggc63pc9a44-pisystem-0.2.0`;
sein SHA-256 ist `2bf549d8f06a411adba3897d452214d0030440d1f945aafb326c449456cbd707`.
Der NixOS-Pin nennt `cd5f1b060d0b1694576eb56f767607e498dcaa10`, der GUI-Checkout
steht auf `2141df040c2af56033a032ec9bc61c483f07e814`. Der Pin allein identifiziert
nicht die Bytes eines laufenden Programms.

Keine produktive Installation, Aktivierung, Prozessneustarts oder Migration.
Keine Sessioninhalte, Auth-Dateien oder Prozessumgebungen ausgegeben.

## Abgleich der 28 Maßnahmen

Dies ist eine technische Fortschreibung, keine erneute Liveabnahme aller alten
Maßnahmen. Unveränderte Statusentscheidungen stammen aus dem Auftragsindex.

| ID  | Aktueller Befund / nächste Grenze                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------- |
| 01  | Vorhandene Run-Reparaturauflösung; Hosttests erneut bestanden                                               |
| 02  | Vorhandene Trennung Abschluss/Verifikation; Host- und Qt-Tests bestanden                                    |
| 03  | Offen; keine Permissionhistorie ohne eigene Paritätsprüfung entfernt                                        |
| 04  | Regelkorrekturen und reale Proben vorhanden; wiederholtes Analyseversagen, vollständige Profilabnahme offen |
| 05  | Dokumentationswiderspruch und Installationsnebenwirkungen geklärt; gesamte Maßnahmenabnahme offen           |
| 06  | Reservierungs-/Runtrennung vorhanden; Hosttests bestanden                                                   |
| 07  | Transport ausgelagert; Qt-Contract-/Reconnect-/UI-Programme bestanden                                       |
| 08  | Kein neuer technischer Nutzenbeleg für Prozessfusion; unverändert                                           |
| 09  | Vorhandene Runtime-Patches bestehen; kein unbelegter Abbau                                                  |
| 10  | Fokuspatch unverändert; vorgelagerte Parität offen                                                          |
| 11  | Code/Test PASS in `e227cd8`; produktive Installation offen                                                  |
| 12  | Kein neuer Nutzenbeleg für großen Vertragsumbau; unverändert                                                |
| 13  | Keine Snapshotoptimierung ohne Grenz-/Nutzenbeleg                                                           |
| 14  | Frühere bewusste Nichtumsetzung beibehalten                                                                 |
| 15  | Frühere bewusste Nichtumsetzung beibehalten                                                                 |
| 16  | Refresh-Bündelung vorhanden; Qt-Tests erneut bestanden                                                      |
| 17  | Kein gemessener neuer Renderingengpass; unverändert                                                         |
| 18  | Persistenzbündelung vorhanden; Qt-Tests erneut bestanden                                                    |
| 19  | Frühere bewusste Nichtumsetzung beibehalten                                                                 |
| 20  | Replayconsumer weiterhin ungeklärt; keine Sessionlog-Löschung                                               |
| 21  | Keine neue Theme-Entfernungsprobe; nicht auf Verdacht entfernt                                              |
| 22  | Consumer-Cutover/Liveabnahme fehlt; Legacy nicht entfernt                                                   |
| 23  | Session-Health vorhanden; gesamte Workflow-Suite erneut bestanden                                           |
| 24  | Keine vollständige Live-Modellabnahme; installierter Stand abweichend                                       |
| 25  | Release-Diagnose ausgeführt; geladene Bytes/aktive neue Version weiter unbelegt                             |
| 26  | Optionale Testabhängigkeiten vorhanden; aktueller Testbuild bestanden                                       |
| 27  | Launcherduplikation bestätigt; Session-/Symlinkparität vor Umbau offen                                      |
| 28  | Keine Änderung an Subagentenbudgets ohne vollständige Profilabnahme                                         |

## Unmittelbar nächste Arbeit

1. Kompatibles neu gebautes Runtime-Bundle mit Sicherheitsfixes beschaffen und
   seine eingebetteten Abhängigkeiten zusätzlich zum npm-Audit prüfen.
2. Promise-only-Abschlüsse mit mehreren identischen realen Proben untersuchen;
   fachlich falschen Erstpatch und vollständige PIS-Konfiguration ergänzen.
3. Nur nach gesonderter Freigabe den überprüften Produktstand installieren und
   in einer auftragsfreien Phase starten; danach Datei-/Prozess-/UI-Wirkung prüfen.
4. M-05 abschließend gegen Tooltexte, vorbereitende Schreibwirkungen und
   tatsächliche Berechtigungen abnehmen; weitere Umbauten nach Nutzenbeleg.

Rückweg: eigene Änderungen sind thematisch getrennte lokale Commits und können
gezielt durch neue Revert-Commits zurückgenommen werden. Kein History-Rewrite,
keine fremden Änderungen im Rückweg und kein produktiver Rollout erfolgt.
