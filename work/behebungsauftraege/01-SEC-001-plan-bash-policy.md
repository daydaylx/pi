# SEC-001 — Plan-Bash-Allowlist lässt Mutationen und lokale Ersatzprogramme zu

## Priorität und Ziel

- **Priorität:** P1, hoch
- **Bereich:** Security, Permission-Policy, Workflow
- **Ziel:** Im Plan-Modus darf kein Projektinhalt mutiert und kein lokales Ersatzprogramm unter einem erlaubten Diagnose-Namen ausgeführt werden.

## Betroffene Bereiche

- `extensions/shared/permission-policy.ts`
- `extensions/permissions/workflow-policy.ts`
- `extensions/permissions/guards.ts`
- zugehörige Plan-, Readonly- und Recovery-Tests

## Verbindliche Regeln

1. Nicht nur den Basisnamen des Programms prüfen.
2. Executable und Argumente gemeinsam bewerten.
3. Unbekannte oder dynamische Shellsyntax konservativ ablehnen.
4. `git status`, `git diff` und `git log` nur mit explizit erlaubten, nicht mutierenden Optionen zulassen.
5. Redirects, Ausgabedateien, externe Diff-Programme, Textconv, Hooks, `-C`-Ortswechsel und lokale Ersatzprogramme nicht als Plan-Diagnose akzeptieren.
6. Plan-, Readonly- und Recovery-Entscheidungen müssen dieselbe Klassifizierung verwenden.
7. Parser-Schutz nicht als OS-Sandbox ausgeben. Für eine harte Garantie gegen beliebigen Projektcode ist eine zusätzliche Prozess-/Dateisystemgrenze erforderlich.

## Todos

- [ ] Alle Caller der Funktionen `diagnosticExecutableName`, `isPlanModeSafeGitCommand` und `isPlanModeDiagnosticSegment` erfassen.
- [ ] Ein normalisiertes Kommando-/Capability-Modell definieren.
- [ ] Vertrauenswürdige Executable-Auflösung implementieren; `./git` und andere projektlokale Ersatzprogramme nicht als Systemdiagnose behandeln.
- [ ] Git-Subcommands und Argumente als konservative Allowlist modellieren.
- [ ] Redirection, Pipeline, Subshell, Interpreter, `--output`, externe Diff-Optionen und Textconv ablehnen.
- [ ] Gemeinsame Entscheidung in Plan-, Readonly- und Recovery-Gates integrieren.
- [ ] Tests mit echten temporären Repositories und echten Dateierzeugungen ergänzen.
- [ ] Prüfen, dass Shift+Tab und die bestehenden Super-Commands unverändert dispatchen.

## Pflicht-Regressionstests

- `git diff --output=plan-write.txt` im Plan-Modus.
- `git status` über ein lokales `./git`, das eine Datei erzeugt.
- Varianten mit Redirects, Pipes, `sh -c`, `git -C`, `--ext-diff` und Textconv.
- Erlaubte reine Diagnosen ohne Seiteneffekt.
- Recovery-Gate mit denselben Kommandos.
- Mindestens ein Integrationsfall über den echten Tool-Guard.

## Abnahmekriterien

- `git diff --output=...` wird vor der Ausführung blockiert.
- Ein lokales `./git` kann keine Plan-Policy umgehen.
- Kein Testfall erzeugt trotz erlaubter Plan-Entscheidung eine Datei.
- Zulässige reine Git-Diagnosen funktionieren weiterhin.
- Plan, Readonly und Recovery liefern für denselben Befehl dieselbe Capability-Bewertung.
- Alle negativen Tests laufen auf dem gepinnten Node-Profil.

## Abhängigkeiten

- Das Capability-Modell wird gemeinsam mit SEC-002 und REC-001 abgestimmt.
- SNAP-001 muss vor einer abschließenden Verifier-/Recovery-Bewertung aktiv sein.

## Risiken

- Eine zu enge Allowlist kann legitime Diagnoseoptionen blockieren.
- Eine reine Parserlösung verhindert keinen bösartigen Code in einem ausdrücklich zugelassenen Prozess.

## Erforderlicher Abschlussnachweis

PR mit Policy-Diff, Testfällen, realem Prozess-/Dateisystem-Output und einer Aussage, welche Restgarantie nur durch eine OS-Sandbox erreichbar ist.
