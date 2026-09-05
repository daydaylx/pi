# P1 – Tool-Call-Effizienz

## Befund

Real-Duel #002:
- Pi: 72 Tool Calls, 1809,258 s
- Codex: 27 Tool Calls, 540,966 s

Trotzdem war die qualitative Blind-Bewertung insgesamt unentschieden.

Quellen:
- https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign/run.log
- https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign.md

## Arbeitsauftrag

Analysiere die Tool-Call-Sequenz von Pi auf vermeidbare Wiederholung und
Harness-Overhead. Ziel ist **gleiche oder bessere Qualität mit weniger unnötiger
Arbeit**, nicht ein künstliches Toolcall-Limit.

### Analyse

Klassifiziere alle Pi-Toolcalls:
- Read
- Search
- Edit
- Shell
- Verify
- LSP
- Subagent
- sonstige

Für jeden Call:
- Start/Ende
- Dauer
- Erfolg/Fehler
- Ziel
- bereits vorher gelesene/gesuchte Information?
- war das Ergebnis später tatsächlich relevant?

Ermittle:
- doppelte Reads
- wiederholte Suchen
- gleiche Verify-Befehle
- unnötige Kleinstaufrufe
- Recovery-Aufrufe nach Harnessfehlern
- vermeidbare Subagentenaufrufe

### Umsetzung

Nur klar belegte Ineffizienzen ändern:
- Reads sinnvoll bündeln
- bekannte Ergebnisse wiederverwenden
- Suchraum nach erster Exploration enger machen
- Verify-Strategie klar staffeln
- keine zusätzliche Caching-Abstraktion ohne messbaren Nutzen

### Tests / Evaluation

Realistische Repo-Aufgabe A/B vor/nach Änderung:
- Qualität
- Tool Calls
- Tool Errors
- Laufzeit
- Fresh Input
- Cache Read
- Verifikationsabdeckung

### Abschlusskriterium

Nachweisbare Reduktion redundanter Calls ohne messbare Qualitäts- oder
Verifikationsverschlechterung.
