# P5 — Observer-Baseline und Entscheidung

## Status

Abgeschlossen als **No-Go**: kein Observer-Code und keine Änderung am
Need-Gated Verifier. Die verfügbaren Daten belegen keinen inkrementellen
Observer-Nutzen; die P5-Stop-Regel verhindert daher einen zusätzlichen
Review-Call ohne messbare Grundlage.

## Baseline

Aus `~/.pi/agent/run-history.jsonl` wurden nur aggregierte Einträge mit
`agent=verifier` und `cwd` gleich dem Pi-Projekt oder darunter ausgewertet.
Der erfasste Zeitraum reicht vom 27.09.2026 bis 07.10.2026. Einzelne
Tasknamen, Prompts oder Session-Inhalte wurden nicht in diesen Bericht
übernommen.

| Messgröße               |                                  Beobachtung |
| ----------------------- | -------------------------------------------: |
| Verifier-Aufrufe        |                              12 über 9 Tasks |
| Verarbeitete Tokens     |       4.307.790 gesamt; Ø 358.983 pro Aufruf |
| Dauer                   | 1.986.317 ms gesamt; Ø 165.526 ms pro Aufruf |
| Kosten laut Run-History |       0,123376 gesamt; Ø 0,010282 pro Aufruf |
| Run-Status              |                            5 `ok`, 7 `error` |
| Gate-Entscheidung       |          9 `required`, 3 nicht protokolliert |
| Trigger                 |         9 `hard_path`, 3 nicht protokolliert |
| Observer-Aufrufe        |                                            0 |

Tokens sind die Summe aus `input`, `cacheRead`, `cacheWrite` und `output`.
`error` bezeichnet den protokollierten Ausführungsstatus, nicht ein fachliches
Verifier-FAIL. Die Run-History selbst enthält weder Findings noch Schweregrad
oder False-Positive-Markierung. Die verknüpften Sitzungsprotokolle liefern
jedoch für einen Teil der Aufrufe vollständige Abschlussmeldungen. Aus ihnen
lassen sich sieben fachliche Verdicts rekonstruieren: drei `FAIL` und vier
`PASS_WITH_WARNINGS`. Die übrigen Aufrufe bleiben anhand der verfügbaren
Abschlussmeldungen `INCOMPLETE` oder ohne zuordenbares fachliches Verdict.

### Rekonstruierte Review-Ausgänge

Die Zahlen stammen aus sieben vollständigen Abschlussmeldungen, die anhand
ihrer lokalen Verifier-Artefakte einzeln klassifiziert wurden. Wiederholte
Reviews derselben Änderung sind getrennte Beobachtungen und keine unabhängigen
Fehlerfälle. Der Run-History-Status wurde nicht als fachliches Verdict
interpretiert.

| Ergebnisgruppe | Anzahl | Beobachtung |
| -------------- | -----: | ----------- |
| Fachliche Verdicts | 7 | 3 `FAIL`, 4 `PASS_WITH_WARNINGS` |
| Blocker | 3 | Ein verwaister CI-Testaufruf nach GUI-Entfernung und zwei Planmodus-Shell-Bypässe, gefunden in zwei Reviews derselben Permission-Änderung. |
| Weitere Code-/Scope-Hinweise | 3 | Veraltete GUI-Suppressions, ein verbliebener GUI-Benchmark-Harness und ein alter GUI-Arbeitspunkt im Plan. |
| Umgebungs-/Nachweiswarnungen | 2 | `python3` bzw. Pi-Runtime-Erkennung fehlten im jeweiligen `PATH`; daraus wurde kein Patchfehler abgeleitet. |
| Observer-Funde | nicht messbar | Es gab keinen Observer-Lauf als Vergleichsarm. |

| Anonyme Zeile | lokales Verifier-Artefakt | Verdict | Findings im Abschlussbericht |
| ------------- | ------------------------- | ------- | ---------------------------- |
| R1 | `.pi-subagents/artifacts/30a053cb_verifier_0_output.md` | `FAIL` | CI ruft entferntes `test:gui` auf (Blocker); verwaiste ESLint-Suppressions (Warnung). |
| R2 | `.pi-subagents/artifacts/228b8ba2_verifier_0_output.md` | `PASS_WITH_WARNINGS` | GUI-Benchmark-Harness verblieben (Warnung). |
| R3 | `.pi-subagents/artifacts/69058321_verifier_0_output.md` | `PASS_WITH_WARNINGS` | Veralteter GUI/RPC-Arbeitspunkt im Plan (Warnung). |
| R4 | `.pi-subagents/artifacts/26067e78_verifier_0_output.md` | `FAIL` | `eval`-/`env`-Konstrukte umgehen den Planmodus-Mutationsguard (Blocker). |
| R5 | `.pi-subagents/artifacts/e1de9416_verifier_0_output.md` | `FAIL` | Prozesssubstitution umgeht den Planmodus-Mutationsguard (Blocker). |
| R6 | `.pi-subagents/artifacts/387da72b_verifier_0_output.md` | `PASS_WITH_WARNINGS` | Automatische Pi-Runtime-Erkennung im `PATH` hier nicht geprüft (Nachweiswarnung). |
| R7 | `.pi-subagents/artifacts/f8087266_verifier_0_output.md` | `PASS_WITH_WARNINGS` | Benchmark-Test durch fehlendes `python3` im `PATH` nicht ausführbar (Umgebungswarnung). |

Die sieben Zeilen sind die vollständig rekonstruierbaren Ergebnisberichte; die
anderen fünf Run-History-Aufrufe bleiben ohne zuordenbares fachliches Verdict.
Die lokale Run-History-Auswertung filterte `agent=verifier` und ein `cwd` im
Projektbaum, summierte `input`, `cacheRead`, `cacheWrite`, `output`, `duration`
und `cost` und gruppierte nach `task`. Die sieben Resultatzeilen wurden danach
manuell anhand der oben referenzierten Abschlussartefakte erfasst. Die
Artefakte enthalten im Original mehr Kontext als diese anonymisierte Tabelle
und sind deshalb nicht in die Berichtsdatei kopiert.

Die Sitzungsprotokolle belegen damit drei konkrete Blocker. Die zwei
Planmodus-Blocker sind keine zwei unabhängigen Defekte: Der zweite Review
erweiterte den belegten Bypass um Prozesssubstitution.

Eine False-Positive-Rate lässt sich weiterhin nicht berechnen. Die
Ergebnisprotokolle halten weder eine systematische Nutzer-Adjudikation noch
die spätere Behebung oder Zurückweisung jedes einzelnen Hinweises fest.
`PASS_WITH_WARNINGS` ist ein Verdict und keine Kennzeichnung, dass sämtliche
Warnungen korrekt oder falsch waren. Daher werden die rekonstruierbaren
Findings nicht als bestätigte True Positives ausgegeben.

Ein weiterer Befund aus
`benchmarks/real-duel/reports/plan-work-pilot-stufe1.md` dokumentiert bei einer
kleinen Utility zwei abgelehnte Verifier-Aufträge und einen erfolgreichen
Retry. Die formale Prüfung lief danach erfolgreich; der Bericht weist für die
Aufgabe keinen Pflicht-Risikotrigger aus. Das sind Contract-/Retry-Kosten,
aber kein Beleg, dass ein zusätzlicher Reviewer einen Codefehler gefunden
hätte.

Die Benchmarkberichte `real-01-tui-warm-theme.md` und
`real-02-gui-ux-redesign.md` enthalten unabhängige Blind-Reviews und zusätzliche
Befunde, aber keine gepaarte Gegenüberstellung mit einem separaten Observer
unter denselben Eingaben. Sie sind keine valide Observer-Nutzenmessung.

## Entscheidung

Die gemessenen Verifier-Kosten und mehrere konkrete Verifier-Funde sind
belegt. Der inkrementelle Wert eines zusätzlichen Observers und die Doppelarbeit
mit dem Verifier bleiben aber nicht messbar: Es gibt keine gepaarte
Observer-Stichprobe und keine Adjudikation der einzelnen Hinweise. P5 bleibt
deshalb ein No-Go für Code oder Runtime-Konfiguration.

Der formale Verifier bleibt unverändert die unabhängige Prüfung. Es wurden
weder Trigger noch Berechtigungen oder Agent-Profile ergänzt.

## Kriterien für eine spätere Wiederaufnahme

Eine neue Messrunde braucht vor Implementierung eine feste Stichprobe mit
repräsentativen Hard-Path- und Nicht-Hard-Path-Diffs. Observer und formaler
Verifier erhalten jeweils nur Diff, Akzeptanzkriterien, Testzusammenfassung und
betroffene Pfade. Eine verblindete Bewertung trennt danach:

- einzigartige, umsetzbare Fehlerfunde;
- vom Verifier bereits gefundene Punkte (Doppelarbeit);
- unbelegte oder falsche Hinweise;
- zusätzliche Tokens, Laufzeit und fehlgeschlagene Calls.

Nur ein belegter zusätzlicher Fehlerfund bei vertretbaren Zusatzkosten
rechtfertigt einen erneuten PoC. Ein künftiger Observer müsste außerdem
read-only, triggerbasiert, ohne eigene Delegation oder Mutationswerkzeuge
bleiben und dürfte keine Autorität über den Hauptagenten erhalten.
