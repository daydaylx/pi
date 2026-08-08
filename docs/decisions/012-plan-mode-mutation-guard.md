# 012 — Plan Mode bekommt einen technischen Mutationsschutz

## Kontext

Plan Mode instruiert das Modell, während `simple_plan`/`detailed_plan` nichts
zu implementieren und ausschließlich `.agent/plans/current-plan.md` zu
schreiben. Technisch erzwang bisher nur `automaticallyAllowedInPlanMode`
(`extensions/permissions/workflow-policy.ts`) einen einzigen Fall: Schreiben
auf genau die Plandatei. Alle anderen Schreibzugriffe und Bash-Kommandos
folgten unverändert der gewählten Berechtigungsstufe — bei den beiden
häufigsten Stufen `project-write` und `confirm-all` also weitgehend normal
möglich. Das erzeugt eine Fehlerquelle zwischen gewünschtem Verhalten
("plane nur") und tatsächlichen Capabilities.

Fünf Ansätze wurden verglichen: (1) nur eine stärkere Prompt-Regel — keine
Verbesserung gegenüber dem Status quo; (2) ein pauschaler technischer Block
von `write`/`edit` auf allen Stufen inklusive `yolo` — überschreibt eine
explizite Nutzerentscheidung ungefragt; (3) nur eine Bash-Mutationsklassen-
prüfung ohne Datei-Guard — lässt `write`/`edit` ungeschützt; (4) ein neuer,
planmodus-eigener Capability-Zustand — genau die neue State Machine, die das
Projekt bewusst vermeidet; (5) Wiederverwendung der bereits vorhandenen,
bereits getesteten `readonly`-Entscheidungsfunktionen, beschränkt auf
Planmodus und die Stufen `project-write`/`confirm-all`.

## Entscheidung

Zwei neue Funktionen in `extensions/permissions/workflow-policy.ts`,
`planModeMutationGuard` und `planModeBashGuard`, greifen ausschließlich wenn
`isPlanningMode(workflow.mode)` wahr ist und die aktive Stufe `project-write`
oder `confirm-all` ist. Sie rufen `decideFileAccess("readonly", "write", ...)`
beziehungsweise `decideBash("readonly", ...)` aus
`extensions/shared/permission-policy.ts` auf — dieselbe Logik, die die Stufe
`readonly` an anderer Stelle bereits verwendet (Secret-, Symlink-, `sed -i`-,
Redirection-Erkennung eingeschlossen) — statt neue Muster zu schreiben.
`extensions/permissions/guards.ts` ruft beide Guards auf: im `tool_call`-
Handler nach `automaticallyAllowedInPlanMode` (die Plandatei gewinnt also
weiterhin zuerst), im `user_bash`-Handler nach der harten
Grenzprüfung (`assessBash`).

`readonly` selbst braucht keine gesonderte Behandlung: sein eigener Zweig in
`decideFileAccess`/`decideBash` sperrt bereits alles außer der Plandatei.
`yolo` wird bewusst **nicht** vom Guard erfasst — die Wahl von YOLO ist selbst
eine explizite, eindeutige Aufhebung der Standard-Sicherheit; der Guard soll
diese Entscheidung nicht stillschweigend übersteuern.

## Begründung

Wiederverwendung statt neuer Logik: keine zusätzlichen Regex-Muster, kein
neuer Zustand, keine neue ID, keine Persistenz — nur zwei kleine Funktionen,
die vorhandene, bereits getestete Entscheidungsfunktionen mit einem fest
codierten `"readonly"`-Level aufrufen. Das minimiert Umgehungsmöglichkeiten
(dieselbe Klassifikation, die `readonly` robust macht, macht auch diesen
Guard robust) und hält die Kopplung zum Berechtigungssystem lose: die
angezeigte, tatsächliche Stufe bleibt unverändert, nur die Guard-Entscheidung
leiht sich `readonly`s Logik.

## Konsequenzen

- `extensions/plan-mode/README.md` ("## Durchsetzung") und `README.md`
  ("## Berechtigungen und Freigaben") beschreiben den Guard und die
  `yolo`-Ausnahme.
- `tests/workflow-mode/permissions.test.mjs` prüft: Planmodus + `project-write`
  blockiert einen Nicht-Plan-Schreibzugriff, erlaubt den Plandatei-Schreib-
  zugriff, blockiert ein mutierendes Bash-Kommando, erlaubt ein rein
  lesendes; Planmodus + `yolo` ist unverändert; Work-Modus ist unabhängig von
  der Stufe unverändert.
- Kein Einfluss auf den Verifikationsstatus, keine neue Completion- oder
  Abschlusslogik.
