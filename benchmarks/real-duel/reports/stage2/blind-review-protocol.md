# Stufe-2 Blind-Review-Protokoll

## Zweck

Stufe 1 hatte pro Task nur einen Blind-Reviewer (bei 2 Kandidaten zweimal mit
vertauschter A/B-Reihenfolge zur Positionsbias-Kontrolle; beim 4-Varianten-
Piloten nur einen einzigen Durchlauf ohne Positionsbias-Kontrolle). Für
Stufe 2 (3 Tasks × 3 Trials × 2 Workflows × 2 Kandidaten) soll kein einzelner
Reviewer allein die Qualitätsrangfolge bestimmen.

## Ablauf pro Task/Trial

Für jede Zelle (Task × Trial) mit vier Implementierungen (Pi Work-only,
Codex Work-only, Pi Plan→Work, Codex Plan→Work):

1. **Anonymisierung.** Die vier Patches werden mit neutralen Labels `A`–`D`
   versehen. Keine Datei-/Commit-Metadaten, Transcript-Zitate oder
   Formulierungen, die Pi vs. Codex oder Work-only vs. Plan→Work verraten,
   dürfen im anonymisierten Material verbleiben.
2. **Rotation der Zuordnung.** Die Zuordnung Label → (Kandidat, Workflow)
   wird pro Task/Trial neu (pseudo-)randomisiert, nicht immer
   `A=Pi-WO, B=Codex-WO, C=Pi-PW, D=Codex-PW` wie im Stufe-1-Piloten.
3. **Mapping getrennt speichern.** Die Auflösung liegt in
   `reports/stage2/<task>/blind-review-mapping.json` (Schema unten),
   **außerhalb** des den Reviewern vorgelegten Materials, und wird **nicht
   vor Abschluss beider Reviews** committet.
4. **Zwei unabhängige Reviews.** Zwei getrennte Review-Durchläufe (keine
   gegenseitige Einsicht vor Abschluss beider). Jeder Reviewer sieht
   ausschließlich die anonymisierten Labels.
5. **Auflösung erst danach.** Labels werden erst nach Abschluss beider
   Reviews auf echte Kandidaten/Workflows zurückgeführt.

## Mapping-Dateiformat

```json
{
  "task": "real-04-session-health-provider-filter",
  "trial": 2,
  "slots": {
    "A": { "harness": "codex-real", "workflow": "plan-work", "run_id": "..." },
    "B": { "harness": "pi-real", "workflow": "work-only", "run_id": "..." },
    "C": { "harness": "pi-real", "workflow": "plan-work", "run_id": "..." },
    "D": { "harness": "codex-real", "workflow": "work-only", "run_id": "..." }
  }
}
```

## Reviewer-Auftrag

Bewerten:

- Anforderungserfüllung (gegen `instruction.md`)
- Korrektheit
- Robustheit / Randfälle
- unnötige Änderungen (gegen `expected_surface`/`forbidden_surface`)
- Architekturqualität
- Wartbarkeit
- Tests
- Regression-Risiko

**Nicht** bewerten:

- Stilpräferenzen ohne funktionalen Einfluss
- welcher Harness vermutlich dahintersteckt (Vermutungen dazu sind für die
  Bewertung irrelevant und sollen nicht in die Begründung einfließen)

## Widerspruch zwischen den Reviews

Wenn die beiden Reviews zu unterschiedlichen Rangfolgen kommen, wird die
Zelle als `inconclusive` markiert — es wird **nicht** künstlich zwischen den
Bewertungen gemittelt, bis ein Sieger entsteht. `inconclusive` ist ein
gültiges, zu berichtendes Ergebnis.
