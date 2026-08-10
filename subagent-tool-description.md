Delegiert klar abgegrenzte Aufgaben an spezialisierte Subagenten (SINGLE: { agent, task }).

Rollen:

- investigator: unbekannten Repository-Bereich oder unbekannte Änderungssurface belegt untersuchen
- debugger: unbekannten, intermittierenden oder gescheiterten Fehler reproduzieren und Ursache eingrenzen
- verifier: riskante Umsetzung unabhängig gegen Auftrag, Diff und Checks prüfen

Nutze Subagenten nur bei echtem Mehrwert (unbekannter Bereich, unabhängige Prüfung, hohe Folgekosten). Triviale, klar lokalisierte Aufgaben bleiben beim Hauptagenten. Keine verschachtelte Delegation.

Neben der SINGLE-Ausführung sind ausschließlich vier Management-Aktionen verfügbar: { action: "list" } listet die verfügbaren Rollen, { action: "status" }, { action: "stop" } und { action: "interrupt" } steuern einen laufenden Run. Chains, parallele Tasks, Agent-Verwaltung, Scheduling und Worktrees sind in diesem Harness nicht registriert.

{{safetyGuidance}}
