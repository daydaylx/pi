# Prozess für `comparable=false`-Läufe

Die Mechanik ist bereits vorhanden und unverändert (`baseline_preflight.decide_comparable()`,
siehe `scripts/baseline_preflight.py`). Dieses Dokument beschreibt nur den
**Prozess**, wenn ein Stufe-2-Lauf `comparable=false` ergibt.

## Bekannte Gründe für `comparable=false`

- `dirty_override` — Lauf mit `--allow-dirty` erzwungen (canonical repo war
  unsauber).
- `baseline_failing_candidate_verifier_blocked` — Baseline hatte bereits
  einen Fehler in einem Check, und der Kandidat scheitert mit seinem eigenen
  Verifier genau an diesem bereits bekannten Fehler (Fall 3, siehe
  `baseline_preflight.py`-Docstring).

Alle anderen Fälle (`baseline_clean`, `baseline_clean_candidate_regression`,
`baseline_failing_pre_existing`, `baseline_unknown`) bleiben `comparable=true`
— die Policy verwirft nur bei methodischer Unvergleichbarkeit, nie wegen
inhaltlicher Fehler des Kandidaten.

## Prozess

1. **Nicht in den Hauptvergleich aufnehmen.** Ein `comparable=false`-Lauf
   fließt nicht in die Work-only-vs-Plan→Work- oder Pi-vs-Codex-Aggregation
   der Stufe-2-Auswertung ein.
2. **Ursache dokumentieren.** `comparable_reason` aus der Ergebniszeile wird
   in `run-matrix.md` in der Spalte `comparable` festgehalten.
3. **Sauber wiederholen.** Der betroffene Task/Workflow/Kandidat wird mit
   einer neuen Trial-Nummer erneut ausgeführt (z. B. Trial 1 verworfen →
   Trial 4 statt erneut Trial 1, damit `run_id`/Dateien eindeutig bleiben).
4. **Klar als Replacement kennzeichnen.** Die neue Zeile in `run-matrix.md`
   trägt in der Spalte `Ersetzt Trial?` einen Verweis auf den verworfenen
   Trial/`run_id`. Die alte Zeile bleibt in `results.jsonl` (append-only,
   nichts wird gelöscht) und in `run-matrix.md` als `verworfen
(comparable=false)` stehen — sie wird nicht stillschweigend mit der
   Ersatzzeile vermischt oder überschrieben.
5. **Bei `dirty_override`:** vor der Wiederholung sicherstellen, dass das
   canonical Repo tatsächlich sauber ist (`git status` im Hauptrepo, nicht
   im Worktree), bevor der Ersatzlauf gestartet wird.
