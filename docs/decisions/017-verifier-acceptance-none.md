# 017 — Verifier-Delegationen erzwingen `acceptance: "none"`

## Kontext

Drei aufeinanderfolgende Verifier-Läufe (21.08., Projekt
`/home/d/Projekte/aktiv/Arbeitsort`) endeten nach dem vollen 20-Minuten-
Timeout mit `exit:1`, ohne dass der Verifier je ein Urteil bilden konnte.
Ursache ist das Acceptance-Level-System des `pi-subagents`-Pakets
(`src/runs/shared/acceptance.ts`). `pi list` bestätigt: Die Live-Runtime lädt
ausschließlich den in `settings.json` (`packages`) gepinnten Git-Fork unter
`~/.pi/agent/git/github.com/daydaylx/pi-subagents`. Dieser Klon steht jedoch
tatsächlich auf einem älteren Commit (`2934a93`, 03.08.) als dem
konfigurierten Pin (`33b4ff1`, seit 15.08.) — die von Pi dokumentierte
Reconciliation (`pi update --extensions`/`--all`) auf den Pin-Commit fand nach
dem letzten Repin nie statt. `npm/node_modules/pi-subagents` (npm-Registry
0.34.0) ist ein unabhängiges, gleichnamiges Paket: eine gewöhnliche
Abhängigkeit von Auroras eigenem `npm/`-Testbaum, die von keiner echten `pi`-
Sitzung geladen wird. Beide Kopien tragen unabhängig voneinander denselben
Bug (verifiziert per Diff):

- `resolveEffectiveAcceptance()` bildet das Maximum aus explizitem und
  automatisch inferiertem Level (`inferLevel()`), außer der Aufrufer übergibt
  explizit `{level:"none", reason:"…"}` — das ist der einzige Pfad, der den
  Rangvergleich vollständig umgeht.
- Ein Aufruf mit explizit übergebenem `acceptance:"reviewed"` scheitert
  strukturell immer, weil `"reviewed"` einen `reviewer`-Agenten verlangt, den
  Aurora laut Entscheidung 011 bewusst nicht mehr hat.
- Auch ohne expliziten Wert eskaliert `inferLevel()` jeden Verifier-Task mit
  Risikowörtern wie „security"/„migration" im Text automatisch auf
  `"reviewed"`, und praktisch jeden anderen Verifier-Task (Diff-
  Beschreibungen enthalten fast immer Wörter wie „fix"/„implement"/„update")
  auf `"checked"` — beide Level verlangen Evidenz (Reviewer-Verdikt bzw.
  `tests-added`), die ein read-only Verifier strukturell nie liefern kann.
  `verifier` steht nicht in der `readOnlyAgent`-Ausnahmeliste des Pakets.
- Belegt in der Session-JSONL: ein Lauf mit explizit übergebenem
  `acceptance:"attested"` scheiterte trotzdem an „tests-added evidence
  missing from child report" — ein reines Verbot von `"reviewed"` hätte
  diesen Fall nicht verhindert.

Aurora erkennt solche Läufe bereits korrekt als `INCOMPLETE`
(`extensions/setup-core/subagent-output-guard.ts`, Entscheidung 015), aber es
gab keinen präventiven Guard, der einen von vornherein garantiert
scheiternden Lauf vor dem Timeout abfängt.

## Statusupdate (21.08.2026)

Die vorstehende Paket-Drift ist historischer Kontext. Der von `pi list`
geladene Checkout steht inzwischen auf dem aktuell in `settings.json`
gepinnten Commit `54c701242710b1dab39a47f23ef8020f40b82bd4`. Die
Verifier-Erzwingung bleibt dennoch bewusst unabhängig von Paketversion und
paketinternen Konfigurationsoptionen.

## Entscheidung

`extensions/permissions/verifier-policy.ts` (`assessVerifierDelegation()`)
überschreibt `input.acceptance` für jede Single-Mode-Verifier-Delegation
bedingungslos auf `{level:"none", reason:"…"}`, unabhängig davon, was der
Aufrufer übergeben oder weggelassen hat. `event.input` ist laut
`@earendil-works/pi-coding-agent`-Typdefinition mutierbar; die Guard-Schicht
patcht damit den Tool-Aufruf, bevor das Paket ihn verarbeitet — analog zum
bereits genutzten Interceptor-Muster in `extensions/permissions/guards.ts`.

Als Nebeneffekt liefert `formatAcceptancePrompt()` bei `level:"none"` einen
leeren String: Der `## Acceptance Contract`-Abschnitt wird dem Verifier-Task
nie mehr injiziert. Damit entfallen alle drei beobachteten Fehlerursachen
strukturell gemeinsam, nicht nur die explizite `"reviewed"`-Eskalation.

Zusätzlich (defense-in-depth, nicht Voraussetzung für die Wirksamkeit):
`agents/verifier.md` listet die vom Paket erwarteten Enum-Werte für
`criteriaSatisfied[].status` und `commandsRun[].result` explizit auf, falls
der `## Acceptance Contract`-Pfad je wieder aktiv werden sollte.

## Konsequenzen

- Die Erzwingung ist unabhängig von der installierten `pi-subagents`-Version
  wirksam — sie greift vor dem Executor, nicht innerhalb des Pakets.
- Sie schließt sowohl die explizite als auch die implizite
  `inferLevel()`-Eskalation, weil `level:"none"` mit `reason` der einzige
  Pfad ist, der den `LEVEL_RANK`-Maximalwertvergleich umgeht.
- Der `verifier` kann weiterhin `PASS`/`PASS_WITH_WARNINGS`/`FAIL`/
  `UNVERIFIABLE` liefern; nur das paketinterne, redundante
  Acceptance-Report-Gate entfällt.

## Revision von Entscheidung 015 und der A2-Annahme

Entscheidung 015 („Alternativen") und `.agent/plans/current-plan.md`
(Annahme A2, lokale Planungsdatei, nicht versioniert) hatten eine Reparatur
der Subagenten-Paketinstallation bewusst als „separaten Folgeschritt außerhalb
des Auftrags" ausgeklammert, mit der Begründung, eine Erzwingung dürfe nicht
an der installierten Paketversion hängen. Diese Entscheidung bleibt für die
**generelle** Paket-Drift (fehlende Security-Härtung in
`acceptance.verify[]`, wirkungsloses `toolSchemaMode: "harness"`) unverändert
gültig und offen.

Für den hier behandelten Fall ändert sich nichts an diesem Grundsatz: Die
Lösung liegt bewusst weiterhin ausschließlich in Auroras Guard-Schicht
(`verifier-policy.ts`), nicht im Paket — sie bestätigt damit den Ansatz aus
015, statt ihn zu revidieren. Eine Paketreparatur bleibt möglich und wurde für
diesen Auftrag vom Nutzer freigegeben, ist aber wegen der bereits vollständig
wirksamen Guard-Lösung nicht mehr zeitkritisch und wird separat gestaged. Für
die Live-Runtime besteht sie aus zwei unabhängigen Teilen:
`pi update --extensions`/`--all`, um den bereits konfigurierten, aber nie
reconciliierten Git-Klon auf den Pin (`33b4ff1`) nachzuziehen (behebt den
`reviewed`-Zweig), und einem weiteren Fork-Commit über `33b4ff1` hinaus für
den bislang ungegateten `writeTask`-Zweig samt erneutem Repin. Eine
Umstellung von `npm/package.json` auf die Git-Fork-Referenz beträfe dagegen
ausschließlich Auroras eigenen Testbaum, nicht die Live-Runtime — sie ist für
die Zuverlässigkeit der Live-Sitzungen wirkungslos, aber sinnvoll, damit
`npm run test`/`verify` dieselbe Codebasis prüfen wie die Live-Runtime.

## Alternativen

- **Nur `acceptance:"reviewed"` blocken** (analog zum bestehenden
  `turnBudget`-Verbot): Verworfen, weil die implizite `inferLevel()`-
  Eskalation auf `"reviewed"` (Risikowörter) und `"checked"` (jeder normale
  Schreib-Task) davon unberührt bliebe — empirisch belegt durch den
  `"attested"`-Fehlschlag in der Session-JSONL.
- **Paketreparatur zuerst** (`pi update --extensions` + Fork-Fix für
  `writeTask`): Verworfen als alleinige oder vorrangige Lösung, weil sie den
  `writeTask`-Zweig ohne einen zusätzlichen, noch zu schreibenden Fork-Commit
  ohnehin nicht abdeckt (der bestehende Fix von `33b4ff1` gated nur
  `reviewed`, nicht `checked`) und zusätzliches Risiko (Reconciliation eines
  produktiv genutzten Klons, neuer Fork-Commit samt Repin) ohne zusätzlichen
  Nutzen gegenüber der Guard-Lösung eingeführt hätte.
