# Behebungsaufträge für den Deep Review von daydaylx/pi

## Grundlage

Diese Arbeitsaufträge leiten sich aus dem unabhängigen Deep Review zum Commit `521b39dc8ce405b829c6be4114d8c9f89a5117b0` ab. Der Review nennt 19 belastbare Findings: fünf P1- und vierzehn P2-Befunde.

Jeder Befund besitzt eine eigene Datei mit Ziel, Regeln, Todos, Tests, Abhängigkeiten, Risiken und eindeutigen Abschlusskriterien.

## Globale Regeln für alle Aufträge

1. **Sicherheitsgarantien zuerst:** Bei Unsicherheit fail-closed entscheiden. Eine grüne Policy-Prüfung allein reicht nicht; der reale Prozess-, Datei- oder Zustands-Effekt muss getestet werden.
2. **Keine stillen Ausnahmen:** Bestehende Ausnahmen müssen explizit dokumentiert und mit einem negativen Test gegen Umgehung abgesichert werden.
3. **Gemeinsame Verträge verwenden:** Plan, Readonly, Recovery, Verifier und Tool-Permissions dürfen dieselbe Fähigkeit nicht mit voneinander abweichenden Listen bewerten.
4. **Keine Status-only-Nachweise:** Ein Hash, ein vorhandenes Verzeichnis oder eine vorhandene Patchdatei gilt nicht als ausreichender Nachweis für Inhalt, Installation oder Wiederherstellbarkeit.
5. **Nachweise an Lauf und Inhalt binden:** Verifier-, Recovery- und Benchmark-Ergebnisse müssen Root, Scope, Ausgangsstand, Generation und Abschlussstatus eindeutig referenzieren.
6. **Portabilität:** Tests müssen auf einem normalen Checkout mit Node 22.23.2 und npm 10.9.8 laufen. Absolute Entwicklerpfade und implizite externe Installationen sind unzulässig.
7. **Keine kostenpflichtigen Modellläufe in Regressionstests:** Provider werden gespied, gemockt oder durch kontrollierte Test-Peers ersetzt. Live-Läufe benötigen einen separaten Auftrag und ausdrückliche Freigabe.
8. **Benchmark-Sperre:** Bis BENCH-001 bis BENCH-003 abgeschlossen sind, keine neuen Ergebnisse als belastbare Vergleichsaussage veröffentlichen.
9. **TUI-Kompatibilität:** Shift+Tab sowie Super+M, Super+D, Super+Q, Super+Y und Super+S behalten ihre Commands und Menüs. Die Prüfung erfolgt über echten Command-Dispatch.
10. **Änderungsdisziplin:** Keine unaufgeforderten Komplett-Refactorings, keine Entfernung bestehender Schutznetze und keine Änderung des geprüften Ausgangsstands ohne dokumentierte Begründung.

## Empfohlene Reihenfolge

### Sofort / P1

1. SEC-001 – Plan-Bash und lokale Ersatzprogramme
2. SEC-002 – kanonische Symlink-Ziele
3. SNAP-001 – Rohinhalts-Fingerprint
4. AGENT-001 – Verifier-Run-Vertrag
5. REC-001 – vollständige Recovery-Mutationssperre
6. TEST-001 – reproduzierbare CI parallel zu den Punkten 1–5

### Danach / P2-Zustands- und Nachweisqualität

7. REC-002, PLAN-001, BUILD-001
8. AGENT-002, AGENT-003
9. GUI-001, GUI-002, LSP-001
10. OPINION-001, OPINION-002

### Benchmark- und Architekturhärtung

11. BENCH-001, BENCH-002, BENCH-003
12. Gemeinsames Capability-Modell, Verifier-Ledger, Runtime-Client und State-Bus erst nach den Verhaltenstests vereinheitlichen.

## Gemeinsame Abschlussbedingung

Ein Auftrag ist erst abgeschlossen, wenn:

- die Ursache behoben ist, nicht nur der konkrete Testfall;
- ein positiver Test das gewünschte Verhalten und ein negativer Test die Umgehung prüft;
- betroffene Integrationspfade ausgeführt wurden;
- relevante Fehlzustände weiterhin sichtbar und nicht als Erfolg geglättet werden;
- die passende CI-Stufe grün ist;
- die TUI-Abschlussbedingung geprüft wurde, falls Permissions, Workflow oder State betroffen sind;
- die Änderung, Testausgaben und verbleibenden Restrisiken im PR dokumentiert sind.

## Befundübersicht

| ID          | Priorität | Bereich                     | Arbeitsauftrag                                                                                                         |
| ----------- | --------: | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| SEC-001     |        P1 | Security / Policy           | Plan-Kommandos und lokale Ersatzprogramme sicher klassifizieren                                                        |
| SEC-002     |        P1 | Security / Pfade            | Lexikalische und kanonische Pfadidentität gemeinsam schützen                                                           |
| SNAP-001    |        P1 | Snapshot / Security         | Rohinhalts-Fingerprints ohne Textconv erzeugen                                                                         |
| AGENT-001   |        P1 | Verifier / Agent            | PASS an Run, Root, Scope und Ausgangsstand binden                                                                      |
| REC-001     |        P1 | Recovery / Security         | Alle mutierenden Fähigkeiten durch Recovery sperren                                                                    |
| REC-002     |        P2 | Recovery / State            | Neuesten gültigen Recovery-Check wiederherstellen                                                                      |
| LSP-001     |        P2 | LSP / Agent                 | Versionslose Diagnosen nach Änderungen entwerten                                                                       |
| GUI-001     |        P2 | GUI / Bridge                | Bridge beim normalen Electron-Start aktivieren — [zurückgestellt](spaeter-relevant/08-GUI-001-bridge-standardstart.md) |
| GUI-002     |        P2 | GUI / Process               | Stop- und Abort-Cleanup idempotent machen — [zurückgestellt](spaeter-relevant/09-GUI-002-idempotent-stop.md)           |
| AGENT-002   |        P2 | Verifier / Async            | Async-Verifier-Ergebnisse korrekt verbuchen oder sperren                                                               |
| AGENT-003   |        P2 | Verifier / Budget           | Timeout-Aliase kanonisieren und Mindestbudget schützen                                                                 |
| BENCH-001   |        P2 | Benchmark / Network         | Egress-Allowlist tatsächlich erzwingen                                                                                 |
| BENCH-002   |        P2 | Benchmark / Integrity       | Binärpatches vollständig und wiederanwendbar sichern                                                                   |
| BENCH-003   |        P2 | Benchmark / Comparability   | Unbekannte Baselines nicht als vergleichbar freigeben                                                                  |
| TEST-001    |        P2 | CI / Build                  | CI, Tests und Benchmark-Grenzen portabel ausführbar machen                                                             |
| OPINION-001 |        P2 | Second Opinion              | Effektive Modellidentität statt Labels prüfen                                                                          |
| OPINION-002 |        P2 | Second Opinion              | Abgebrochene Anfragen vor dem Modellcall stoppen                                                                       |
| PLAN-001    |        P2 | Plan / Persistence          | Pläne atomar und crashsicher persistieren                                                                              |
| BUILD-001   |        P2 | Dependencies / Verification | Installationszustand an Lockfile und Umgebung binden                                                                   |
