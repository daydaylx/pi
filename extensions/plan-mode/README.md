# Planmodus

`plan-mode` besitzt keinen Workflow-Lebenszyklus. Der Sessionwert ist entweder
`work`, `simple_plan` oder `detailed_plan` und wird nicht persistiert. Der
Workflowmodus und die Permission-Stufe bleiben zwei getrennte Konzepte: ein
Moduswechsel ändert die Zugriffsstufe nie, und eine Planfreigabe ebenso wenig.

Shift+Tab ist die zentrale Modusauswahl. Nach der Wahl steht der ausgewählte
Modus fest, aber es wird kein Agent-Turn gestartet; der Editor wartet auf die
nächste echte Nutzereingabe.

## Ablauf von der Planung bis zur Umsetzung

1. **Planen.** Shift+Tab → Schnellplan oder Architekturplan. Der nächste echte
   Nutzer-Turn erhält den Planning-Prompt. Der Agent untersucht das Projekt und
   hält das Ergebnis ausschließlich über das Tool `plan_write` fest.
2. **Entscheiden.** Nach einem abgeschlossenen Planning-Turn meldet Pi, dass ein
   Plan vorliegt. Shift+Tab zeigt dann zusätzlich „Fertiger Plan · entscheiden";
   dieselbe Entscheidung liegt auf `/plan-decide` und bietet genau drei Wege:
   - **Plan ausführen** — die ausdrückliche Freigabe (siehe unten),
   - **Weiter planen** — im Planmodus bleiben,
   - **Ohne Ausführung nach Work wechseln** — der Plan bleibt gespeichert, wird
     aber nicht ausgeführt.
3. **Umsetzen.** Nur „Plan ausführen" (auch direkt als `/plan-approve`) startet
   einen Work-Turn mit dem Plan als Arbeitskontext.

Ein bloßer Wechsel nach `work` führt **nichts** aus und verbraucht **keine**
Freigabe. Das ist der zentrale Unterschied zum früheren Verhalten, bei dem der
Moduswechsel selbst der Handoff war.

## Die Freigabe ist an den Planinhalt gebunden

Eine Freigabe hält den SHA-256-Hash des Plans, die Session-ID und genau den
Prompt fest, den sie startet. Sie gilt deshalb nur

- für **diesen einen** Turn — ein Erklärungs-, Review- oder Rückfrage-Turn
  dazwischen verbraucht sie nicht,
- **einmal** — ein zweiter Turn mit demselben Prompt erhält keinen Plan mehr,
- solange der Plan **unverändert** ist — wird er nach der Freigabe bearbeitet
  (externer Editor, neuer Planning-Turn), verfällt sie sichtbar,
- innerhalb **derselben Sitzung** — ein Neustart verwirft Freigabe und
  Bereitschaft, auch wenn die Plandatei noch existiert.

Die Freigabe hebt keine Sicherheitsgrenze auf: Die Zugriffsstufe bleibt
unverändert (insbesondere aktiviert sie nie YOLO), und Trust-Grenze,
Recovery-Gate sowie die Verifier-Pflicht für `git commit` gelten für den
Umsetzungs-Turn wie für jeden anderen.

## Wie der Plan den Agenten erreicht

Der Plan wird **nicht** als freier Markdown-Block in den Systemprompt
interpoliert. Der Handoff ist zweigeteilt (`plan-context.ts`):

- **Systemprompt:** nur `PLAN_HANDOFF_RULES` — ein konstanter Text ohne jeden
  Planinhalt. Er sagt, dass ein Datenblock folgt, dass dessen Inhalt Material und
  keine Anweisung ist und dass bei einem Widerspruch der aktuelle Nutzerauftrag
  gilt.
- **Daten:** der Plan als Custom-Message. Pis Runtime wandelt eine
  `role: "custom"`-Nachricht vor dem Providerrequest in `role: "user"` um
  (`dist/core/messages.js`, `convertToLlm`) und hängt sie **hinter** die echte
  Nutzernachricht. Der aktuelle Auftrag bleibt damit tatsächlich maßgeblich.

Der Planinhalt wird vorher bereinigt: Kontrollzeichen werden entfernt und die
Begrenzer `<<<PI-PLAN-DATEN>>>` / `<<<ENDE-PI-PLAN-DATEN>>>` werden im Inhalt
neutralisiert, damit kein Text sich als außerhalb des Blocks ausgeben kann.
Eingebettete Rollenmarker, `[PI PLANMODUS]`-Banner oder schließende Markup-Tags
bleiben sichtbar zitiert, verschieben aber die Anweisungshierarchie nicht.

Größen: `plan_write` weist einen Plan über `MAX_PLAN_BYTES` (64 KiB) hart ab —
kein halb gespeicherter Plan kann freigegeben werden. Beim Einfügen greift
zusätzlich `MAX_PLAN_CONTEXT_BYTES` (24 KiB); darüber wird an einer Zeilengrenze
gekürzt und die Kürzung **im Block benannt**, damit das Modell nicht glaubt, den
ganzen Plan gesehen zu haben. Ein freigegebener Plan wird genau einmal
eingefügt.

## Wo ein Plan liegt

Pläne liegen in der sitzungseigenen Ablage der Runtime:
`~/.pi/agent/plans/<workspace-key>/<session-id>.md` (über `getAgentDir()`, also
unter Berücksichtigung von `PI_CODING_AGENT_DIR`). Der `workspace-key` ist ein
Hash des Projektpfads.

Daraus folgt:

- **Parallele Sitzungen kollidieren nicht.** Zwei Pi-Sitzungen im selben
  Checkout haben getrennte Plandateien.
- **Ein Rollback trifft nur die eigene Sitzung.** Endet ein Planning-Turn mit
  Fehler oder Abbruch, wird ausschließlich die eigene Datei auf den Stand vor
  dem Turn zurückgesetzt.
- **Ein fremdes Repository wird nicht verschmutzt.** Ein Planning-Turn schreibt
  nichts in den Arbeitsbaum.
- Schreibvorgänge laufen als Compare-and-swap gegen den zuletzt gesehenen Hash.
  Hat der externe Editor den Plan zwischenzeitlich geändert, bricht `plan_write`
  ab, statt die fremde Änderung zu überschreiben.

`/save-plan` kopiert den Plan bewusst nach `.agent/plans/current-plan.md`, wenn
er im Repository liegen soll. `/edit-plan` öffnet den Sitzungsplan im sicheren
Host-Editor (`openExternalEditor`, keine Shell-Alternative) und verwirft danach
eine bestehende Freigabe.

Eine ältere `.agent/plans/current-plan.md` aus der Zeit vor der sitzungsbezogenen
Ablage wird von `/view-plan` **angezeigt**, ausdrücklich als alt markiert, und
sonst ignoriert: Sie wird nie eingelesen, nie freigebbar und nie ausgeführt.
Alte `.agent/plans/*.json`-Sidecars und Archive werden weiterhin ignoriert.

## Schnellplan und Architekturplan sind verschieden

Die Modi unterscheiden sich nicht nur in Überschriften. `plan-quality.ts`
erzwingt beim Schreiben pro Modus einen Mindestumfang; ein Plan, der ihn nicht
erfüllt, wird **nicht gespeichert**, und `plan_write` nennt jeden fehlenden
Abschnitt, damit der Agent im selben Turn nachbessern kann.

- **Schnellplan** verlangt Ziel, Vorgehen, Betroffene Bereiche, Verifikation und
  Risiken — jeweils mit eigenem Inhalt. Keine Alternativen, keine Phasen.
- **Architekturplan** verlangt zusätzlich Nicht-Ziele, Ausgangslage, Annahmen,
  Abhängigkeiten und Abschlusskriterien und gliedert „Umsetzung" in mindestens
  zwei benannte Phasen.

Optional und bewusst nicht erzwungen bleiben „Optionen", „Empfehlung" und eine
Migrations-/Rückfallstrategie: Sie gelten nur, wenn mehrere sinnvolle Wege
tatsächlich existieren. Eine Pflicht würde genau die künstlichen Alternativen
erzeugen, vor denen der Planning-Prompt warnt.

Die Prüfung ist absichtlich flach — sie fragt „ist der Abschnitt ausgefüllt?",
nicht „ist der Text gut?". Ob ein Plan fachlich taugt, misst die Eval-Suite
(`docs/plan-eval.md`), nicht dieser Gate.

## Durchsetzung

Der Kontext ist primär ein Prompt: ein Moduswechsel ändert die
Berechtigungsstufe selbst nicht, und Plan Mode ist keine allgemeine
Read-only-Sandbox. Technisch erzwungen sind die harten Secret-, System-,
Symlink- und Trust-Grenzen, die in jedem Modus gelten, und zusätzlich ein
Planmodus-Mutationsschutz (`planModeMutationGuard` / `planModeBashGuard` in
`extensions/permissions/workflow-policy.ts`).

Bei den Stufen `project-write` und `confirm-all` verweigert der Guard während
`simple_plan` oder `detailed_plan` **jeden** Schreibzugriff auf Projektdateien
— es gibt keine Ausnahme mehr für eine Plandatei im Projekt, weil dort keine
mehr liegt. Der Plan wird ausschließlich über `plan_write` geschrieben, und
dieses Tool besitzt sein Ziel selbst.

Erlaubt sind im Planmodus nur positiv bekannte Fähigkeiten: `read`, `grep`,
`find`, `ls`, `recovery_check`, `ask_user`, die lokalen LSP-Tools, die
read-only-Webtools (`web_search`, `fetch_content`, nur trusted wirksam),
`plan_write` — und `verify({ check: "typecheck" })`.

> **Zum Typecheck:** `verify({ check: "typecheck" })` ist im Planmodus
> ausdrücklich **erlaubt** (`planModeVerifyTypecheckAllowed`). Der Aufruf
> akzeptiert genau dieses eine Argument, läuft mit dem festen Typecheck-Kommando
> des Setups (`--noEmit`-Semantik) und schreibt nichts. `check: "test"`, jede
> andere `verify`-Form und `project_check` bleiben gesperrt, weil ein Testlauf
> Coverage- oder Snapshot-Dateien erzeugen kann. Frühere Fassungen dieser Datei
> und von ADR 012 behaupteten, `verify` sei vollständig gesperrt — das war
> falsch.

Für Bash gilt eine eng gehaltene Klassifikation
(`isPlanModeDiagnosticCommand`): `git status`/`diff`/`log`, `rg`, `find` (ohne
`-exec`/`-delete`/…) sowie eine kleine Gruppe reiner Lesewerkzeuge ohne
Skriptcharakter (`pwd`, `ls`, `cat`, `head`, `tail`, `wc`, `stat`, `du`, `df`,
`tree`, `sort`/`uniq` ohne `-o`). Kein Test, kein Lint, kein Build, kein
`git show` über Bash. Projekteigene Skripte (`npm`/`pnpm`/`yarn
run`/`test`/bare Skript-Aliase) werden nie allein am Namen als sicher
eingestuft, weil sie beliebigen Lifecycle-Code ausführen können.

Der zugrunde liegende Parser (`parseReadOnlyShell`, gemeinsam mit dem
`readonly`-Pfad genutzt) lässt keine Shell-Verkettung zu: weder `;` noch
`&&`/`||`/ein alleinstehendes `&` noch Redirections (`<`/`>`, auch nicht
`2>/dev/null`) — nur eine einzelne Pipeline aus `|`-verbundenen Segmenten,
jedes Segment einzeln geprüft.

`yolo` hebt diese Grenzen nicht auf; nur `readonly` reicht die Entscheidung an
die Zugriffsstufe weiter (dort ist ohnehin schon alles gesperrt). Der Guard
läuft ausschließlich für den Agenten (`tool_call`, das `bash`-Tool) — ein vom
Menschen selbst per `!`/`!!` eingegebener Befehl (`user_bash`) durchläuft ihn
nicht, da Plan Mode den Agenten am impliziten Implementieren hindern soll,
nicht den Menschen an der eigenen Tastatur. Details und Abwägung:
`docs/decisions/012-plan-mode-mutation-guard.md`.

## Der Modus steht für die Dauer eines Turns fest

Beim Turnstart (`before_agent_start`) wird der geltende Modus festgeschrieben.
Prompting **und** Tool-Guards lesen bis `agent_settled` denselben Wert
(`WorkflowSession.effectiveMode`). Eine Modusauswahl während eines laufenden
Turns wird sichtbar **vorgemerkt** („Architekturplan → Work vorgemerkt") und
erst nach `agent_settled` angewendet.

Das schließt eine reale Lücke: Die Runtime verteilt Shortcuts ohne Idle-Gate
(`interactive-mode.js`, „Run handler async, don't block input"), ein Wechsel
nach `work` mitten in einem Planning-Turn hätte dessen Schreibsperre also sofort
aufgehoben, während sein Systemprompt weiterhin „implementiere nichts" sagte.

Antwortet **keine** Workflow-Extension auf die Capability-Anfrage, meldet die
Brücke `mode: undefined` statt wie früher `work`. Die Permission-Schicht
behandelt das fail-closed: es bleiben nur die Tools erlaubt, die in jedem Modus
lesend sind; `plan_write`, der Investigator und `verify({check:"typecheck"})`
brauchen einen bestätigten Zustand, und YOLO ist gesperrt. Die Blockmeldung
benennt die fehlende Workflow-Extension, damit die Ursache sichtbar ist.

## Bewusste Abweichungen von anderen Produkten

Verglichen mit Claude Code (Plan Mode / Permission Modes), Cursor Plan Mode und
Codex; übernommen wurde nur, was hier trägt.

| Thema | Anderswo | Pi | Warum |
| --- | --- | --- | --- |
| Freigabe | Claude Code fragt nach dem Plan mit drei Optionen, Cursor hat „Click to build" | dieselben drei Optionen | Übernommen: der Dreiweg ist die richtige Form. |
| Freigabe ↔ Rechte | Claude Code schaltet mit der Freigabe die Permission-Mode um („Yes, and use auto mode") | Freigabe lässt die Zugriffsstufe unangetastet | Abweichung. Workflowmodus und Permission-Level sind hier getrennte Konzepte; eine Planfreigabe ist eine Aussage über *was*, nicht über *wie viel darf*. |
| Ablageort | Cursor speichert Pläne standardmäßig im Home-Verzeichnis, mit „Save to workspace" | genauso: Runtime-Ablage plus `/save-plan` | Übernommen; unabhängig zur selben Lösung gekommen. |
| Externer Editor | Claude Code: Ctrl+G öffnet den Plan im Editor | `/edit-plan` über den Host-Editor | Gleichwertig; kein Shell-Fallback, damit die Planmodus-Policy nicht umgehbar ist. |
| Shell im Planmodus | Claude Code lässt Kommandos per Klassifikator oder Nachfrage zu | feste Allowlist, keine Nachfrage | Abweichung. Ein Klassifikator wäre ein zweites Modell im Sicherheitspfad; die Allowlist ist direkt prüfbar. Siehe „Prüfungen im Planmodus". |
| Plan als Vertrag | Codex-ExecPlans führen `Progress`, `Decision Log`, `Outcomes` im Plan mit | Plan ist bewusst kein Statusdokument | Abweichung. Das alte `/go`-System hier war genau das und ist archiviert; Statusführung im Plan erzeugt Pflegeaufwand ohne Nutzen für einen Turn. |
| Plan-Werkzeug | Codex hat ein `update_plan`-Tool | `plan_write` | Übernommen: ein eigenes Tool ist der saubere Weg, ohne Loch in der Schreibgrenze. |

## Prüfungen im Planmodus (bewusste Grenze)

Während einer Planung wäre es manchmal nützlich, mehr als `typecheck` laufen zu
lassen — etwa einen einzelnen Test, um eine Annahme zu belegen. Umgesetzt ist
das **nicht**, und zwar bewusst.

Sicher wäre nur der volle Aufbau: deklarierte plan-sichere Checks, Ausführung in
einem temporären Worktree oder einer Wegwerf-Sandbox, feste Programme mit festen
Argumentlisten statt freier Shellstrings, dazu Trust-, Timeout- und Pfadgrenzen.
Diese Architektur besitzt Pi heute nicht: es gibt keine Worktree- oder
Sandbox-Schicht, auf der das aufsetzen könnte, und `verify`/`project_check`
führen Projektkommandos direkt im Arbeitsbaum aus. Eine halbfertige Sandbox wäre
schlechter als keine — sie sähe nach einer Grenze aus, ohne eine zu sein.

Der Planmodus bleibt deshalb bei der bestehenden Allowlist. `verify({ check:
"typecheck" })` ist genau der Fall, der ohne Sandbox sicher ist: festes Kommando,
`--noEmit`, kein Schreibvorgang. Wer mehr braucht, wechselt in den Arbeitsmodus
— das ist eine Nutzeraktion und damit sichtbar.
