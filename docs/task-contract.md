# Direct Task und Scope-Kontrolle (`.agent/direct-task.json`)

Direkte Aufgaben verwenden keinen Plan und keine zweite Workflow-State-
Machine. `/task <Ziel>` erfragt im TUI:

- sicheren projekt-relativen technischen Scope,
- erwartete `.pi/verify.json`-Profil-IDs,
- beobachtbare Abschlusskriterien.

Das Ergebnis wird atomar als `.agent/direct-task.json` gespeichert:

```json
{
  "version": 1,
  "taskId": "<uuid>",
  "goal": "Fehler beheben",
  "technicalScope": ["src/**", "tests/**"],
  "verification": ["unit"],
  "acceptanceCriteria": ["Regressionstest ist grün"],
  "updatedAt": "<iso timestamp>"
}
```

Absolute Pfade, `..`, negierte Globs und mehrdeutige Scope-Einträge werden
abgelehnt. `/task-done` verwendet dieselbe Completion-Pipeline wie geplante
Arbeit: Diff, Scope, Projektprofile, LSP, unabhängiger Reviewer und erneuter
Diff-Check. Ein Override ist nur im TUI und nur mit nichtleerer Begründung
möglich. Normaler Abschluss und Override werden vor dem Aufräumen als
`workflow-completion`-Bericht in der Sitzung protokolliert. Nach akzeptiertem
Abschluss wird `direct-task.json` entfernt.

Das ältere `.agent/task-contract.json` und seine planabgeleitete
Zwischenschicht sind kein aktiver Workflow-Vertrag mehr. Der reine
`matchScope`-Matcher bleibt als gemeinsame Utility für die Completion erhalten.
