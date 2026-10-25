# Reale Autonomieproben

```sh
node benchmarks/autonomy/run.mjs
node benchmarks/autonomy/run.mjs --scenario permission --output .agent/autonomy-permission-new
node benchmarks/autonomy/run.mjs --profile system --scenario multiple
node benchmarks/autonomy/run.mjs --baseline-ref '4fd97fd^' --scenario multiple
```

Voraussetzungen: vorhandene Projektabhängigkeiten und funktionierender
Providerzugriff der Pi-Runtime. Es wird nichts installiert. Die Läufe verwenden
`openai-codex/gpt-6-luna` mit Thinking `low`, echtes RPC und echte Dateiwerkzeuge.
Es werden nur `mode-permissions` und `task-tier` explizit aus dem Checkout geladen,
dazu `APPEND_SYSTEM.md` und isolierte Fixture-Regeln. Dies ist eine gezielte
Harnessprobe, keine vollständige Abnahme der installierten Pi-/PIS-Konfiguration.
`--baseline-ref` tauscht ausschließlich den gemeinsamen Regeltext aus; Runtime,
Werkzeuge und Fixture bleiben aktuell. Ein Vergleich vollständiger Softwarestände
wird damit nicht behauptet.

Die sechs Szenarien prüfen mehrere Fehler, Fortsetzung nach einem transienten
Testfehler, unabhängige Verifikation, verweigerte zusätzliche Projektfreigabe,
Abbruch mit echter Sessionwiederaufnahme und eine ausschließlich lesende Analyse.
Das Retry-Szenario erzwingt einen einmaligen Test-Setupfehler nach der Änderung.
Es beweist keine Korrektur eines fachlich falschen ersten Codepatches.
Das Permission-Szenario erwartet das Projektprofil; im offenen Systemprofil ist
eine zusätzliche Projektfreigabe nicht erforderlich.

Jede Fixture enthält zwei defekte Rechenfunktionen, eine unveränderliche Prüfung
und eigene Projektanweisungen. Eine zusätzliche Gitwurzel enthält das externe
Ziel für den Permission-Test. Der Treiber verweigert sämtliche UI-Freigaben.
Nach Abschluss prüft ein eigener Nodeprozess die exportierten Funktionen. Der
Verzeichnisvergleich erkennt Änderungen auch an Anweisungen und neuen Dateien.
Ein erfolgreicher Agententest zählt nur bei passendem finalem Quelltexthash.
Resume verlangt einen erneuten erfolgreichen Dateiread im zweiten Prozess.
Die Analyse muss die Datei lesen und die beiden Fehler benennen; reine
Unverändertheit oder eine Arbeitsankündigung reichen nicht.

`results.json` enthält Befunde, Werkzeugfehler, Rückfragen, Tokenverbrauch und
Laufzeit. `events.json` und Sessions enthalten ausschließlich synthetisches
Testmaterial und bleiben unter `.agent/` außerhalb der Versionskontrolle.
Ein vorhandenes Ausgabeverzeichnis wird nicht überschrieben. Die Fixtures sind
logisch isoliert, keine Betriebssystem-Sandbox; keine fremden oder produktiven
Arbeitsaufträge als Testeingabe verwenden.

Die Analyseauswertung nutzt begrenzte Textmerkmale, die Verifikationsauswertung
erkennt genau `node check.cjs` beziehungsweise `node ./check.cjs`. Gleichwertige
andere Prüfwege können deshalb als nicht belegt erscheinen. Abschlusstexte müssen
zusätzlich am Transkript geprüft werden. Die fünf Regressionstests in
`tests/autonomy-evidence.test.mjs` schützen gegen nachgewiesene falsche
Positivbewertungen; sie ersetzen keine Modellläufe.

Die Beobachtungen vom 25.10.2026 stehen in `results-2026-10-25.json` und
`docs/stabilisierung-2026-10-25.md`. Einzelne erfolgreiche Läufe belegen das
jeweilige Fixture-Ergebnis, keinen statistisch nachgewiesenen Autonomiegewinn.
Insbesondere gab es auch vorzeitige Abschlüsse des Analyseauftrags.
