# 020 — Ausdrückliche Planfreigabe, sitzungsbezogene Ablage, turnfester Modus

## Kontext

Der Planmodus funktionierte mechanisch, aber sechs Eigenschaften ließen sich
nicht verteidigen. Alle sind am Stand `7de55a2` belegt:

1. **Der Handoff war implizit.** `finishPlanningTurn` legte den Plan in
   `planHandoff`, und der nächste beliebige Work-Turn verbrauchte ihn
   (`plan-mode/events.ts`, `workPrompt(session.consumePlanHandoff())`). Der
   Wechsel nach `work` war damit selbst die Freigabe — auch dann, wenn die
   Nutzerin nur den Planmodus verlassen wollte. Eine Rückfrage oder ein
   Erklärungs-Turn konnte den Plan ebenso verbrauchen.
2. **Die Freigabe war an nichts gebunden.** Der Handoff war ein String im
   Speicher; wurde der Plan danach bearbeitet, gab es keine Stelle, die das
   bemerkt hätte.
3. **Der Plan war freier Systemprompt-Inhalt.** `${event.systemPrompt}\n\n
   <plan>${plan}</plan>` — autorenkontrollierter Text im Kanal mit der höchsten
   Autorität, ohne Bereinigung und ohne Größengrenze.
4. **Eine Datei pro Repository.** `.agent/plans/current-plan.md` war global.
   Zwei Sitzungen im selben Checkout überschrieben sich; das Rollback eines
   fehlgeschlagenen Turns schrieb den Plan einer *anderen* Sitzung zurück; jeder
   Planning-Turn hinterließ eine untracked Datei im Projekt.
5. **Time-of-check/Time-of-use beim Modus.** Die Guards lasen den Modus pro
   `tool_call` live. Die Runtime verteilt Shortcuts ohne Idle-Gate
   (`dist/modes/interactive/interactive-mode.js`: „Run handler async, don't
   block input"), ein Shift+Tab → Work mitten im Planning-Turn hob dessen
   Schreibsperre also sofort auf, während der Systemprompt dieses Runs weiter
   „implementiere nichts" sagte.
6. **Fail-open.** `requestWorkflowCapabilities` lieferte ohne Provider
   `{ mode: "work" }`. Eine nicht geladene Workflow-Extension degradierte die
   Permission-Schicht stillschweigend auf ihren freizügigsten Zustand.

Dazu kam ein siebter Punkt ohne Sicherheitsbezug: Schnellplan und
Architekturplan unterschieden sich nur in den vorgeschlagenen Überschriften, und
der Prompt sagte ausdrücklich, die Struktur sei „eine Empfehlung, keine
Validierungsregel". Zwei Modi, die man hinterher nicht unterscheiden kann, sind
ein Modus mit zwei Namen.

## Entscheidung

**Ausdrückliche, hashgebundene Freigabe.** Nach einem abgeschlossenen
Planning-Turn bietet die Oberfläche (Shift+Tab-Menü und `/plan-decide`) genau
drei Wege: ausführen, weiter planen, ohne Ausführung nach Work. Nur „Plan
ausführen" (`/plan-approve`) ist eine Freigabe. Sie hält den SHA-256-Hash des
Plans, die Session-ID und den Prompt fest, den sie startet, und gilt nur für
diesen einen Turn, nur einmal, nur bei unverändertem Plan und nur in derselben
Sitzung. Die Zugriffsstufe bleibt unangetastet; Trust-, Recovery- und
Verifier-Gates gelten unverändert.

**Plan als Daten, nicht als Systemanweisung.** Der Systemprompt erhält nur
`PLAN_HANDOFF_RULES` — einen konstanten Text ohne Planinhalt. Der Plan selbst
reist als Custom-Message, die Pis Runtime für den Provider zu `role: "user"`
umwandelt und *hinter* die Nutzernachricht hängt. Der Inhalt wird bereinigt
(Kontrollzeichen entfernt, Begrenzer neutralisiert) und ist doppelt begrenzt:
64 KiB harte Ablehnung beim Schreiben, 24 KiB sichtbar markierte Kürzung beim
Einfügen.

**Sitzungsbezogene Ablage außerhalb des Arbeitsbaums.** Pläne liegen unter
`~/.pi/agent/plans/<workspace-key>/<session-id>.md` (via `getAgentDir()`).
Schreibvorgänge sind Compare-and-swap gegen den zuletzt gesehenen Hash.
`/save-plan` kopiert bewusst in den Workspace. Eine alte
`.agent/plans/current-plan.md` wird nur noch angezeigt, nie gelesen, nie
freigebbar.

**`plan_write` statt eines Lochs in der Schreibgrenze.** Der Agent schreibt den
Plan über ein eigenes Tool, das sein Ziel selbst besitzt. Damit hat der
Planmodus **keine** Schreibfläche mehr auf Projektdateien — die frühere
Ausnahme für `.agent/plans/current-plan.md` entfällt ersatzlos.

**Turnfester Modus.** Der Modus wird bei `before_agent_start` festgeschrieben;
Prompting und Guards lesen bis `agent_settled` denselben Wert. Eine Auswahl
während eines laufenden Turns wird sichtbar vorgemerkt und danach angewendet.

**Fail-closed statt `work`.** Ohne antwortenden Provider ist der Modus
`undefined` und wird so streng behandelt wie der Planmodus; nur in jedem Modus
lesende Tools bleiben frei, YOLO ist gesperrt, und die Blockmeldung benennt die
fehlende Workflow-Extension.

**Mechanischer Qualitätsunterschied.** `plan-quality.ts` erzwingt pro Modus
gefüllte Pflichtabschnitte (Architekturplan zusätzlich Nicht-Ziele,
Ausgangslage, Annahmen, Abhängigkeiten, Abschlusskriterien und mindestens zwei
Umsetzungsphasen). Ein Plan, der sie nicht erfüllt, wird nicht gespeichert.
„Optionen", „Empfehlung" und Migration bleiben optional, damit die Regel keine
künstlichen Alternativen erzwingt.

## Begründung

Die ersten sechs Punkte sind alle dieselbe Klasse Fehler: eine
Sicherheitseigenschaft, die nur gilt, solange niemand die naheliegende Sache
tut. Ein Handoff, den jeder Turn verbraucht; eine Freigabe, die an keinen Inhalt
gebunden ist; ein Modus, der sich mitten im Turn ändert; ein Default, der bei
Ausfall die Grenzen öffnet. Jede Ersetzung hier tauscht einen Appell gegen etwas
Prüfbares aus, und jede ist vor dem Executor entscheidbar und damit testbar.

Die Trennung von Freigabe und Zugriffsstufe ist die bewusste Abweichung von
Claude Code, das mit der Planfreigabe zugleich den Permission-Mode umschaltet.
Hier sind das zwei Konzepte: Eine Planfreigabe sagt *was* getan werden soll,
nicht *wie viel erlaubt ist*. Wer beides koppelt, macht „ich bin mit dem Plan
einverstanden" zu „ich hebe meine Sicherheitsstufe an".

Die Qualitätsprüfung ist absichtlich flach. Sie fragt, ob ein Abschnitt
ausgefüllt ist, nicht, ob der Text taugt. Natürliche Sprache lässt sich nicht
mechanisch validieren, und ein Validator, der es vorgibt, bringt dem Modell nur
bei, um ihn herum zu schreiben. Die fachliche Planqualität misst deshalb eine
getrennte Eval-Suite (`docs/plan-eval.md`), deren mechanische Kriterien
ausdrücklich **nicht** durch ein Modellurteil ersetzt werden dürfen.

## Konsequenzen

- Ein Wechsel nach `work` führt nichts mehr aus. Wer den alten Reflex hat, muss
  einmal zusätzlich „Plan ausführen" wählen.
- Ein Planning-Turn hinterlässt nichts mehr im Arbeitsbaum. Wer die Plandatei im
  Repository haben will, ruft `/save-plan`.
- Fehlt die Workflow-Extension, wird Pi sehr restriktiv statt sehr freizügig.
  Das ist die gewollte Richtung, kann aber wie ein Defekt aussehen; die
  Blockmeldung nennt deshalb die Ursache.
- Ein Plan, der die Mindestanforderungen seines Modus nicht erfüllt, wird
  abgelehnt statt gespeichert. Der Agent erfährt jeden fehlenden Abschnitt auf
  einmal und kann im selben Turn nachbessern.
- Der Frontend-Vertrag wächst um `workflow.pending` und `workflow.planReady`
  sowie die Commands `plan.decide` und `plan.approve`; `PROTOCOL_VERSION` steigt
  auf `1.1.0`. TUI und GUI konsumieren denselben Merge-Pfad, die Parität ist
  getestet.
- ADR [012](012-plan-mode-mutation-guard.md) wird in zwei Punkten korrigiert:
  die Plandatei ist kein Schreibziel mehr, und `verify({check:"typecheck"})` ist
  erlaubt (das war schon vor dieser Änderung so, nur falsch dokumentiert).

## Alternativen

- **Freigabe als Prompt-Präfix statt als UI-Aktion** („/go"): verworfen. Das ist
  das archivierte Legacy-System; ein öffentliches Kommando, das einen Plan
  ausführt, ist wieder ein Weg, den ein Turn versehentlich beschreitet.
- **Freigabe bleibt bis zum Verbrauch armiert, egal welcher Turn kommt**:
  verworfen. Genau das ist der Fehler, der ersetzt wird — nur der Turn, den die
  Freigabe selbst startet, darf sie verbrauchen.
- **Sitzungsbezogene Datei weiterhin im Projekt** (`.agent/plans/<session>.md`):
  verworfen. Löst die Kollision, aber nicht die Verschmutzung fremder
  Repositories.
- **Plan weiter im Systemprompt, nur escaped**: verworfen. Escaping macht Text
  im Anweisungskanal nicht zu Daten; die Runtime bietet einen echten Datenkanal.
- **Moduswechsel während eines Turns hart sperren**: erwogen und verworfen
  zugunsten des Vormerkens. Eine tote Taste erklärt sich nicht; ein sichtbar
  vorgemerkter Wechsel schon.
- **Plan-sichere Checks in einer Sandbox** (Phase 6 des Auftrags): verworfen,
  siehe `extensions/plan-mode/README.md`, Abschnitt „Prüfungen im Planmodus".
  Pi besitzt keine Worktree- oder Sandbox-Schicht; eine halbfertige Sandbox sähe
  nach einer Grenze aus, ohne eine zu sein.
