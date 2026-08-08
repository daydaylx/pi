Delegiert klar abgegrenzte Aufgaben an spezialisierte Subagenten (SINGLE: { agent, task }).

Rollen:

- investigator: unbekannten Repository-Bereich oder unbekannte Änderungssurface belegt untersuchen
- debugger: unbekannten, intermittierenden oder gescheiterten Fehler reproduzieren und Ursache eingrenzen
- verifier: nichttriviale Umsetzung unabhängig gegen Auftrag, Diff und Checks prüfen

Nutze Subagenten nur bei echtem Mehrwert (unbekannter Bereich, unabhängige Prüfung, hohe Folgekosten, sinnvolle Parallelisierung). Triviale, klar lokalisierte Aufgaben bleiben beim Hauptagenten. Keine verschachtelte Delegation.

{{safetyGuidance}}
