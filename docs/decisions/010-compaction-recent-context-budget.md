# 010 — Recent-Context-Budget bleibt bei 12 KiB

## Kontext

Issue #118 sollte prüfen, ob `compaction.keepRecentTokens` von 12.000 auf
20.000 erhöht werden soll. Der Wert beeinflusst ausschließlich den nach einer
Compaction erneut eingespeisten jüngsten Kontext; er ist keine allgemeine
Kontextfenster-Erhöhung.

## Protokoll

Der Vergleich verwendet die vier aufeinanderfolgenden Anweisungen aus
Benchmark-Aufgabe 08 in jeweils getrennten temporären Arbeitskopien und
Session-Dateien. Vorgesehen waren dieselben vier Varianten mit hohem Denken:

| Modell                      | 12.000           | 20.000           |
| --------------------------- | ---------------- | ---------------- |
| `openai-codex/gpt-5.4-mini` | ausgeführt       | nicht ausgeführt |
| `openai-codex/gpt-5.6-sol`  | nicht ausgeführt | nicht ausgeführt |

Ein Kandidat darf nur übernommen werden, wenn alle vier Etappen samt
Regressionstest abgeschlossen sind, die Verifikation grün ist, keine
Overflow-/Retry-Schleife auftritt und die Compaction-Messung keine schlechtere
Stabilität zeigt.

## Ergebnis

Der ausgeführte Baseline-Lauf (`gpt-5.4-mini`, 12.000) endete nicht erfolgreich:
14 Assistant-Turns, 152.146 Gesamt-Tokens und keine persistierte Compaction;
der letzte Session-Eintrag war ein offener Tool-Aufruf. Es gab daher weder einen
abgeschlossenen Ergebnisdiff noch eine grüne Verifikation. Der erste
sandboxierte Vorversuch scheiterte vorher ohne Tokens am lokalen Netzwerkzugriff
und zählt nicht als Modellmessung.

Die drei weiteren kostenpflichtigen Varianten wurden nicht gestartet: Bei einer
fehlgeschlagenen Baseline könnten sie keine vergleichbare Verbesserung
nachweisen, sondern nur zusätzliche Kosten erzeugen.

## Entscheidung

`settings.json` bleibt bei `keepRecentTokens: 12000`. Ein erneuter Versuch
benötigt zuerst einen abgeschlossenen, vergleichbaren Baseline-Lauf mit
tatsächlich ausgelöster Compaction; erst dann wird die vollständige 2×2-Matrix
wiederholt. Die anonymisierten Messwerte und temporären Session-Artefakte sind
nicht Teil des Repositorys.
