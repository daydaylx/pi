# Pi Session Audit – Aurora Activity UI

Stand: 2026-08-09 (aktualisiert nach Fortsetzung der Sitzung, siehe Nachtrag)
Geprüfte Sitzung: `sessions/--home-d-.pi-agent--/2026-08-09T02-24-06-566Z_019fe455-a7a6-71e0-9795-71a899598917.jsonl`
Geprüft von: Claude Code (Sonnet 5), als externer Beobachter der laufenden Pi-Sitzung
Scope: **Arbeitsweise/Tool-Nutzung des Pi-Agents**, kein Code-Review der resultierenden Änderung.

> Hinweis: Die auditierte Pi-Sitzung lief zum ursprünglichen Analysezeitpunkt
> (02:24–02:43 UTC) noch. Eine erste Fassung dieses Dokuments markierte
> Tests/Verify/Subagent-Nutzung deshalb als "nicht beobachtbar". Die Sitzung
> lief danach weiter (mit einer kurzen Prozessunterbrechung gegen 03:08–03:13
> UTC, danach unter neuer PID mit demselben Sitzungsprotokoll fortgesetzt) bis
> mindestens 03:15 UTC. Dieser Nachtrag ersetzt die ursprünglichen "nicht
> beobachtbar"-Aussagen zu Subagenten-Nutzung und Verifikation durch
> tatsächlich beobachtete Daten — siehe §3 und §4. Die finale Turn-Antwort und
> der letzte Politur-Stand bleiben weiterhin **nicht Teil dieses Audits**, da
> die Sitzung zum Zeitpunkt der Korrektur noch nicht final abgeschlossen war.

---

## 1. Sitzung rekonstruiert

| Phase | Zeit (UTC) | Was passierte |
|---|---|---|
| Auftrag + Planmodus-Constraint | 02:24:25 | Sehr detaillierter, 29-Punkte-Auftrag zur Aurora-Activity-UI. System erzwingt Planmodus: nur `.agent/plans/current-plan.md` darf geschrieben werden. |
| Recon (Skill) | 02:24:34 | Liest `skills/repo-analyse/SKILL.md` zuerst — sinnvoller Start. |
| Blockierter Bash-Call | 02:24:37 | `pwd && ls -la && git status ...` (verkettet) wird vom Planmodus-Guard abgelehnt ("nicht nachweislich rein diagnostisch"). Agent recovered sofort mit 3 einzelnen Befehlen. |
| Architektur-Recherche | 02:24:40–02:29:50 | 50 `read`- und 29 `bash`-Aufrufe (alle sequenziell, keine Subagenten, keine parallelen Tool-Batches außer 5 kleine Cluster). Liest Aurora-UI-Quellen, Pi-Extension-Docs, `pi-subagents`-Paketquellen, Testsuite. |
| Plansynthese | 02:29:56–02:33:19 | Zwei lange "Thinking"-Bursts mit je 8–10 benannten Zwischenschritten, dann `write` auf `current-plan.md` (11,8 KB). |
| Planbestätigung | 02:33:38 | Kurze, korrekte Abschlussmeldung: "Plan erstellt … Keine Implementierung oder Tests ausgeführt." |
| Freigabe | 02:34:06 | User: "plan ausführen" → Wechsel in WORKMODUS. |
| Implementierung (Runde 1) | 02:34:41–02:43:16 | Liest `pi-subagents`-Skill erneut, schreibt `tool-renderers.ts` komplett neu (+271/−31), editiert `index.ts` in 4 Schritten (1× Edit-Fehler durch nicht-eindeutigen `oldText`, korrekt recovered), aktualisiert `README.md`. Nach den Edits: zwei gezielte `lsp_diagnostics`-Aufrufe auf die geänderten Dateien. |
| Tests ergänzen | 02:43:19–02:46:33 | Baut den zugehörigen Testblock in `tests/suites/runtime.mjs` in mehreren `edit`-Schritten um. |
| Verifikationszyklus 1 | 02:46:36–02:48:03 | `verify(typecheck)` findet einen echten Typfehler (`SubagentInfo[]`-Zuweisung) → behoben → `verify(test)` zeigt 1 echten Testfehlfall → behoben → `verify(typecheck)` und `verify(test)` grün (678 passed). |
| Aufräumen + Formatierung | 02:48:15–02:50:24 | Entfernt toten Legacy-Testblock (`sed`-Löschung nach `rg`-Lokalisierung), entfernt ungenutzten Kompatibilitäts-Helfer, lässt Prettier über die geänderten Dateien laufen. |
| Selbstcheck | 02:50:36–02:50:52 | 3 parallele `lsp_diagnostics`-Aufrufe; ein zunächst gemeldeter Fehler entpuppt sich als veralteter LSP-Cache (durch `verify(typecheck)` bestätigt sauber). |
| Verifikationszyklus 2 | 02:50:52–02:53:23 | Erneuter `verify(typecheck)`+`verify(test)`-Durchlauf nach weiteren Test-Ergänzungen, 682 passed. |
| **Subagent: `verifier` (1. Lauf)** | 02:53:31–02:56:59 | Erst `subagent({action:"list"})`, dann `verifier` mit dem **vollständigen Original-Auftrag** als Task beauftragt. Bricht nach 12 Turns am Turn-Budget ab (Soft-Limit 10+2 Grace), **kein Ergebnis**. |
| **Subagent: `verifier` (2. Lauf)** | 02:57:32–03:01:31 | Erneuter `verifier`-Aufruf mit **kompakterer** Task-Formulierung. Liefert nach ~3,6 Min. ein substantielles `FAIL`-Urteil: asynchrone Subagenten verschwinden aus der Activity, bevor ihr reales `async-complete`-Event eintrifft — ein echter, von den grünen Tests nicht erfasster Fehler. |
| Fix + Regressionstest | 03:01:56–03:04:31 | Behebt den vom Verifier gefundenen Fehler in `index.ts` (1× weiterer Edit-Fehlversuch wegen Mehrdeutigkeit, korrekt recovered), ergänzt Test, `verify(typecheck)`+`verify(test)` grün (683 passed). |
| **`project_check({profile:"verify"})`** | 03:04:43–03:05:20 | Voller Verify-Durchlauf (Format, Typecheck, Deadcode, Coverage, Tests, Patch-/Audit-Checks) — **Exit 0, 34.164 ms**. |
| **Subagent: `verifier` (3. Lauf)** | 03:05:40–03:07:25 | Erneuter Versuch, den Fix unabhängig gegenzuprüfen. Bricht nach 16 Turns am Turn-Budget ab (Soft-Limit 14+2 Grace), **kein Ergebnis** — die Fix-Bestätigung bleibt damit ohne unabhängige Zweitmeinung. |
| Manuelle Nachprüfung | 03:07:40–03:13:xx | Nach dem zweiten Budget-Fehlschlag Rückfall auf manuelle Prüfung: `git status`/`git diff`, Lesen der Merge-Logik, weitere Test- und Renderer-Feinschliffe. |
| Prozessunterbrechung | ~03:08–03:13 | Sitzungsprotokoll pausiert für ~5 Minuten; danach unter neuer Prozess-ID fortgesetzt (gleiches Sitzungsprotokoll, User-Prompt "weiter"). Ursache nicht aus dem Protokoll ableitbar — **nicht beobachtbar**. |
| Weitere Politur | 03:13:39–mind. 03:15 | Prettier + `verify(test)` erneut angestoßen; Sitzung lief zum Korrekturzeitpunkt dieses Dokuments weiter. |
| Finale Antwort | — | **Nicht beobachtbar** zum Zeitpunkt dieser Korrektur. |

---

## 2. Tool-Nutzung

| Tool | Aufrufe | Bewertung |
|---|---|---|
| `read` | 50 | überwiegend sinnvoll gezielt (mit offset/limit), aber 2× vollständige Großdateien ohne Filterung |
| `bash` (meist `rg`/`find`/`git`) | 29 | funktional, aber Ersatz für native Tools in mehreren Fällen |
| `edit` | 3 | genutzt; 1 Fehlversuch wegen Mehrdeutigkeit, korrekt recovered |
| `write` | 2 | Plan-Datei + komplette `tool-renderers.ts`-Neufassung |
| `lsp_diagnostics` | ≥5 | sinnvoll genutzt, proaktiv nach Edits; 1 Fehlalarm durch veralteten LSP-Cache, korrekt via `verify(typecheck)` gegengeprüft |
| `grep` / `find` / `ls` (native Pi-Tools) | **0** | hätte genutzt werden sollen |
| `verify(typecheck)` / `verify(test)` | je 5 | systematisch nach jeder Änderungsrunde, deckte 1 echten Typfehler + 1 echten Testfehlfall auf |
| `project_check({profile:"verify"})` | 1 | voller Projekt-Verify-Lauf, Exit 0 nach 34 s |
| Subagent (`subagent`-Tool) | 4 (1× `list`, 3× `verifier`) | **1 echter Treffer** (fand realen Bug), **2 Abbrüche durch Turn-Budget ohne Ergebnis** — siehe §3 |

Auffällig: Der Agent liest an mehreren Stellen selbst die Quellcodes der eigenen
Such-Tools (`grep.ts`, `find.ts`, `ls.ts`, `bash.ts`) und dokumentiert sie sogar
explizit im eigenen Plan ("Die aktuellen Pi-Built-ins heißen `read`, `bash`,
`edit`, `write`, `grep`, `find` und `ls`") — nutzt sie danach aber in der
gesamten Sitzung kein einziges Mal, sondern bleibt durchgehend bei
`bash rg …` / `bash find …` / `bash ls -la`.

---

## 3. Subagenten

**Korrektur der ursprünglichen Fassung dieses Dokuments:** Die erste Version
behauptete, Rollen namens `investigator`/`debugger`/`verifier` existierten in
diesem Setup nicht. Das war falsch — ich hatte nur den vendorten
`pi-subagents`-Paketkatalog geprüft (`npm/node_modules/pi-subagents/agents/*.md`:
`context-builder`, `oracle`, `planner`, `delegate`, `researcher`, `reviewer`,
`scout`, `worker`), nicht das **projekteigene** `agents/`-Verzeichnis im
Repo-Root. Dort liegen exakt die drei im ursprünglichen Audit-Auftrag
angenommenen Rollen als Custom-Agent-Definitionen: `agents/debugger.md`,
`agents/investigator.md`, `agents/verifier.md` — jeweils read-only
(`tools: read, grep, find, ls[, bash]`), mit `defaultContext: fresh` und einem
festen Turn-Budget (`timeoutMs` 900–1200 s, Soft-Limit im laufenden Betrieb
sichtbar bei 10–14 Turns + 2 Grace-Turns).

**Tatsächliche Nutzung in dieser Sitzung: 4 Subagent-Aufrufe**, alle in der
zweiten Sitzungshälfte (nach der ersten Implementierungsrunde, nicht während
der Recherchephase):

1. `subagent({action:"list"})` — listet verfügbare Agenten auf (u. a. `debugger`,
   `investigator`, `verifier`). Sinnvoller erster Schritt.
2. `verifier`, Task = **vollständiger Original-Auftrag** (~4.300 Zeichen) →
   bricht nach 12 Turns am Soft-Limit (10+2) ab, **liefert keinen Bericht**.
   Kosten: ~90–130 s ohne verwertbares Ergebnis.
3. `verifier`, Task = **kompakte Zusammenfassung** (~2.000 Zeichen) → liefert
   nach ~3,6 Min. einen belastbaren `FAIL`-Befund: asynchrone Subagenten
   verschwinden aus der Aurora-Activity, sobald der Elternagent Text streamt
   oder seinen Turn beendet — **bevor** das reale `subagent:async-complete`-
   Event eintrifft. Der Bericht benennt exakte Codezeilen
   (`extensions/aurora-ui/index.ts:691–699`, `:710–717`), das reale
   Gegenstück im `pi-subagents`-Paket
   (`async-execution.ts:808–828`) und einen minimalen Korrekturvorschlag. Er
   erklärt zudem präzise, warum die grünen Harness-Tests das nicht gefangen
   hatten: sie modellieren keinen Text-Stream/Turn-Ende zwischen Start- und
   Complete-Event. **Das ist ein echter, wertvoller Fund, den reines
   "Tests grün" nicht geliefert hätte.**
4. `verifier`, nach dem Fix, Task = nochmals kompakter (~1.400 Zeichen) →
   bricht erneut ab, diesmal nach 16 Turns (Soft-Limit 14+2), **kein
   Ergebnis**. Der Hauptagent fällt danach auf manuelle Prüfung zurück
   (`git status`/`git diff`, gezieltes Lesen der geänderten Merge-Logik).

**Bewertung:** Der eine erfolgreiche Lauf ist ein starkes Beispiel für
sinnvollen, unabhängigen Subagent-Einsatz nach der Implementierung — er prüft
nicht "Tests grün", sondern den tatsächlichen Event-Lifecycle gegen die reale
Paketquelle und findet einen Fehler, den die eigene Testsuite nicht abdeckte.
Gleichzeitig zeigen 2 von 4 Aufrufen (50 %) ein reales Zuverlässigkeitsproblem:
Turn-Budget-Abbrüche ohne jedes Ergebnis, einmal sogar nach der Fix-Bestätigung
— die geforderte unabhängige Zweitmeinung zum Fix wurde in dieser Sitzung nie
eingeholt. Auffällig auch: Der erste, unkomprimierte Task (voller
Original-Auftrag) scheiterte; der zweite, kompakt formulierte Task gelang. Das
deutet darauf hin, dass Task-Länge/-Unschärfe direkt die Erfolgswahrscheinlichkeit
innerhalb des Turn-Budgets beeinflusst — der Hauptagent hat diese Lektion
zwischen Lauf 2 und Lauf 4 aber nicht konsequent weiter verschärft (Lauf 4 war
kompakter als Lauf 2, scheiterte aber trotzdem).

---

## 4. Main-Agent-Verhalten

**Aufgabenverständnis (stark):** Der Auftrag ist ungewöhnlich präskriptiv
(29 nummerierte Abschnitte, exakte Glyphen, exakte Footer-Reihenfolge). Der
Agent hat trotzdem nicht blind abgeschrieben, sondern reale Constraints
verifiziert und dabei zwei echte Probleme selbst entdeckt:

- Einen Zielkonflikt im Auftrag: Punkt 14 verlangt einen `✓ Verify`-Erfolgshaken,
  das strikte "nur transient, keine History"-Prinzip (Punkt 2) widerspricht dem.
  Der Plan löst das explizit auf, statt beides unreflektiert zu übernehmen.
- Einen bestehenden Architekturfehler: Die aktuelle Aurora-Implementierung löst
  bei Subagent-Events einen zusätzlichen RPC-Tool-Call aus — das verletzt die
  eigene Vorgabe "UI darf nichts auslösen" (Auftragspunkt 22) und wird im Plan
  korrekt zur Entfernung vorgesehen.

**Planung (angemessen):** Faktenbasiert, keine erfundenen Optionen, wo nur ein
sinnvoller Weg existiert — folgt der Planmodus-Instruktion korrekt.

**Implementierung (bisher scope-treu):** Von den zu Sitzungsbeginn bereits
vorhandenen, auftragsfremden Änderungen (`AGENTS.md`, root-`README.md`,
`workflow-policy.ts`, Plan-Mode-Dateien, `settings.json`, `diff.mjs`,
`e2e.test.mjs`) wurde keine einzige zusätzlich angefasst.

**Verifikation (stark, mit einer offenen Lücke):** Der Agent verifiziert
systematisch und mehrstufig statt nur einmal am Ende: `lsp_diagnostics` direkt
nach jedem Edit, `verify(typecheck)`+`verify(test)` nach jeder inhaltlichen
Änderungsrunde (5 Zyklen insgesamt, dabei 2 echte Fehler gefunden und behoben —
nicht nur grün abgenickt), ein voller `project_check(verify)`-Lauf vor dem
vermeintlichen Abschluss, und zusätzlich ein unabhängiger `verifier`-Subagent
zur Gegenprüfung gegen den Originalauftrag (siehe §3), der einen von den
eigenen Tests übersehenen echten Fehler fand. Die offene Lücke: Nach der
Reparatur dieses Fehlers scheiterte der erneute `verifier`-Aufruf zweimal am
Turn-Budget — die Sitzung schließt die Runde mit einem unabhängig
**unbestätigten** Fix ab und fällt auf manuelle Selbstprüfung zurück.

---

## 5. Effizienz — konkrete Befunde

**Befund 1 — Ripgrep gegen gitignorte Vendor-Verzeichnisse, ohne `.gitignore` zu prüfen.**
Vier fehlgeschlagene `rg`-Suchen nach `tool_execution_start|tool_execution_end`
in `npm/node_modules/...` liefern "(no output), exit 1" — jeweils leicht andere
Musterformulierung statt der eigentlichen Ursache (rg respektiert
`.gitignore`, und `npm/node_modules` ist offensichtlich ignoriert). Dasselbe
Muster wiederholt sich später bei der Suche nach `SUBAGENT_CONTROL_EVENT`,
bevor `--no-ignore` verwendet wird und sofort funktioniert.
→ Kosten: 6 leere Tool-Calls, ~1 Minute verlorene Zeit, Musterraten statt
Ursachenanalyse.
→ Bessere Vorgehensweise: Beim ersten leeren Ergebnis in einem offensichtlichen
Drittanbieter-Verzeichnis sofort `--no-ignore` probieren.

**Befund 2 — Zwei vollständige, ungezielte Großdatei-Reads.**
`docs/extensions.md` (Pi-eigene Extension-Doku) wird über zwei Reads praktisch
komplett eingelesen (~102.000 Zeichen), ebenso die `pi-subagents`-SKILL.md
(~51.000 Zeichen, teils zweifach). Zusammen mit weiteren Großdateien
summieren sich die reinen `read`-Ergebnisse in dieser Sitzung auf ~528.000
Zeichen (grob 130.000+ Tokens), bevor überhaupt eine Zeile Code geschrieben
wurde.
→ Bessere Vorgehensweise: Erst innerhalb der Datei gezielt grep'en, dann nur
den Treffer-Kontext lesen, oder die Recherche an einen `scout`-Subagenten mit
eigenem, verwerfbarem Kontext delegieren.

**Befund 3 — Edit-Fehlversuch durch nicht-eindeutigen `oldText`.**
Ein `edit`-Aufruf schlägt fehl ("Found 3 occurrences … must be unique"), weil
der gewählte Anker-Text mehrfach im File vorkommt. Recovery erfolgt korrekt,
kostet aber 2 Extra-Calls.

---

## 6. Fehlende Tool-Nutzung

- Native `grep`/`find`/`ls`-Tools existieren, wurden aber nie verwendet.
- Die projekteigenen `investigator`/`debugger`-Rollen (read-only, für genau
  diese Art Recherche gebaut) wurden für die ~5-minütige serielle
  Architektur-Recherche in der Planphase nicht eingesetzt — der `verifier`
  wurde später zwar genutzt, `investigator`/`debugger` in der gesamten
  Sitzung kein einziges Mal, obwohl `investigator` laut eigener Beschreibung
  ("Use when the relevant repository area, execution flow, dependencies, or
  change surface is unclear") exakt auf die Recherchephase dieser Sitzung
  zugeschnitten ist.
- `lsp_references`/`lsp_definition` wurden in der Recherchephase nicht
  genutzt, obwohl mehrfach Aufrufstellen von Symbolen per Text-Grep über
  mehrere Dateien gesucht wurden.
- Nach dem zweiten gescheiterten `verifier`-Lauf gab es keinen dritten Versuch
  mit nochmals reduziertem Scope (z. B. nur die eine geänderte Datei statt des
  gesamten Fixes) — der Hauptagent wechselte direkt zu manueller Prüfung, statt
  die aus Lauf 2 gelernte "kompakter = erfolgreicher"-Lektion konsequent
  weiterzutreiben.

---

## 7. Qualitätshebel (max. 5, alle aus dieser Sitzung abgeleitet)

1. **Recherchephasen an `scout`/`researcher` delegieren**, sobald absehbar
   mehr als eine Handvoll Dateien gelesen werden müssen — größter Hebel auf
   Kontext-Effizienz.
2. **Native `grep`/`find`/`ls`-Tools statt `bash`-Ersatzbefehlen verwenden.**
3. **Bei leerem `rg`-Ergebnis in Vendor-Verzeichnissen zuerst Ignore-Regeln
   prüfen**, statt Suchmuster zu variieren.
4. **Vor dem Lesen langer Referenzdokumentation erst innerhalb der Datei
   grep'en**, dann gezielt lesen.
5. **Subagent-Tasks kompakt formulieren, nicht den vollständigen
   Originalauftrag durchreichen.** Der erste `verifier`-Lauf mit dem vollen
   29-Punkte-Auftrag scheiterte am Turn-Budget; der zweite mit einer
   kompakten Zusammenfassung lieferte einen echten, wertvollen Bugfund. Bei
   einem erneuten Budget-Abbruch (wie beim dritten Lauf, nach dem Fix) lohnt
   ein weiterer Versuch mit noch engerem Scope, statt direkt auf manuelle
   Prüfung zurückzufallen.

---

## 8. Bewertung

| Bereich | Score | Begründung |
|---|---:|---|
| Aufgabenverständnis | 9/10 | Erkennt Zielkonflikt im Auftrag selbst und einen echten Architekturfehler, statt blind umzusetzen. |
| Planung | 8/10 | Faktenbasiert, keine erfundenen Optionen; etwas lange, zweigeteilte Denkphase. |
| Repository-Navigation | 6/10 | Findet am Ende alles Relevante, aber mit vermeidbaren Umwegen. |
| Tool-Auswahl | 5/10 | Native `grep`/`find`/`ls` komplett ungenutzt trotz Kenntnis ihrer Existenz. |
| Tool-Effizienz | 5/10 | Mehrere leere Wiederholungssuchen, ein Edit-Fehlversuch. |
| LSP-Nutzung | 6/10 | Gutes proaktives Self-Check nach Edits; in Recherchephase ungenutzt. |
| Subagent-Nutzung | 6/10 | 1 echter, wertvoller Treffer (`verifier` fand einen Bug, den Tests nicht fingen), aber 2 von 4 Aufrufen scheitern ergebnislos am Turn-Budget; `investigator`/`debugger` für die Recherchephase trotz Passung ungenutzt. |
| Implementierungsqualität | 8/10 | Scope sauber eingehalten; ein vom Verifier gefundener echter Fehler wurde behoben und regressionsgetestet; Fix selbst aber nie unabhängig re-verifiziert. |
| Verifikation | 8/10 | Mehrstufig und systematisch (5× Typecheck/Test-Zyklen, 1× voller `project_check verify`, 1 erfolgreicher unabhängiger Subagent-Check mit echtem Fund); Abzug, weil die Re-Verifikation des Fixes zweimal am Budget scheiterte und unbestätigt blieb. |
| Kontext-Effizienz | 4/10 | ~528.000 Zeichen Rohlektüre im Hauptkontext vor der ersten Code-Zeile. |
| Gesamteffizienz | 6/10 | Solide Grundrichtung mit echtem Qualitätsgewinn durch den Verifier-Fund; vermeidbare Umwege in Recherche und wiederholte Subagent-Budget-Fehlschläge drücken den Wert. |
| Erwartete Ausgabequalität | 8/10 | Vollständiger `npm run verify`-Durchlauf bestanden, ein von unabhängiger Prüfung gefundener echter Fehler wurde behoben; verbleibendes Risiko ist der unbestätigte Fix und der noch nicht final abgeschlossene letzte Politur-Schritt. |

---

## 9. Abschlussurteil

**A. Was macht der Agent bereits gut?**
Er verifiziert jede Behauptung gegen echten Code statt gegen Annahmen, benennt
einen Zielkonflikt im Auftrag statt ihn zu verstecken, hält Scope-Disziplin und
prüft eigene Edits proaktiv per LSP-Diagnose.

**B. Wo verschwendet er Ressourcen?**
~130k Tokens Rohlektüre für Referenzdokumentation statt gezielter Suche; sechs
leere `rg`-Aufrufe durch dieselbe gitignore-Falle an zwei unabhängigen
Stellen; zwei Edit-Fehlversuche durch unzureichenden Anker-Kontext; zwei von
vier Subagent-Aufrufen (~230 s Gesamtlaufzeit) endeten ergebnislos am
Turn-Budget.

**C. Welche Fähigkeiten/Tools nutzt er zu wenig?**
Native `grep`/`find`/`ls`-Tools (0 Aufrufe trotz Kenntnis), `lsp_references`/
`lsp_definition` während der Recherche (0 Aufrufe), die projekteigenen
`investigator`/`debugger`-Rollen für die Recherchephase (0 Aufrufe, obwohl
`investigator` exakt für diesen Zweck beschrieben ist). Der `verifier` wurde
genutzt — aber erst spät, und nach dem zweiten Fehlschlag nicht mit weiter
reduziertem Scope erneut versucht.

**D. Nutzt er Subagenten sinnvoll?**
Teilweise. Der `verifier`-Einsatz nach der Implementierung war fachlich
genau richtig platziert und lieferte in einem von zwei Läufen einen echten,
für die Tests unsichtbaren Fund (asynchrone Subagenten verschwinden vor ihrem
realen Abschluss-Event). Aber: `investigator`/`debugger` wurden nie genutzt,
obwohl die Recherchephase dafür geeignet gewesen wäre, und die Task-Framing-
Disziplin beim `verifier` war inkonsistent (voller Auftrag scheitert, knappe
Zusammenfassung gelingt, spätere knappe Zusammenfassung scheitert erneut) —
am Ende bleibt der wichtigste Fix der Sitzung ohne unabhängige Zweitbestätigung.

**E. Braucht das Setup zusätzlich einen Worker?**
Nein. `investigator`, `debugger` und `verifier` sind als projekteigene
Custom-Agents bereits vorhanden und funktionsfähig (der `verifier`-Erfolgslauf
belegt das). Das beobachtete Problem ist keine fehlende Fähigkeit im Setup,
sondern zweierlei Nutzungsverhalten: `investigator`/`debugger` werden trotz
Passung gar nicht aufgerufen, und der `verifier` wird mit inkonsistenter
Task-Kompaktheit beauftragt, was die Erfolgsquote gegen das feste Turn-Budget
senkt.

**F. Die drei wichtigsten Änderungen**
- **P1** — `investigator`/`debugger` für Recherche- und Diagnosephasen
  tatsächlich einsetzen, statt sie seriell im Hauptagenten zu erledigen —
  besonders da der `verifier`-Erfolgslauf beweist, dass Subagenten in diesem
  Setup echten Mehrwert liefern können.
- **P2** — Subagent-Tasks konsequent kompakt formulieren (Zusammenfassung
  statt vollständigem Originalauftrag) und bei Turn-Budget-Abbruch mit noch
  engerem Scope erneut versuchen, statt nach dem zweiten Fehlschlag auf
  rein manuelle Prüfung umzuschwenken.
- **P3** — Native `grep`/`find`/`ls`-Tools statt `bash`-Ersatzbefehlen
  verwenden, inklusive sofortiger `--no-ignore`-Prüfung bei leeren Treffern in
  Vendor-Verzeichnissen.
