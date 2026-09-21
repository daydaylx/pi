# BENCH-003 — Unbekannter Baselinezustand wird als vergleichbar freigegeben

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** Benchmark, Comparability
- **Ziel:** Fehlende oder fehlerhafte Baseline-Evidenz darf niemals automatisch als vergleichbarer Lauf gelten.

## Betroffene Bereiche

- `benchmarks/real-duel/scripts/baseline_preflight.py`
- `decide_comparable`
- Fallbacks in `benchmarks/real-duel/scripts/pi-duel`
- Reporting und Filterung

## Verbindliche Regeln

1. Mindestens drei Zustände verwenden: `comparable`, `not_comparable`, `unknown`.
2. Preflight-Fehler werden nicht zu `comparable=true`.
3. Manuelle Freigaben benötigen Begründung, Identität des Freigebenden und Zeitstempel.
4. Reports dürfen `unknown` nicht in belastbare Stichproben einmischen.
5. Alte Ergebnisse werden nicht rückwirkend als geprüft markiert.

## Todos

- [ ] Rückgabeschema von Boolean auf Statusobjekt umstellen.
- [ ] Alle Exception- und `None`-Fallbacks prüfen.
- [ ] Reporting, Aggregation und Filter auf den neuen Status umstellen.
- [ ] Manuelle Override-Struktur mit Begründung definieren.
- [ ] Tests für fehlenden, unbekannten, positiven und negativen Preflight ergänzen.
- [ ] Bestehende Ergebnisdateien auf Interpretationskompatibilität prüfen.

## Pflicht-Regressionstests

- `None` ergibt `unknown`, nicht `comparable`.
- `{status: "unknown"}` ergibt `unknown`.
- Fehler im Preflight wird nicht als positiver Vergleich gewertet.
- Manuelles Override ist sichtbar und separat filterbar.
- Aggregation schließt `unknown` standardmäßig aus.

## Abnahmekriterien

- Der Auditfall liefert keinen positiven Vergleichbarkeitswert.
- Reports unterscheiden belastbare, nicht vergleichbare und unbekannte Läufe.
- Kein automatischer Fallback glättet fehlende Evidenz.

## Abhängigkeiten

- BENCH-001 liefert den korrekten Sandbox-Preflight-Status.
- BENCH-002 liefert Wiederherstellbarkeits-Evidenz.

## Risiken

- Die Zahl auswertbarer historischer Läufe sinkt.
- Konsumenten, die nur ein Boolean erwarten, benötigen eine Migration.

## Erforderlicher Abschlussnachweis

PR mit neuem Statusschema, Reporting-Test und Beispielreport mit `unknown`.
