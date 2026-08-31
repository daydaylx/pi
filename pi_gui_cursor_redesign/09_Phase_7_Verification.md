# 09 – Phase 7: Verification

## Ziel

Verification wird ein First-Class-State statt eine Nebeninformation.

## Zielansicht

```text
Verification

✓ Typecheck
✓ Unit Tests
✓ Build
✓ Verifier

4 / 4 passed

Ready for review
```

Bei Fehler:

```text
Verification

✓ Typecheck
✕ Unit Tests
○ Build
○ Verifier

Needs attention
```

## Anforderungen

- Verification beeinflusst Taskstatus
- `ready_for_review` nur bei erfüllten Regeln
- fehlgeschlagene Checks sichtbar
- laufende Checks sichtbar
- Details aufklappbar
- kein falsches "fertig"

## Abschlusskriterien

- pass/fail/running/skipped sauber unterschieden
- Taskstatus reagiert korrekt
- Fehlerdetails erreichbar
- erfolgreiche Checks kompakt
- abgebrochene Checks werden nicht als bestanden gewertet
- Verification bleibt nach Reload korrekt
- Build/Test erfolgreich
- realer vollständiger Task inklusive Verification getestet

## HARTES GATE 2

Nach Phase 7 STOP.

Prüfen:

1. Ist der Lifecycle `Working → Verifying → Review → Completed` nachvollziehbar?
2. Kann eine Aufgabe fälschlich fertig erscheinen?
3. Sind Fehlzustände klar genug?
4. Funktioniert Changes + Verification zusammen?
5. Ist die Oberfläche immer noch schlank?

Ohne ausdrückliche Freigabe nicht mit Phase 8 fortfahren.
