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
Projekt bewusst vermeidet; (5) Wiederverwendung bereits vorhandener,
bereits getesteter Entscheidungsfunktionen, beschränkt auf Planmodus und die
Stufen `project-write`/`confirm-all`.

## Entscheidung

Zwei Funktionen in `extensions/permissions/workflow-policy.ts`,
`planModeMutationGuard` und `planModeBashGuard`, greifen ausschließlich wenn
`isPlanningMode(workflow.mode)` wahr ist und die aktive Stufe `project-write`
oder `confirm-all` ist. `readonly` selbst braucht keine gesonderte
Behandlung (schon vollständig gesperrt); `yolo` wird bewusst **nicht**
erfasst — die Wahl von YOLO ist selbst eine explizite, eindeutige Aufhebung
der Standard-Sicherheit, die der Guard nicht stillschweigend übersteuern
soll.

**Schreibzugriffe** laufen über `decideFileAccess("readonly", "write", ...)`
aus `extensions/shared/permission-policy.ts` — dieselbe Logik, die die Stufe
`readonly` an anderer Stelle bereits verwendet (Secret-, Symlink-,
Redirection-Erkennung eingeschlossen), mit der Plandatei als
`protectedWritePath`. Hier ist Wiederverwendung uneingeschränkt richtig:
`readonly`s Schreibpolitik ist ohnehin "alles außer der Plandatei
verweigern", exakt das gewünschte Verhalten.

**Bash-Kommandos** laufen über `isPlanModeDiagnosticCommand`
(`extensions/shared/permission-policy.ts`) — eine eigene Klassifikation,
**nicht** `decideBash("readonly", ...)`. Sie teilt sich Parser und harte
Schutzmechanismen mit `isPlanSafeCommand` (Befehlsverkettung,
Command-Substitution, Redirection, unquotierte Variablenexpansion,
Secret-Referenzen, projektexterne Pfade bleiben in beiden verboten), weitet
aber gezielt zwei Zweige gegenüber `readonly`s Allowlist:

- **npm/pnpm/yarn:** eine Blocklist mutierender Subcommands (`install`,
  `update`, `ci`, `publish`, `exec`, `config set`, …,
  `PLAN_MODE_MUTATING_PACKAGE_SUBCOMMANDS`) plus npms eigene
  Read-Built-ins (`list`/`view`/`info`/…, immer erlaubt, führen kein
  Projektskript aus). Für `run`/bare Alias-Subcommands (`npm test`,
  `npm start`, `npm run <script>`) muss der Skriptname selbst nach einer
  bekannten Diagnose-Kategorie aussehen
  (`DIAGNOSTIC_SCRIPT_NAME_PREFIXES`: `test`, `typecheck`, `lint`, `check`,
  `verify`, `coverage`, `audit`, `build`, optional namensraum-erweitert wie
  `test:coverage`, ohne `fix`/`write`-Marker wie in `lint:fix`) —
  `isDiagnosticScriptName`. Ein unbekannter Skriptname (`npm run generate`,
  `npm start`, ein eigener `npm foo`-Alias) gilt nicht automatisch als
  diagnostisch und bleibt blockiert; projekteigene, bewusst
  vertrauenswürdige Prüfungen laufen stattdessen über `project_check`
  gegen `.pi/verify.json`.
- **git:** eine eigene, schlankere Lesend-Liste (`status`, `diff`, `show`,
  `log`, `branch`-Auflistung, `remote -v`, …,
  `PLAN_MODE_SAFE_GIT_SUBCOMMANDS`) ohne `readonly`s zusätzliche
  `--no-pager`/`--no-textconv`-Anforderung, die einen einfachen
  `git diff`/`git show` sonst ablehnt.

Die Ausführbarkeits-Prüfung klassifiziert rein über den Kommandotext, nicht
über PATH-/Dateisystemauflösung wie `trustedExecutableName` (das bleibt
unverändert `readonly`s eigener, PATH-Hijack-paranoider Mechanismus, nur
für `/usr/bin` & Co.). Begründung: `project-write`/`confirm-all` führen
Bash ohnehin ungeprüft aus — nur dieser eine Planmodus-Guard wollte
strenger sein als die sonst geltende Vertrauensbasis, und reale
`npm`/`tsc`/`eslint`-Aufrufe lösen auf jeder gewöhnlichen
Entwicklungsumgebung (nvm/volta/homebrew/corepack, `node_modules/.bin`)
nicht unter `/usr/bin` und oft legitim **innerhalb** des Projekts auf.

`extensions/permissions/guards.ts` ruft `planModeMutationGuard` nur im
`tool_call`-Handler auf (nach `automaticallyAllowedInPlanMode` — die
Plandatei gewinnt zuerst), also nur für Bash-Aufrufe des Agenten über das
`bash`-Tool. Der `user_bash`-Handler — der laut SDK ausschließlich für
einen vom Menschen selbst per `!`/`!!`-Präfix eingegebenen Befehl feuert,
nie für den Agenten — durchläuft weiterhin die harte Grenzprüfung
(`assessBash`) und die gewählte Berechtigungsstufe, aber nicht diesen
Guard: Planmodus soll den Agenten am impliziten Implementieren hindern,
nicht den Menschen an der eigenen Tastatur einschränken.

## Begründung

Wiederverwendung wo sie richtig ist, eigene Klassifikation wo nötig: Für
Schreibzugriffe ist `readonly`s Politik exakt das Zielverhalten — keine
neue Logik nötig. Für Bash wäre dieselbe Wiederverwendung falsch gewesen:
`readonly`s Allowlist ist auf einen harten, vom Nutzer bewusst gewählten
Sandbox-Zweck kalibriert und lehnt provably-nicht-beweisbare Kommandos
grundsätzlich ab — inklusive gewöhnlicher Diagnosebefehle wie `npm test`
oder `git diff` ohne Sonderflags. Planmodus ist dagegen eine
Unfallvermeidungs-Schicht auf einer Berechtigungsstufe, die Bash sonst frei
laufen lässt; sie an `readonly`s härterem Maßstab zu messen blockiert genau
die Kommandos, die während des Planens legitim sind, ohne einen
Sicherheitsgewinn zu bringen, den `project-write`/`confirm-all` nicht
ohnehin schon aufgeben. `isPlanModeDiagnosticCommand` bleibt trotzdem kein
Freibrief: Es teilt sich Parser und harte Grenzen mit `isPlanSafeCommand`,
bleibt eine Blocklist bekannter Mutationen plus eine (bewusst kurze,
kategoriebasierte statt vollständige) Positivliste für Skriptnamen — kein
neuer Zustand, keine neue ID, keine Persistenz, nur zwei zusätzliche, klein
gehaltene Klassifikationsfunktionen neben den bereits vorhandenen.

## Verworfene erste Variante

Die erste Umsetzung rief für Bash `decideBash("readonly", ...)` direkt auf
— dieselbe Funktion, die `readonly` selbst verwendet — und lief zusätzlich
im `user_bash`-Handler. Das erschien zunächst konsequent (maximale
Wiederverwendung), erwies sich aber als falsch kalibriert: `readonly`s
Allowlist erlaubt für `npm`/`pnpm`/`yarn` ausdrücklich nur
`list/view/info/search/outdated/audit` — nicht `run`/`test`, also auch
nicht `npm test`, `npm run typecheck`, `npm run lint` oder
`npm run verify` — und verlangt für `git` zusätzlich
`--no-pager`/`--no-textconv`-Nachweise, wodurch ein einfaches
`git diff`/`git show` ohne diese Flags ebenfalls durchfiel. Für `readonly`
selbst ist das richtig; im Planmodus blockierte es genau die
Diagnosebefehle, die der Guard eigentlich zulassen sollte. Der Lauf im
`user_bash`-Handler schränkte zudem fälschlich den Menschen an der eigenen
Tastatur ein, nicht nur den Agenten. Beides wurde durch die oben
beschriebene eigene Klassifikation und die Beschränkung auf `tool_call`
ersetzt.

## Konsequenzen

- `extensions/plan-mode/README.md` ("## Durchsetzung") und `README.md`
  ("## Berechtigungen und Freigaben") beschreiben den Guard, die
  Skriptnamen-Kategorien und die `yolo`-/`user_bash`-Ausnahmen.
- `tests/workflow-mode/permissions.test.mjs` prüft: Planmodus +
  `project-write`/`confirm-all` blockiert einen Nicht-Plan-Schreibzugriff,
  erlaubt den Plandatei-Schreibzugriff; blockiert echte Mutationen
  (`rm`/`cp`/`mv`/`sed -i`/Redirection/`npm install`/`eslint --fix`/
  mutierende `git`-Kommandos); erlaubt anerkannte Diagnosebefehle (`npm
  test`, `npm run typecheck/lint/verify/build/test:coverage`,
  `tsc --noEmit`, `eslint .`, `git status/diff/show/log`); blockiert
  unbekannte oder mutierende Skriptnamen (`npm run generate`, `npm start`,
  `npm run lint:fix`); Planmodus + `yolo` ist unverändert; Work-Modus ist
  unabhängig von der Stufe unverändert; `user_bash` ist von diesem Guard
  unberührt (`tests/workflow-mode/e2e.test.mjs`, Fall E, prüft den
  `tool_call`-Pfad).
- Kein Einfluss auf den Verifikationsstatus, keine neue Completion- oder
  Abschlusslogik.
