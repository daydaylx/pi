# Plan→Work-Evaluation — Stufe 1 (technischer Pilot)

Basis: `f886b95f0d49ee04657ccf4f14312e6de888667c` (canonical repo clean,
`comparable=true` für alle 8 Läufe). Modell: `gpt-5.6-luna` (beide Kandidaten,
Reasoning: high). Vollständige Roh-Artefakte liegen neben diesem Bericht unter
[`plan-work-pilot-stufe1/`](plan-work-pilot-stufe1/) (Patches, Fingerprints,
Plantexte, `results.jsonl`-Auszug, die vier `list_tasks.py`-Implementierungen,
kleinere Transkripte). Ausgenommen: die beiden vollständigen Pi-RPC-Event-
Transkripte des Pilot-Tasks (7,2 MB / 6,5 MB, reines internes Event-Rauschen)
— siehe Abschnitt "Nicht committierte Rohdaten".

## 1. Implementierter Ablauf

Zwei Task/Workflow-Kombinationen, je 1 Trial, beide Kandidaten parallel:

| Task                                              | Workflow  | CLI-Aufruf                                  |
| ------------------------------------------------- | --------- | ------------------------------------------- |
| `smoke-01-marker-file`                            | work-only | `pi-duel smoke --workflow work-only`        |
| `smoke-01-marker-file`                            | plan-work | `pi-duel smoke --workflow plan-work`        |
| `plan-work-pilot-01-task-catalog` (neu, ungelöst) | work-only | `pi-duel run --task … --workflow work-only` |
| `plan-work-pilot-01-task-catalog` (neu, ungelöst) | plan-work | `pi-duel run --task … --workflow plan-work` |

= 4 Invocations, 8 Ergebniszeilen ([`results_stufe1.jsonl`](plan-work-pilot-stufe1/results_stufe1.jsonl)).
Implementierung: `benchmarks/real-duel/scripts/{pi_rpc_driver.py,codex_plan_work_driver.py,plan_work_gates.py,workflow_task.py}`,
verdrahtet in `pi-duel::_execute_plan_work`. Vollständiger Implementierungsplan:
`/home/d/.claude/plans/reactive-foraging-raven.md`.

Vor jedem echten Lauf wurde `plan_work_smoke.py` gegen echtes `pi` und `codex`
ausgeführt (17/17 Prüfpunkte PASS, siehe Abschnitt 3) — Pflichtvoraussetzung
aus dem Plan, um die RPC-Mechanik, Freigabepfade und Codex-CLI-Flags einmal
isoliert zu bestätigen, bevor Modellkosten in echte Task-Läufe fließen.

## 2. Unterschiede zwischen Pi und Codex

**Pi** besitzt einen nativen, dokumentierten Plan-Modus (`pi --mode rpc`,
`extensions/plan-mode/*.ts`): hashgebundene Freigabe (SHA-256 über Plantext +
Session), Plan-Speicherung über ein dediziertes `plan_write`-Tool (kein
freier Dateizugriff), formales Quality-Gate
(`extensions/plan-mode/plan-quality.ts`), Freigabe über den echten
`/plan-approve`-Slash-Command im selben durchgehenden Prozess.

**Codex** (codex-cli 0.149.1) hat **keinen** äquivalenten Mechanismus. Die
kleinste transparente Entsprechung: Turn 1 `codex exec -s read-only` (Doku +
Plantext, OS-Sandbox verhindert Schreibzugriff mechanisch), Turn 2
`codex exec resume <session-id> -c sandbox_mode=workspace-write -c
approval_mode=never` (Freigabe = einfach der nächste Turn in derselben
persistierten Session, **keine** kryptographische Bindung an den Plantext).
Das ist im Code (`codex_plan_work_driver.py`-Docstring) und hier explizit als
**Harness-Unterschied** ausgewiesen, nicht als gleichwertige Mechanik.

## 3. Verwendete Session- und Freigabeschnittstellen

- Pi: `pi --mode rpc` (JSON-Framing über stdin/stdout, dokumentiert unter
  `pi-coding-agent/docs/rpc.md`), Slash-Commands über `{"type":"prompt","message":"/…"}`.
- Codex: `codex exec --json` (Turn 1) / `codex exec resume <id> --json …` (Turn 2).
- Beide gegen **echte** Binaries smoke-getestet (`plan_work_smoke.py`,
  17/17 PASS in zwei Durchläufen — der erste Lauf zeigte zusätzlich, dass eine
  reine Ein-Datei-Trivialaufgabe Pi dazu bringt, gar keinen Plan zu schreiben
  und stattdessen direkt um Moduswechsel zu bitten; siehe Abschnitt 9).

## 4. Nachweis: keine Projektänderung vor Freigabe

Für alle 4 Plan-Work-Läufe lieferte `check_no_project_mutation_before_approval`
(`git status --porcelain` im jeweiligen Worktree unmittelbar vor der
Freigabe) ein leeres Ergebnis — Teil der in
[`results_stufe1.jsonl`](plan-work-pilot-stufe1/results_stufe1.jsonl) unter
`"gates"` protokollierten Gate-Zusammenfassung, `failed_required: []` in
allen 4 Zeilen. Zusätzlich stimmen die im Ergebnis aufgezeichneten
`plan_hash`-Werte exakt mit `sha256sum` der separat gesicherten Plantexte
überein (verifiziert):

- `smoke-01-marker-file`: `b5cfbf9f…` = [`plan_smoke_pi.md`](plan-work-pilot-stufe1/plan_smoke_pi.md)
- `plan-work-pilot-01-task-catalog`: `8eb970f3…` = [`plan_pilot_pi.md`](plan-work-pilot-stufe1/plan_pilot_pi.md)

Für Codex existiert kein Planhash (Abschnitt 2); dort belegt stattdessen der
Gate `no_project_mutation_before_approval` auf Basis der `-s read-only`-Sandbox
dieselbe Eigenschaft mechanisch stärker (OS-Sandbox statt Prompt-Konvention).

## 5. Work-only vs. Plan→Work

### smoke-01-marker-file

| Kennzahl                          | Codex Work-only | Codex Plan→Work |              Δ | Pi Work-only |                     Pi Plan→Work |               Δ |
| --------------------------------- | --------------: | --------------: | -------------: | -----------: | -------------------------------: | --------------: |
| Funktional erfolgreich            |            PASS |            PASS |              – |         PASS |                             PASS |               – |
| Laufzeit (s)                      |           32,05 |          128,52 |  +96,46 (×4,0) |        23,20 |                            68,54 |   +45,35 (×3,0) |
| Fresh Input                      |          14.697 |          28.361 |       +13.664 |       17.726 |                           21.811 |       +4.085 |
| Cache Read                       |          73.728 |         193.280 |      +119.552 |       44.544 |                          109.056 |      +64.512 |
| Output                           |             630 |           4.150 |        +3.520 |          345 |                            1.012 |         +667 |
| Cache Write                      |               0 |               0 |             – |            0 |                                0 |            – |
| Verarbeitete Tokens*             |          89.055 |         225.791 | +136.736 (×2,5) |       62.615 |                          131.879 | +69.264 (×2,1) |
| Toolfehler                        |               0 |               0 |              – |            1 | – (Report-Lücke, s. Abschnitt 9) |               – |
| Planqualität                      |               – |   – (kein Gate) |              – |            – |                    1/1 bestanden |               – |
| Ungeplante Änderungen             |               – |           keine |              – |            – |                            keine |               – |

### plan-work-pilot-01-task-catalog

| Kennzahl                          | Codex Work-only | Codex Plan→Work |               Δ |   Pi Work-only |     Pi Plan→Work |               Δ |
| --------------------------------- | --------------: | --------------: | --------------: | -------------: | ---------------: | --------------: |
| Funktional erfolgreich            |  PASS (Checker) |  PASS (Checker) |               – | PASS (Checker) |   PASS (Checker) |               – |
| Laufzeit (s)                      |           99,69 |          287,71 |  +188,02 (×2,9) |         543,12 |           520,49 |          −22,63 |
| Fresh Input                      |          34.337 |          63.324 |       +28.987 |       46.758 |       65.194 |      +18.436 |
| Cache Read                       |         211.712 |         660.736 |      +449.024 |      359.936 |      377.856 |      +17.920 |
| Output                           |           3.535 |          10.463 |        +6.928 |        9.486 |        7.086 |       −2.400 |
| Cache Write                      |               0 |               0 |             – |            0 |            0 |            – |
| Verarbeitete Tokens*             |         249.584 |         734.523 | +484.939 (×2,9) |      416.180 |      450.136 | +33.956 (×1,1) |
| Toolfehler                        |               0 |               0 |               – |              5 | – (Report-Lücke) |               – |
| Planqualität                      |               – |   – (kein Gate) |               – |              – |    1/1 bestanden |               – |
| Ungeplante Änderungen             |               – |           keine |               – |              – |            keine |               – |

Rohzeilen: [`results_stufe1.jsonl`](plan-work-pilot-stufe1/results_stufe1.jsonl).
\* Verarbeitete Tokens = Fresh Input + Cache Read + Cache Write + Output. Cache
wird separat ausgewiesen, weil er nicht dieselbe Kosten- oder Kontextsemantik
wie Fresh Input hat. Die frühere Zeile `Tokenverbrauch` mischte bei Work-only
Fresh Input + Output mit bei Plan→Work allen vier Komponenten und war daher
nicht vergleichbar.

"Funktional erfolgreich" ist hier **mechanisch** aus dem Checker abgeleitet
(nicht "TODO/Blind-Review" wie im generischen `report-plan-work`-Template),
weil `plan-work-pilot-01-task-catalog` — anders als die offenen `real-01`/
`real-02`-Aufgaben — einen objektiven Checker besitzt.

## 6. Planqualität und Plantreue

Pi bestand das formale Quality-Gate (`plan-quality.ts`) in beiden Läufen auf
Anhieb (1/1), ohne Rückfragen außerhalb der erlaubten Liste (leer) und ohne
Quality-Override. Plantreue (nicht: exakte Schrittreihenfolge, siehe
Arbeitsauftrag): in beiden Fällen wurde exakt die geplante Änderungssurface
getroffen (`benchmarks/real-duel/scripts/list_tasks.py` bzw. `SMOKE_OK.txt`),
keine ungeplanten Dateien, `forbidden_surface_untouched` bestanden. Codex hat
keine vergleichbare, mechanisch prüfbare Plantreue-Instanz (kein
Plan-Artefakt) — die Patches
([`patch_pilot_codex_plan.diff`](plan-work-pilot-stufe1/patch_pilot_codex_plan.diff))
zeigen aber ebenfalls exakt eine neue Datei, keine Streuung.

## 7. Funktionale Checkergebnisse + Blind-Review

Alle 8 Läufe: Checker `exit 0`. Für die Pilotaufgabe zusätzlich eine
**blinde** Code-Review (frischer Agent ohne Kenntnis von Kandidat/Workflow,
vier anonymisierte Implementierungen A–D) jenseits des mechanischen Checkers
— Fokus auf Randfälle, die der Checker nicht abdeckt (leeres
`tasks/`-Verzeichnis, kaputte `workflow.toml`, Task ohne `instruction.md`):

**Auflösung nach Review:** A = Pi Work-only, B = Codex Work-only,
C = Pi Plan-Work, D = Codex Plan-Work.

**Rangfolge des blinden Reviewers:** 1. A, 2. B, 3. D, 4. C.

- **A (Pi Work-only) und B (Codex Work-only)** behandeln Header und
  Zeilenwerte für die Spaltenbreiten-Berechnung in einer gemeinsamen Sequenz
  und bleiben bei leerem `tasks/`-Verzeichnis stabil.
- **C (Pi Plan-Work) und D (Codex Plan-Work) teilen denselben echten Bug:**
  `max(len(header), *(len(row[index]) for row in rows))` degeneriert bei
  `rows == []` zu einem einwertigen `max()`-Aufruf und wirft `TypeError` im
  menschenlesbaren Default-Modus — ein Verstoß gegen den in `instruction.md`
  geforderten "muss ebenfalls fehlerfrei laufen"-Kontrakt, den der Checker
  nicht abdeckt. C hat zusätzlich einen unnötigen `sys.path.insert`-Eingriff.
- Gemeinsame Schwäche aller vier: kein Abfangen von `tomllib.TOMLDecodeError`/
  `ValueError` bei kaputter `workflow.toml` in einem einzelnen Task-Verzeichnis
  (crasht mit vollem Traceback statt das Verzeichnis zu überspringen).

**Auffälligster Einzelbefund dieses Piloten:** Bei **beiden** Kandidaten
landete die Plan→Work-Implementierung in der Blind-Review-Rangfolge hinter
der jeweiligen Work-only-Implementierung — bei n=1 pro Zelle ein auffälliges,
aber statistisch nicht belastbares Muster (Abschnitt 9).

Volle Review: siehe Blind-Review-Transkript dieser Session (nicht separat
committet, da Teil der Konversation); Implementierungen liegen als
[`list_tasks_pi_work-only.py`](plan-work-pilot-stufe1/list_tasks_pi_work-only.py),
[`list_tasks_codex_work-only.py`](plan-work-pilot-stufe1/list_tasks_codex_work-only.py),
[`list_tasks_pi_plan-work.py`](plan-work-pilot-stufe1/list_tasks_pi_plan-work.py),
[`list_tasks_codex_plan-work.py`](plan-work-pilot-stufe1/list_tasks_codex_plan-work.py) bei.

## 8. Laufzeit-, Token- und Fehlervergleich

Siehe Tabellen in Abschnitt 5. Für die einheitlich aggregierten
verarbeiteten Tokens (Fresh Input + Cache Read + Cache Write + Output) liegt
Plan→Work bei Codex im Einzeltrial bei ×2,5 bzw. ×2,9 und bei Pi bei ×2,1 bzw.
×1,1. Damit ist insbesondere die frühere Aussage eines Pi-Overheads von ×7–8
widerlegt: Sie beruhte auf unterschiedlich aggregierten Tokenfeldern. Cache
Read bleibt separat, weil große Cache-Mengen weder direkt mit Fresh Input noch
mit Kosten gleichzusetzen sind. Bei Pi ist die Zeitdifferenz uneinheitlich
(+45s beim Marker-Task, −23s bei der größeren Pilotaufgabe); Toolfehler:
Codex 0 in jeder Zeile, Pi Work-only 1 bzw. 5. Pi-Plan→Work-Zeilen zeigen
aktuell keinen Toolfehlerwert (Report-Lücke, s. Abschnitt 9).

### 8.1 Pi-Work-only: fünf Toolfehler im Trace

Der Pi-Work-only-Lauf enthält 24 Toolcalls und genau fünf fehlgeschlagene
Calls. Weil `tool_execution_start/end` selbst keine Zeitstempel tragen, ist die
Spanne von der Assistant-Nachricht bis zum Toolresultat **keine reine
Toollaufzeit**: Sie enthält auch die Modellzeit zum Erzeugen des Calls. Wo ein
Tool selbst eine Dauer meldet, wird sie separat ausgewiesen.

| # | Call / sichere Argumente | Kategorie | beobachtete Call-Spanne | echte Tooldauer | beobachteter Retry / späterer Erfolg |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | `project_check`, `profile=verify` | Verification/Baseline | 95.436 ms | 68.775 ms | kein identischer Retry; späterer Task-Checker erfolgreich |
| 2 | `subagent`, `agent=verifier`, `context=fresh` | Contract/Schema | 34.214 ms | nicht messbar | zwei weitere Verifier-Versuche; letzter erfolgreich |
| 3 | `read`, `/home/d/.pi/agent/docs/subagents.md`, `offset=1`, `limit=240` | Permission/Path boundary | 28.551 ms | nicht messbar | ein weiterer `read` scheitert; späterer `grep`-Workaround erfolgreich |
| 4 | `read`, gleicher Pfad, `offset=1`, `limit=400` | Permission/Path boundary | 4.875 ms | nicht messbar | kein weiterer `read`; `grep`-Workaround erfolgreich |
| 5 | `subagent`, `agent=verifier`, `context=fresh` | Contract/Schema | 33.215 ms | nicht messbar | ein weiterer Verifier-Versuch erfolgreich |

Die fünf fehlerassoziierten Call-Spannen summieren sich auf **196.291 ms**,
sind aber aus dem genannten Timestamp-Grund nicht als reine verlorene
Toollaufzeit zu interpretieren. Der abschließend erfolgreiche Verifier meldete
zusätzlich selbst **189.045 ms** Laufzeit; seine beobachtete Call-Spanne betrug
229.207 ms. Für diese kleine Utility war kein verpflichtender Risikotrigger
belegt.

Ursachen und kleinste strukturelle Reaktion:

1. `project_check` scheiterte außerhalb des Task-Scopes an bereits vorhandenem
   Format-Drift in `renderer/index.html` und `renderer/styles.css`. Das ist ein
   fehlender sauberer Benchmark-Baseline-/Preflight-Nachweis, kein Fehler des
   Task-Patches.
2. Beide Verifier-Aufträge enthielten Ziel, Scope, vollständigen Diff, Baseline
   und Akzeptanzkriterien. Der Guard verlangte jedoch bytegenaue englische
   Marker und verwarf semantisch gleichwertige Markdown-/deutsche
   Überschriften. Der Contract-Guard akzeptiert nun eng begrenzte
   zeilenbasierte Varianten, ohne einen Pflichtblock entfallen zu lassen.
3. Die beiden Boundary-Reads waren Folgefehler: Nach der ersten
   Contract-Ablehnung sollte die verlangte Referenzdatei außerhalb des
   Benchmark-Worktrees gelesen werden. Wenn der erste vollständige
   Verifier-Auftrag akzeptiert wird, ist diese Recovery-Kette nicht mehr nötig;
   die Read-Sicherheitsgrenze bleibt unverändert.

Redundanz im beobachteten Trace:

- **0** byte-identische Wiederholungen,
- **3** Wiederholungen desselben Tool-/Ziel-Paars (zweiter Doku-Read und zwei
  weitere Verifier-Aufrufe),
- **0** identische Verifikationswiederholungen ohne zwischenzeitliche Mutation.

Der erste Write endete nach 43.272 ms. Der erste fachlich valide Patchzeitpunkt
ist rückwirkend **nicht bestimmbar**, weil zwischen Write und Abschluss kein
Checker an einen Workspace-Snapshot gebunden war. Er wird deshalb nicht aus
Zwischenaufrufen geschätzt.

Für künftige Pi-Work-only-Läufe erzeugt `scripts/pi-duel` einen begrenzten JSON-
Sidecar unter `tool-traces/`. `scripts/tool_trace.py` erfasst sichere
Argumentzusammenfassungen und Fingerprints, Fehlerkategorie, Retry-Kandidaten,
Wiederholungen, beobachtete Phasenspannen sowie den ersten Mutationserfolg. Freie
Prompts, Shell-Kommandos, Write-Inhalte und rohe Toolausgaben werden nicht in den
Sidecar kopiert. `time_to_first_valid_patch_ms` bleibt `null`; separat wird erst
ein nach Kandidatenende vom Task-Checker bestätigter Zeitpunkt gespeichert,
wenn Kandidaten- und Checker-Dauer beide vorliegen.

### 8.2 Nachinstrumentierungs-Smoke

Am 2026-09-05 wurde mit
`pi-duel smoke --candidate pi-real --workflow work-only --allow-dirty` ein
echter Pi-Lauf gegen `gpt-5.6-luna` ausgeführt (`run_id`
`smoke-01-20260905T220818`). Der Dirty-Override markiert ihn korrekt als
`comparable=false`; er fließt daher nicht in die Vergleichstabellen ein.

- Task-Checker: PASS, Exit 0
- Kandidatenlauf: 25,472 s; Checker: 0,144 s
- 4 Toolcalls, 0 Toolfehler, 0 exakte Duplikate, 0 wiederholte Ziele
- erster erfolgreicher Write nach 10.398 ms
- `time_to_first_valid_patch_ms`: `null`
- abschließend checker-bestätigter Zeitpunkt: 25.616 ms
- Sidecarpfad in `results.jsonl`: relativ
  (`tool-traces/smoke-01-20260905T220818_pi.json`)

Eine nachgelagerte Prüfung des tatsächlich geschriebenen Sidecars bestätigte,
dass weder der Write-Inhalt `real-duel-smoke-ok` noch ein `/home/d/`-Präfix
enthalten ist; Shell-Kommandos liegen nur als SHA-256 vor. Damit ist die zuvor
offene reale Persistenzstrecke für Pi Work-only einmal end-to-end belegt.

## 9. Methodische Einschränkungen

- **n=1 pro Zelle.** Jede Zahl in Abschnitt 5/8 ist ein Einzellauf, keine
  Verteilung. Für belastbare Aussagen ist Stufe 2 (≥3 Aufgaben × ≥3 Trials)
  erforderlich, wie im Plan vorgesehen.
- **Reporting-Lücke bei Pi-Toolfehlern im Plan-Work-Pfad:** Die
  Plan-/Work-Phasen der Pi-Ergebniszeilen enthalten noch keinen aggregierten
  `tool_errors`-Wert. Die Rohdaten liegen in den Event-Transkripten, müssen
  aber vor einer Summierung phasenweise normalisiert werden.
- **Tokenaggregation korrigiert:** `report_plan_work.py` summiert für beide
  Workflows nun je Komponente Fresh Input, Cache Read, Cache Write und Output
  und weist Cache Read separat aus. Die früheren, gemischten
  `Tokenverbrauch`-Zahlen werden nicht weiter interpretiert.
- **Codex-Telemetrie-Kumulativitätsannahme widerlegt:** in 2 von 2
  Plan-Work-Läufen negative Deltas bei `output`/`reasoning`/`tool_calls` —
  `turn.completed.usage` bei `codex exec resume` zählt vermutlich nur den
  neuen Turn, nicht die gesamte Session. Der bestehende
  `work_phase_cumulative`-Fallback liefert dennoch plausible Zahlen
  (in den Tabellen oben verwendet).
- **Trivialitätsschwelle für Pi's Plan-Schreibverhalten ist nicht scharf:**
  der `plan_work_smoke.py`-Pilotlauf zeigte, dass eine reine
  Ein-Datei-Aufgabe keinen Plan auslöste, während `smoke-01-marker-file`
  (ähnlich klein: eine Datei, eine Zeile Inhalt) im echten Lauf sehr wohl
  einen vollständigen, den Quality-Gate bestehenden Plan erzeugte. Modell
  (`gpt-5.6-terra` im Smoke-Test vs. `gpt-5.6-luna` im Pilot) und Kontext
  (isoliertes Scratch-Repo vs. voller Projekt-Worktree) unterscheiden sich
  zwischen beiden Beobachtungen — welcher Faktor ausschlaggebend ist, ist
  ungeklärt.
- **Ein Task, eine Aufgabenklasse:** `list_tasks.py` ist eine kleine,
  additive Utility-Aufgabe. Der Blind-Review-Befund (Plan-Work-Implementierung
  in beiden Fällen schwächer) könnte aufgabenspezifisch sein, nicht
  generalisierbar.
- **Kein Vergleich der Codex-Sandbox-Eskalationsfähigkeit:** `approval_mode=never`
  im Codex-Work-Turn lehnt jede Sandbox-Eskalation ab (Abschnitt 2) — für
  Aufgaben mit Netzwerk-/Installationsbedarf ist der aktuelle Codex-Treiber
  nicht einsetzbar, unabhängig vom Plan-Work-Vergleich selbst.

## 10. Verbleibende Risiken

- Der Pi-RPC-Pfad war vor diesem Piloten nur gegen einen selbstgebauten
  Fake-Server getestet; `plan_work_smoke.py` schließt diese Lücke, aber nur
  für die hier verwendeten, sehr kleinen Prompts — Verhalten bei sehr langen
  Plan-Turns (z. B. Compaction während der Planungsphase) ist ungetestet.
- Der Codex-Treiber verlässt sich auf `approval_mode=never` als gültigen
  Override-Wert für `-c` (empirisch bestätigt für codex-cli 0.149.1, Version
  nicht gepinnt gegen zukünftige Codex-Updates — ein Versionswechsel könnte
  den gültigen Wertebereich ändern, ohne dass der Treiber das erkennt).
- `pi_benchmark_befunde_arbeitsauftraege/` fordert, Real-Duel #003 mit
  möglichst unveränderter Methodik zu fahren; dieses Vorhaben ist ein
  bewusster, dokumentierter Vorgriff (Cross-Reference in
  `08_P2_planmodus_effizienz.md`), läuft aber technisch komplett getrennt
  (`--workflow plan-work` ist opt-in, Default unverändert).
- `plans/` (Pis Plan-Ablage) fällt in diesem Dev-Checkout mit dem Repo-Root
  zusammen und wurde erst während dieses Piloten als Dirty-Quelle entdeckt
  und nachträglich in `.gitignore` aufgenommen — frühere reale Läufe könnten
  unbemerkt denselben Effekt gehabt haben, ohne dass es aufgefallen wäre.

## 11. Empfehlung

Für **kleine, additive, gut spezifizierte Aufgaben** (wie diesen Piloten)
zeigt sich in n=1: Plan→Work verhindert hier keinen Fehler (beide
Work-only-Implementierungen waren bereits fehlerfrei und bestanden zusätzlich
die Blind-Review-Randfallprüfung), kostet aber deutlich mehr Zeit (Codex) und
mehr verarbeitete Tokens (Pi: ×2,1 bzw. ×1,1), ohne im Blind-Review besser
abzuschneiden — tendenziell sogar leicht schlechter. **Für diese Aufgabenklasse ist der
zusätzliche Aufwand auf Basis dieses einen Piloten nicht gerechtfertigt.**

Das ist ausdrücklich **keine generelle Aussage gegen Plan→Work**: die Aufgabe
war klein genug, dass ein Plan wenig zu leisten hatte (siehe Abschnitt 9,
Trivialitätsschwelle). Für die im Arbeitsauftrag genannten Aufgabenklassen,
bei denen Planung typischerweise Fehler verhindert (mehrdeutige Anforderungen,
mehrere Dateien mit Abhängigkeiten, Architekturentscheidungen, riskante
Bereiche), liegen aus diesem Piloten **keine Daten** vor — genau dafür ist
Stufe 2 vorgesehen: ≥3 unterschiedliche, echte Aufgaben unterschiedlicher
Komplexität, ≥3 Trials je Zelle, bevor eine aufgabenklassenspezifische
Empfehlung im Sinne des Arbeitsauftrags möglich ist. Vor einem Stufe-2-Lauf
sollte zusätzlich die Report-Lücke bei Pis Toolfehler-Aggregation
(Abschnitt 9) geschlossen werden.

## Nicht committierte Rohdaten

Die vollständigen Pi-RPC-Event-Transkripte der Pilotaufgabe
(`plan-work-pilot-01-task-catalog-20260905T132955_pi.txt`, 7,2 MB, und
`…-20260905T132022_pi.txt`, ebenfalls mehrere MB) wurden **nicht** in dieses
Verzeichnis kopiert — reines internes RPC-Event-Rauschen (Tool-Output,
Thinking-Deltas token-weise), kein zusätzlicher Erkenntnisgewinn gegenüber
dem bereits enthaltenen Plantext + Patch + Ergebniszeile, aber >13 MB
Repo-Bloat für beide zusammen. Lokal verfügbar unter
`~/.local/state/real-duel/obench-workspace/transcripts/`. Alle anderen
Artefakte (Patches, Fingerprints, Plantexte, Codex-Transkripte, Ergebniszeilen,
alle vier Implementierungen) sind vollständig beigefügt und auf
Secret-Muster geprüft (keine Treffer).
