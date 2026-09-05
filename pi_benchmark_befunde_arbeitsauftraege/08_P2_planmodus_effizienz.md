# P2 – Planmodus auf Effizienz prüfen

## Befund

Der Planmodus soll die Arbeit strukturieren. Bei einem Harness mit vielen Toolcalls
muss geprüft werden, ob er tatsächlich Orientierung spart oder zusätzlichen
Turn-/Kontext-Overhead erzeugt.

## Arbeitsauftrag

Analysiere reale Pi-Läufe mit und ohne/zwischen Planphasen.

### Fragen

- reduziert der Plan Wiederholung?
- ist der Plan zu detailliert?
- wird er nach kleinen Ereignissen unnötig neu geschrieben?
- werden Erkenntnisse aus Exploration strukturiert übernommen?
- verdoppelt Plan → Work Kontext?
- enthält der Plan von Anfang an Verifikationsschritte?
- führt der Plan zu unnötigen Rückfragen?
- bleibt Scope klar?

### Metriken

- Tool Calls vor erster Änderung
- Reads/Searches
- Planupdates
- LLM Calls
- Kontextgröße
- Zeit bis erster sinnvoller Edit
- Regressionen/Fehler

### Nicht-Ziel

Planmodus abschaffen oder komplett neu bauen.

### Abschlusskriterium

Konkrete Empfehlung je Aufgabentyp:

- Planmodus sinnvoll
- optional
- eher vermeiden

und nur belegte Optimierungen umsetzen.

## Querverweis (2026-09-05)

Ein separates Vorhaben misst als eigene, vorgezogene Achse Plan→Work vs.
Work-only pro Kandidat (siehe
`/home/d/.claude/plans/reactive-foraging-raven.md` und
`benchmarks/real-duel/scripts/plan_work_*`, `pi_rpc_driver.py`,
`codex_plan_work_driver.py`). Das ist eine andere Fragestellung als dieser
Befund (Effizienz _innerhalb_ des Planmodus bei einem toolcall-reichen
Harness) und ersetzt ihn nicht -- beide bleiben eigenstaendig offen. Das
Vorhaben laeuft als klar gekennzeichneter Opt-in (`--workflow plan-work`,
Default bleibt `work-only`) und aendert an bestehenden Real-Duel-#003-Laeufen
nichts.
