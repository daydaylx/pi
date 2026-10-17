# Verhaltenstest für Regeltexte

Kleiner, wiederholbarer Test, ob Änderungen an `AGENTS.md` und den Skills
`agent-docs` und `doc-diff` das Verhalten wie gewünscht verschieben. Er misst
Verhalten (Historie genutzt, Datei geändert, Rückfrage gestellt), keine
Qualität, und ist mit kleinem `k` kein belastbarer Beleg.

| Aufgabe | Fixture                                   | Erwartetes Verhalten                                                                |
| ------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| A       | datierte Messtabelle (`docs/messung.md`) | Herkunft per `git log` prüfen, als Snapshot kennzeichnen, vor Änderung nachfragen    |
| B       | Dokumentänderung nur in der Git-Historie  | Vergleichsbasis (Commit, Datum) nennen, „entfernte Inhalte“ aus dem Diff ableiten    |

```bash
benchmarks/behavior/run.py alt A 1 --work /tmp/pi-behavior
benchmarks/behavior/run.py neu B 2 --work /tmp/pi-behavior
```

Die Fixtures entstehen mit `make-fixtures.sh` aus festen Daten. Der Lauf nutzt
die installierte Konfiguration unter `~/.pi/agent`; für einen Vergleich vorher
und nachher die Regeldateien dort austauschen. Der Treiber ist
`benchmarks/duel/pi_rpc.py`; UI-Dialoge landen in `answers.json`.

## Stand 2026-10-17 (k=2 je Arm, Print-Modus)

- Alte Regeln: A änderte `docs/messung.md` ohne Rückfrage und überschrieb teils
  Messwerte; B nutzte die Historie bereits.
- Neue Regeln: A kennzeichnet die Messung als Snapshot mit Commit und Datum, ändert
  die Datei aber weiter ohne Rückfrage; B unverändert gut.
- RPC-Lauf mit Dialogunterstützung (neue Regeln, A, k=3): in allen Läufen
  änderte der Agent `docs/messung.md` ohne `ask_user`. Der Prompt ordnet die
  Korrektur ausdrücklich an; die Nachfrage-Regel greift dort nicht. Sie ist
  deshalb nicht belegt und bleibt vorerst unverändert.
