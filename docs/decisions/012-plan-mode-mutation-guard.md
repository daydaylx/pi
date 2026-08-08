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

## Nachtrag: Bash-Klassifikation korrigiert (PR #134 Follow-up)

Die erste Umsetzung von `planModeBashGuard` rief `decideBash("readonly", ...)`
direkt auf — dieselbe Funktion, die `readonly` selbst verwendet. In der Praxis
blockierte das weit mehr als Mutationen: `readonly`s Bash-Politik ist eine
enge **Allowlist** provably-lesender Kommandos und erlaubt für `npm`/`pnpm`/
`yarn` ausdrücklich nur `list/ls/view/info/search/outdated/audit` — nicht
`run`/`test`, also auch nicht `npm test`, `npm run typecheck`, `npm run lint`
oder `npm run verify`. Für `git` verlangt sie zusätzlich `--no-pager`/
`--no-textconv`-Nachweise, wodurch ein einfaches `git diff`/`git show` ohne
diese Flags ebenfalls durchfiel. Das entspricht `readonly`s eigenem, bewusst
strengem Zweck (dort ist es richtig), blockierte im Planmodus aber genau die
Diagnosebefehle, die der Guard eigentlich zulassen sollte.

**Korrektur:** `isPlanModeDiagnosticCommand` (`extensions/shared/permission-
policy.ts`) ersetzt den `decideBash("readonly", ...)`-Aufruf. Es teilt sich
denselben Shell-Parser und dieselben harten Schutzmechanismen mit
`isPlanSafeCommand` (Befehlsverkettung, Command-Substitution, Redirection,
unquotierte Variablenexpansion, Secret-Referenzen, projektexterne Pfade
bleiben verboten) und weitet gezielt zwei Allowlist-Zweige:

- `npm`/`pnpm`/`yarn`: statt einer Liste erlaubter Subcommands eine
  **Blocklist** mutierender (`install`, `update`, `ci`, `publish`, `exec`,
  `config set`, …) — alles andere, inklusive `run`/`test`/beliebiger
  Skriptnamen, ist erlaubt. `npx`/`*.dlx`/`*.exec` bleiben blockiert
  (beliebige Paketausführung).
- `git`: eine eigene, schlankere Lesend-Liste (`status`, `diff`, `show`,
  `log`, `branch`-Auflistung, `remote -v`, …) ohne `readonly`s Pager-/
  Textconv-Anforderung.

Eine zweite, unabhängige Ursache kam hinzu: die Ausführbarkeits-Prüfung
(`trustedExecutableName`) akzeptiert nur Binaries unter `/usr/bin`, `/bin`,
`/usr/sbin`, `/sbin`. Auf praktisch jeder realen Entwicklungsumgebung
(nvm/volta/homebrew/corepack, `node_modules/.bin`) liegen `npm`/`tsc`/
`eslint` nicht dort — die Prüfung hätte die neue Allowlist unabhängig von
ihrem Inhalt wirkungslos gemacht. Ein erster Versuch, stattdessen "außerhalb
des Projekts aufgelöst" als Vertrauenskriterium zu verwenden, scheiterte
ebenfalls: reale `tsc`/`eslint`-Aufrufe lösen sehr häufig legitim **innerhalb**
des Projekts auf (`node_modules/.bin`, der Standardweg für projektgepinnte
Dev-Dependencies). Da `project-write`/`confirm-all` Bash ohnehin ungeprüft
ausführen (nur diese eine Planmodus-Zusatzprüfung wollte strenger sein als
die sonst geltende Vertrauensbasis), verzichtet
`isPlanModeDiagnosticCommand` bewusst auf jede Dateisystem-/PATH-Auflösung
und klassifiziert rein über den Kommandotext — wie der übrige Teil dieses
Moduls (`PLAN_SIMPLE_COMMANDS`, `isWriteCapableCommand`) es ohnehin tut.
`trustedExecutableName` und `isSafePlanSegment`/`isPlanSafeCommand` (die
`readonly`-Stufe) bleiben davon unberührt und genauso streng wie zuvor.

Zusätzlich stellte sich heraus, dass `planModeBashGuard` fälschlich auch im
`user_bash`-Event lief — das feuert laut SDK ausschließlich für einen vom
Menschen selbst per `!`/`!!`-Präfix eingegebenen Befehl, nie für einen
Bash-Tool-Aufruf des Agenten. Planmodus soll den Agenten am impliziten
Implementieren hindern, nicht den Menschen an der eigenen Tastatur
einschränken. Der Guard läuft jetzt ausschließlich im `tool_call`-Handler
(Agent-Bash über das `bash`-Tool); `user_bash` durchläuft weiterhin die
harte Grenzprüfung (`assessBash`) und die gewählte Berechtigungsstufe, aber
nicht `planModeBashGuard`.
