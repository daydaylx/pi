---
description: Genehmigten Plan kontrolliert umsetzen
---

Setze den genehmigten Plan um:

1. Lies den aktuellen Plan aus `.agent/plans/current-plan.md` (falls vorhanden).
2. Setze die Schritte exakt in der festgelegten Reihenfolge um.
3. Melde kurz nach jeder Dateiänderung, was gemacht wurde.
4. Führe nach Abschluss Build/Test/Lint aus (sofern vorhanden).
5. Fasse am Ende zusammen:
   - Was wurde geändert (Dateiliste)?
   - Welche Tests liefen durch?
   - Welche Risiken bleiben?

**Verboten:** Keine Zusatzideen, kein unbesprochenes Refactoring, keine neuen
Dependencies ohne Auftrag, kein Commit ohne ausdrücklichen Befehl.
