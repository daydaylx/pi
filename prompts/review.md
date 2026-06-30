---
description: Änderungen kritisch prüfen – Bugs, Scope-Verstöße, Risiken
---

Prüfe die letzten Änderungen kritisch:

1. Git-Diff lesen (`git diff HEAD` oder angefügte Dateien).
2. Prüfen:
   - **Scope-Verstöße:** Wurden Dateien geändert, die nicht im Plan standen?
   - **Korrektheit:** Macht der Code was er soll? Logikfehler?
   - **Risiken:** Seiteneffekte, fehlendes Error-Handling, Sicherheitsprobleme?
   - **Wartbarkeit:** Offensichtliche Probleme für zukünftige Änderungen?
3. Befund als strukturierte Liste:
   - ✓ OK: Was ist sauber umgesetzt
   - ⚠ Warnung: Was ist fragwürdig aber nicht blockierend
   - ✗ Problem: Was muss behoben werden (mit konkretem Vorschlag)

**Verboten:** Keine Dateiänderungen, kein pauschales "sieht gut aus".
