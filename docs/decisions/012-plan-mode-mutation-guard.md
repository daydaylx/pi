# 012 — Plan Mode hat einen kleinen technischen Mutationsschutz

## Entscheidung

Während `simple_plan` oder `detailed_plan` aktiv ist, verändert der Agent
keinen Projekt- oder Systemzustand. Reads sind nicht auf Projektpfade oder eine
feste Tool-Allowlist beschränkt: harmlose externe/systemische Dateien,
Symlinks nach außen, Statusabfragen, Dokumentation und unbekannte
Inspektionswerkzeuge sind zulässig, Secrets/Credentials bleiben gesperrt.

Shell-Befehle werden nach Wirkung klassifiziert statt nach einer positiven
Liste von Executable-Namen. Read-only-Kommandos und Pipelines daraus sind
zulässig; erkannte Redirect-Writes, Datei-/Git-/Paketmutationen,
Systemänderungen, Interpreterausführung und sensible Aktionen werden im
Planmodus geblockt. Unbekannte Tool-Capabilities werden an das aktive
Permission-Level delegiert, statt allein wegen ihres Namens abgelehnt zu
werden. Die Klassifikation ist ein Guard vor dem Executor, keine OS-Sandbox.

> **Korrektur (ADR [020](020-explicit-plan-approval.md)).** Dieser Abschnitt
> lautete ursprünglich, der Agent dürfe `.agent/plans/current-plan.md` mit
> `write`/`edit` ändern, und `verify` sei gesperrt. Beides stimmt nicht mehr
> beziehungsweise stimmte nie:
>
> - Die Plandatei liegt seit 020 nicht mehr im Projekt. Der Plan wird
>   ausschließlich über das Tool `plan_write` geschrieben, das sein Ziel selbst
>   besitzt; die Ausnahme in der Schreibgrenze entfällt ersatzlos.
> - `verify({ check: "typecheck" })` **ist** im Planmodus erlaubt und war es
>   auch schon vor 020 (`planModeVerifyTypecheckAllowed`,
>   `tests/workflow-mode/permissions.test.mjs`). Gesperrt bleiben
>   `check: "test"`, jede andere `verify`-Form und `project_check`.

Projekt-Skripte wie `npm test` und `npm run build` gelten als riskante
Ausführung und bleiben im Planmodus gesperrt. Andere unbekannte
Tool-Capabilities richten sich nach ihrer eigenen Permission- und
Ausführungsrichtlinie. `project_check` und `verify`-Varianten außer dem gezielten Typecheck sind im
Planmodus gesperrt. Subagenten sind nur über die geprüfte temporäre
`analyse`-/`research`-Spec ohne zusätzliche Schreibfähigkeit und Artefakte
erlaubt; Verifier- und Management-Aufrufe bleiben gesperrt. YOLO hebt die
Planmodus-Grenzen für Agenten-Tool-Aufrufe nicht auf.

**Executable-Einstieg.** Der Planmodus soll lesen und erkunden können; das Gate
für Programme ist deshalb bewusst offen. Programme aus Systempfaden
(klassisch `/usr/bin`, …; NixOS-Systemprofil `/run/current-system/sw/bin` und
`/nix/var/nix/profiles/default/bin`), Benutzerprofilen und dem Nix Store
dürfen laufen, wenn ihre Wirkung harmlos ist. Abgelehnt werden nur
projektkontrollierte Treffer (erster PATH-Treffer oder Pfad im Projekt,
`./ls`) und PATH-/Loader-Overrides vor dem Befehl; es gibt keinen Rückfall auf
einen späteren Treffer. Akzeptiertes Risiko: ein bösartiges Binary in einem
Benutzerpfad läuft. Eine Ablehnung unterscheidet `command-not-allowed`
(Wirkung) von `executable-untrusted` (Einstieg); Details in
`extensions/plan-mode/README.md`, „Executable-Vertrauen“.

## Begründung

Die Projektgrenze bleibt für Mutationen bestehen, nicht für harmlose Reads.
Shell-Wirkung wird gemeinsam für Plan- und Recovery-Gates klassifiziert.
Unbekannte Kommandonamen sind nicht automatisch riskant; bekannte Mutation,
Redirection, Systemoperationen und unklare Skriptausführung bleiben gebremst.
Die Klassifikation ist kein vollständiger Shell-Sandbox-Ersatz.

## Konsequenzen

- Der Plan bleibt bei einem fehlgeschlagenen oder ersatzlosen Planning-Turn
  erhalten; nur ein erfolgreich geschriebener, erfolgreich beendeter Turn
  ersetzt ihn. Seit 020 wird dabei ausschließlich die Plandatei der eigenen
  Sitzung zurückgesetzt.
- Tests prüfen End-to-End: normale externe Reads und Analyse-Pipelines
  erlaubt, Mutationen und Secrets blockiert, Plan-Tool weiterhin erlaubt;
  Projekt-Skripte und nicht geprüfte Subagent-Aufrufe bleiben gesperrt.
- Shift+Tab bleibt die einzige Workflow-Steuerung.
