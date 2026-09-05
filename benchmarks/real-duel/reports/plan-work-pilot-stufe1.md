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
| Tokenverbrauch (fresh+cache_read) |          15.327 |          32.511 | +17.184 (×2,1) |       18.071 |                          131.879 | +113.808 (×7,3) |
| Toolfehler                        |               0 |               0 |              – |            1 | – (Report-Lücke, s. Abschnitt 9) |               – |
| Planqualität                      |               – |   – (kein Gate) |              – |            – |                    1/1 bestanden |               – |
| Ungeplante Änderungen             |               – |           keine |              – |            – |                            keine |               – |

### plan-work-pilot-01-task-catalog

| Kennzahl                          | Codex Work-only | Codex Plan→Work |               Δ |   Pi Work-only |     Pi Plan→Work |               Δ |
| --------------------------------- | --------------: | --------------: | --------------: | -------------: | ---------------: | --------------: |
| Funktional erfolgreich            |  PASS (Checker) |  PASS (Checker) |               – | PASS (Checker) |   PASS (Checker) |               – |
| Laufzeit (s)                      |           99,69 |          287,71 |  +188,02 (×2,9) |         543,12 |           520,49 |          −22,63 |
| Tokenverbrauch (fresh+cache_read) |          37.872 |          73.787 | +35.915 (×1,95) |         56.244 |          450.136 | +393.892 (×8,0) |
| Toolfehler                        |               0 |               0 |               – |              5 | – (Report-Lücke) |               – |
| Planqualität                      |               – |   – (kein Gate) |               – |              – |    1/1 bestanden |               – |
| Ungeplante Änderungen             |               – |           keine |               – |              – |            keine |               – |

Rohzeilen: [`results_stufe1.jsonl`](plan-work-pilot-stufe1/results_stufe1.jsonl).
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

Siehe Tabellen in Abschnitt 5. Zusammengefasst: Plan→Work kostet bei Codex
durchgehend ca. 2–4× mehr Wall-Time und ca. 2× mehr Tokens (plausibel: zwei
vollständig getrennte `codex exec`-Invocations statt einer, zweite mit
größerem Cache-Read-Anteil). Bei Pi ist der Zeit-Overhead uneinheitlich
(+45s beim Marker-Task, −23s bei der größeren Pilotaufgabe — kein Overhead,
teils sogar geringfügig schneller), der Token-Overhead dagegen mit ×7,3 bzw.
×8,0 deutlich höher als bei Codex. Toolfehler: Codex 0 in jeder Zeile; Pi
work-only 1 bzw. 5, Plan-Work-Zeilen zeigen aktuell keinen Wert (Report-Lücke,
Abschnitt 9).

## 9. Methodische Einschränkungen

- **n=1 pro Zelle.** Jede Zahl in Abschnitt 5/8 ist ein Einzellauf, keine
  Verteilung. Für belastbare Aussagen ist Stufe 2 (≥3 Aufgaben × ≥3 Trials)
  erforderlich, wie im Plan vorgesehen.
- **Reporting-Lücke bei Pi-Toolfehlern im Plan-Work-Pfad:** `report_plan_work.py`
  liest `tool_errors` aktuell aus dem (bei Plan-Work-Zeilen `None` gesetzten)
  `telemetry`-Feld statt aus `plan_phase_telemetry`/`work_phase_telemetry`;
  die Rohdaten selbst fehlen nicht (in den Event-Transkripten enthalten),
  nur die Aggregation im Report ist unvollständig.
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
massiv mehr Tokens (Pi: ×7–8), ohne im Blind-Review besser abzuschneiden —
tendenziell sogar leicht schlechter. **Für diese Aufgabenklasse ist der
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
