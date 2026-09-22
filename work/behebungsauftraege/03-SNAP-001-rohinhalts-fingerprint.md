# SNAP-001 — Textconv erzeugt gleiche Fingerprints für verschiedene Inhalte

## Priorität und Ziel

- **Priorität:** P1, hoch
- **Bereich:** Snapshot, Security, Robustheit
- **Ziel:** Workspace-Fingerprints müssen den tatsächlichen Inhalt eindeutig genug repräsentieren und dürfen nicht von Textconv oder externen Diff-Programmen abhängen.

## Betroffene Bereiche

- `shared/workspace-snapshot.mjs`
- Verifier-Gate und Recovery-Gate

## Verbindliche Regeln

1. Snapshot-Aufrufe verwenden `--no-textconv` und `--no-ext-diff`.
2. Die Definition von Inhaltsidentität wird dokumentiert.
3. Status-, Pfad-, Modus- und Inhaltsinformationen deterministisch serialisieren.
4. Bei fehlender oder fehlerhafter Snapshot-Evidenz fail-closed bleiben.
5. Kein Fallback auf einen reinen Status- oder Dateinamen-Hash.

## Todos

- [ ] Alle Git-Aufrufe innerhalb der Snapshot-Erfassung prüfen.
- [ ] `--no-textconv` an jedem relevanten Pfad erzwingen.
- [ ] Deterministische Serialisierung und Trennzeichen dokumentieren.
- [ ] Tests für Textconv, External Diff, Binärdateien, Gitlinks und Git-Attribute ergänzen.
- [ ] Prüfen, dass Streaming-, Retry- und Abort-Logik erhalten bleiben.
- [ ] Verifier- und Recovery-Consumer auf das korrigierte Format testen.

## Pflicht-Regressionstests

- Zwei Arbeitsstände mit gleichem Textconv-Output müssen unterschiedliche Fingerprints erzeugen.
- Rohdiff ohne Textconv muss nicht leer sein, wenn sich der Inhalt unterscheidet.
- Große Diffs und Binärdateien.
- Untracked, renamed, deleted und mode-changed Dateien.
- Snapshot-Abbruch und fehlender Snapshot.

## Abnahmekriterien

- Der im Audit reproduzierte A/B-Fall liefert verschiedene Fingerprints.
- Keine Snapshot-Entscheidung verwendet Textconv oder External Diff.
- Verifier und Recovery erkennen eine echte Inhaltsänderung.
- Bestehende Streaming- und Fail-closed-Tests bleiben grün.

## Abhängigkeiten

- Vor Abschluss von AGENT-001 müssen neue Fingerprints verwendet werden.
- Alte gespeicherte Nachweise dürfen nach dem Formatwechsel bewusst ungültig werden.

## Risiken

- Fingerprints ändern sich gegenüber älteren Versionen auch bei gleichem Workspace.
- Spezielle Git-Zustände benötigen eine explizite Produktentscheidung.

## Erforderlicher Abschlussnachweis

PR mit dokumentierter Snapshot-Spezifikation, reproduzierbarem Textconv-Gegenbeispiel und Integrationsausgabe aus Verifier und Recovery.
