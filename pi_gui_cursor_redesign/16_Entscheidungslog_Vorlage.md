# 16 – Entscheidungslog

Dieses Dokument während der Umsetzung fortführen.

## Vorlage

### Entscheidung 001

**Datum:**  
**Phase:**  
**Problem:**

**Optionen:** 1. 2. 3.

**Entscheidung:**

**Begründung:**

**Auswirkung:**

**Risiko:**

---

## Regeln

Nur relevante Architektur-/UX-Entscheidungen dokumentieren.

Keine trivialen Implementierungsdetails festhalten.

---

## Entscheidung 002

**Datum:** 2026-08-29
**Phase:** Phase 1 – Informationsarchitektur
**Problem:** Workflow und Modell erschienen dreifach (Header-Chip, Composer-Pill, Inspector-Zeile). Das Ziel-Header-Beispiel in `03_Phase_1_Informationsarchitektur.md` zeigt Workflow+Modell im Header; gleichzeitig fordert die Abschlusskriterien-Liste "erscheint maximal einmal permanent" und Regel 1 "bestehende Funktionen nur umpositionieren, nicht löschen".

**Optionen:**

1. Workflow/Modell nur im Header zeigen, Composer-Pills entfernen.
2. Workflow/Modell nur in den Composer-Pills zeigen, Header-Chips entfernen.
3. Header-Chips zu klickbaren Buttons machen (gleiche Aktion wie die Pills), Composer-Pills für Workflow/Modell entfernen; Denken-Pill bleibt (einzige Info, die sonst nirgends permanent sichtbar ist).

**Entscheidung:** Option 3.

**Begründung:** Das dokumentierte Ziel-Header-Beispiel ist normativ für den Header-Inhalt. Da Header und Composer beide dauerhaft sichtbar sind, kann nur einer der beiden Orte die Werte zeigen, ohne gegen "maximal einmal permanent" zu verstoßen. Die Header-Chips wurden zu Buttons mit denselben Klick-Handlern wie die vorherigen Pills gemacht (`openWorkflowPicker`/`openModelPicker`), sodass keine Interaktion verloren geht (Regel 1/8).

**Auswirkung:** `gui/renderer/index.html`, `gui/renderer/renderer.js`, `gui/renderer/styles.css`. Composer zeigt nur noch die Denken-Pill.

**Risiko:** Nutzer, die die Bedienung "Workflow/Modell im Composer wechseln" gewohnt sind, müssen nun in den Header greifen. Mausbedienung bleibt vollständig erhalten (Klick auf Header-Chip/Modell-Button), Tastatur-Shortcuts (Shift+Tab, Super+M) unverändert.

---

## Entscheidung 003

**Datum:** 2026-08-29
**Phase:** Phase 1 – Informationsarchitektur
**Problem:** Der Inspector war auf breiten Fenstern (>1080px) eine permanente Grid-Spalte, nur per Shortcut ausblendbar (`context-hidden`, Opt-out). Abschlusskriterium fordert "Inspector ist für normale Nutzung nicht permanent sichtbar" (Opt-in).

**Optionen:**

1. Breitenabhängigen Dual-Modus beibehalten, nur den Default auf "hidden" drehen.
2. Inspector bei jeder Fensterbreite einheitlich als Overlay-Drawer behandeln (Default: geschlossen), ausgelöst über Nav-Rail-Klicks, Header-Button oder Super+I.

**Entscheidung:** Option 2.

**Begründung:** Einheitliches Verhalten unabhängig von der Fensterbreite ist einfacher zu verstehen und zu testen als ein Dual-Modus mit zwei Klassennamen (`context-hidden` vs. `context-open`). Die Nav-Rail-Klicks (Änderungen/Agenten/Verifikation/Sitzungen) öffnen den Drawer bereits automatisch (bestehende `setActiveView`-Logik), sodass kein Funktionsverlust entsteht. Ein neuer Header-Button (`btn-toggle-inspector`) macht das Ein-/Ausblenden zusätzlich ohne Shortcut-Kenntnis entdeckbar.

**Auswirkung:** `gui/renderer/styles.css` (Grid auf 2 Spalten reduziert, `#context-area`/`#inspector-resize-handle` immer `position: fixed`), `gui/renderer/renderer.js` (`isNarrowLayout()` entfernt, `toggleContextArea()`/`setActiveView()` vereinfacht), `gui/test/renderer-contract.mjs` (Test auf `context-open` statt `context-hidden` aktualisiert).

**Risiko:** Das Ziehen der Inspector-Breite (`inspector-resize-handle`) ist jetzt immer nur im geöffneten Drawer-Zustand sichtbar/bedienbar statt als dauerhafte Spaltengrenze — funktional gleichwertig, aber nur bei geöffnetem Drawer nutzbar.

---

## Entscheidung 004

**Datum:** 2026-08-29
**Phase:** Phase 2 – Task Sidebar
**Problem:** Der Core kennt kein Task-Lifecycle-Feld (`FrontendTask` in `state-contract.ts` hat nur `title`/`phaseLabel`, kein `status` wie new/working/needs_input/…). Die GUI ist zudem strukturell Single-Session: nur die aktuell verbundene Sitzung hat einen laufenden Prozess und damit Live-State; alle anderen gespeicherten Sitzungen sind ruhende `.jsonl`-Dateien ohne Prozess. "Echtes" Multi-Task-ACTIVE (mehrere parallel laufende Agenten) existiert im Core nicht und ist laut Nicht-Zielen (`00_Ziel_Nichtziel_Annahmen.md`: kein neues Agenten-Harness, kein Multi-Agent-Grid als Pflicht) auch nicht vorgesehen.

**Optionen:**

1. Core um ein echtes Task-Status-Feld und Multi-Session-Prozessverwaltung erweitern (tiefer Core-Eingriff).
2. Task-Sidebar nur für die eine aktuell laufende Sitzung anzeigen, gespeicherte Sitzungen bleiben eine flache Liste ohne Status (kein echtes Statusmodell).
3. Status pro Sitzung aus bereits persistierten Daten ableiten: `frontend-bridge/state`-Einträge werden schon heute als Custom-Entries in jede Sitzungsdatei geschrieben (bestätigt durch Stichprobe in `sessions/**/*.jsonl`). Ein Tail-Read der Datei liefert den letzten bekannten Workflow-/Verifikations-/Changes-/Subagenten-Zustand; eine reine Präsentations-Heuristik (`deriveTaskStatus` in `interaction-helpers.js`) ordnet daraus ACTIVE/NEEDS INPUT/REVIEW/COMPLETED zu.

**Entscheidung:** Option 3.

**Begründung:** Verstößt nicht gegen R2 (Core schützen) und R6 (keine zweite Wahrheit) — es wird nichts Neues im Core gespeichert, nur bereits vorhandene, persistierte Zustände nachträglich gelesen und interpretiert. Erfüllt das 4-Gruppen-Statusmodell aus `02_Zielarchitektur_und_Statusmodell.md`, ohne eine Multi-Agent-Prozessarchitektur vorzutäuschen, die es nicht gibt. Die aktuell verbundene Sitzung nutzt den Live-State (`state.core`) statt des (potenziell leicht veralteten) Tail-Reads.

**Auswirkung:** `gui/main/ipc-handlers.js` (`readLastFrontendState`, Tail-Read mit 200KB-Obergrenze, R21-konform), `gui/renderer/interaction-helpers.js` (`deriveTaskStatus`, `relativeTimeLabel`, unit-getestet), `gui/renderer/renderer.js` (`buildTaskEntries`/`renderTaskSidebar`). Die frühere flache "Sitzungen"-Liste im Inspector wurde entfernt (ersetzt durch die Task-Sidebar, R6).

**Risiko:** Die Statuszuordnung für ruhende Sitzungen ist eine Heuristik, kein Core-Fakt — z. B. wird "Verifikation nie gelaufen, aber Änderungen vorhanden" pauschal als REVIEW eingeordnet, auch wenn der Task in Wahrheit z. B. bewusst gestoppt wurde. Eine ganz frische Sitzung ohne eigene Datei auf der Platte wird über einen synthetischen `__current__`-Sidebar-Eintrag sichtbar gehalten (siehe `buildTaskEntries`).

---

## Entscheidung 005

**Datum:** 2026-08-29
**Phase:** Phase 3 – Activity Stream
**Problem:** Die bisherige Aktivitätsdarstellung (Phase 6 der Vor-Redesign-GUI) fasste alle Werkzeugaufrufe eines Turns in EINER flachen Zeile zusammen ("✓ 8 Reads · ● 1 Shell"), unabhängig von ihrer inhaltlichen Bedeutung. `05_Phase_3_Activity_Stream.md` fordert stattdessen semantisch gruppierte Karten (reasoning/analysis/search/file_read/file_change/command/agent/verification/…). `extensions/aurora-ui/tool-renderers.ts` (TUI) hat bereits eine funktionierende, kanonische Klassifizierung von Werkzeugaufrufen (`classifyTool`), die exakt dieselbe Aufgabe löst.

**Optionen:**

1. Eigene, von der TUI unabhängige Klassifizierungslogik erfinden.
2. `extensions/aurora-ui/` importieren/wiederverwenden (verstößt gegen die dokumentierte Scope-Trennung GUI ↔ aurora-ui, `docs/scope-cli-tui-vs-gui.md`).
3. Die Klassifizierungs-_Semantik_ von `classifyTool`/`isVerificationCommand`/`isTestCommand` als eigenständige, reine Funktionen in `gui/renderer/interaction-helpers.js` nachbilden (kein Import, keine Abhängigkeit), reduziert auf die in `05_Phase_3...md` geforderten Renderer-Typen.

**Entscheidung:** Option 3.

**Begründung:** Vermeidet eine zweite, abweichende Kategorisierung derselben Werkzeugaufrufe (TUI würde einen Bash-Aufruf als "Test" erkennen, GUI aber anders labeln) und respektiert trotzdem die Scope-Trennung (kein Import aus `aurora-ui/`, keine Modul-Kopplung). Aufeinanderfolgende Aufrufe derselben Phase (explore/edit/verify/agent/command) werden zu einer Karte zusammengefasst; Titel + Kernzeilen liegen bewusst AUSSERHALB des aufklappbaren `<details>`-Elements (nur die Rohdaten je Aufruf sind versteckt), damit ein Fehler nie durch Zuklappen verschwindet (§"Fehler dürfen niemals wegaggregiert werden").

**Auswirkung:** `gui/renderer/interaction-helpers.js` (`classifyActivityKind`, `activityPhaseFor`, `ACTIVITY_PHASE_LABELS`, Bash-Heuristik portiert), `gui/renderer/renderer.js` (Aktivitätsgruppen durch `buildActivityCard`/`refreshActivityCard` ersetzt), `gui/renderer/styles.css` (`.activity-card` statt `.activity-group`), `gui/renderer/activity-summary.js` entfernt (durch die semantische Klassifizierung ersetzt, keine Karteileiche), Smoke-Test-Selektor (`__piGuiSmoke`) auf `.activity-card` aktualisiert.

**Risiko:** Ein realer Lauf hat bestätigt, dass fehlgeschlagene Schreib-/Bash-Aufrufe prominent (roter Rahmen, immer sichtbare Fehlerzeile) erscheinen (Screenshot vorhanden). Nicht geprüft: sehr lange Sitzungen mit zig Phasenwechseln (Performance-Beobachtungspunkt, aber strukturell nicht schlechter als die alte flache Zeile, da die Kartenzahl ≤ Anzahl der Werkzeugaufrufe bleibt). Historische Werkzeugaktivität aus geladenen (nicht laufenden) Sitzungen wird weiterhin nicht aus der Historie rekonstruiert (bereits vor Phase 3 so, keine Regression).

---

## Entscheidung 006

**Datum:** 2026-08-29
**Phase:** Phase 4 – Context Drawer
**Problem:** `06_Phase_4_Context_Drawer.md` listet den Inhalt des Drawers (Status/Workflow/Modell/Thinking/Context/Agenten/Changes/Sessioninformationen) — **ohne** einen Task-Titel-Eintrag — und verlangt zugleich "keine redundante Darstellung mit Header/Composer". Die bestehende Inspector-Zeile "Aufgabe" (aus der Vor-Redesign-GUI) dupliziert exakt den Task-Titel, der seit Phase 1 bereits prominent im Header steht.

**Entscheidung:** "Aufgabe"-Zeile aus dem Inspector entfernt; stattdessen eine neue "Status"-Zeile (Working/Bereit/Nicht verbunden) ergänzt, die im Content-Katalog von Phase 4 explizit gefordert ist und vorher fehlte.

**Begründung:** Workflow/Modell bleiben trotz Überschneidung mit Header/Composer im Drawer (so von Phase 4 verlangt) — der Drawer ist eine bewusst vollständige Referenzansicht, keine strikte "nirgends sonst gezeigt"-Liste. Der Task-Titel ist die einzige in der Liste fehlende, tatsächlich 1:1 redundante Information und wurde deshalb gezielt entfernt statt pauschal alles zu verdoppeln oder nichts.

**Auswirkung:** `gui/renderer/renderer.js` (`refreshContextOverview`-Rowdefs). Zusätzlich: `openContextDrawer()`/`closeContextDrawer()` mit Fokusmanagement (Fokus geht beim Öffnen in die erste fokussierbare Zeile, bei Escape/Schließen zurück zum auslösenden Element) und ein Escape-Handler in `setupShortcuts()`, der zurücktritt, wenn ein natives `<dialog>` offen ist.

**Risiko:** Keins identifiziert — durch echten Tab-/Escape-Test per Screenshot verifiziert (Fokus wandert sichtbar in „Workflow" → „Verifikation", Escape schließt und stellt den Fokus auf den Header-Button zurück).

---

## Entscheidung 007 (revidiert Entscheidung 002)

**Datum:** 2026-08-29
**Phase:** Phase 5 – Composer
**Problem:** Entscheidung 002 (Phase 1) hatte Workflow/Modell bewusst in den Header verlegt und aus dem Composer entfernt, mit Begründung "Header ist die einzige permanente Anzeige". `07_Phase_5_Composer.md` verlangt nun explizit das Gegenteil: Composer soll "Work ▾ Terra ▾ Thinking: High ▾ Senden" zeigen und ist als "Agent-Control-Point" konzipiert; Kriterium "Work/Plan direkt erreichbar" / "Modell direkt erreichbar" / "Thinking direkt erreichbar" bezieht sich ausdrücklich auf den Composer, nicht den Header.

**Entscheidung:** Workflow- und Modell-Steuerung ziehen vom Header zurück in die Composer-Pill-Reihe (neben die bereits dort vorhandene Denken-Pille); der Header verliert dadurch die beiden Buttons wieder und bleibt bei Brand/Projekt/Task-Titel/Permission-Warnung/Status/Aktionen. Dieselben Klick-Handler (`openWorkflowPicker`/`openModelPicker`) werden nur umgehängt, keine neue Logik.

**Begründung:** Phase 5 ist die spätere, spezifischere Vorgabe für den Composer und benennt explizit das Zielbild mit Work/Modell/Denken als Composer-Pills. "Maximal einmal permanent" (Entscheidung 002s Kernkriterium) bleibt erfüllt — es ändert sich nur, WELCHE Oberfläche die Werte zeigt, nicht dass es weiterhin nur eine gibt.

**Auswirkung:** `gui/renderer/index.html` (Header-Buttons entfernt, `#pill-workflow`/`#pill-model` in `#composer-pills` ergänzt), `gui/renderer/renderer.js` (`refreshCoreChips`/`refreshComposerPills`/Event-Listener umgehängt), `gui/renderer/styles.css` (verwaiste `button.chip`/`button.header-model`-Regeln entfernt). Zusätzlich: Composer-Placeholder wechselt bei laufendem Task zu "Anweisung an laufenden Task … (erst Stopp, dann senden)" (§Phase 5 "Laufender Task").

**Risiko:** Die ASCII-Mockup-Sektion "Laufender Task" in `07_Phase_5_Composer.md` skizziert zusätzlich eine Aktion "neue Anweisung" (impliziert: Senden während ein Task läuft). Das ist NICHT umgesetzt — `sendMessage()` blockiert weiterhin während `state.busy`, weil unklar ist, ob der Core-RPC-Layer ein zweites `prompt` während eines laufenden Turns überhaupt sinnvoll verarbeitet (kein Beleg gefunden, keine tiefe Core-Änderung ohne Klärung gemäß R2/R5). Das ist keines der geprüften Abschlusskriterien, daher als bewusste Scope-Entscheidung dokumentiert statt stillschweigend zu übergehen.

---

## Entscheidung 008

**Datum:** 2026-08-30
**Phase:** Phase 6 – Changes & Review
**Problem:** Die ASCII-Referenz in `08_Phase_6_Changes_Review.md` zeigt zwei nebeneinanderliegende Spalten (Dateiliste | Diff). Der Inspector ist seit Entscheidung 003 aber ein schmaler, wenn auch in der Breite verstellbarer Overlay-Drawer (`min(var(--inspector-w), 92vw)`), kein Editor-Grid — eine echte zweite Spalte würde entweder ein neues, vom übrigen Inspector abweichendes Layout-Konzept einführen oder gegen das Nicht-Ziel "kein vollständiger Editor" verstoßen. Zudem lagen die vollständigen Diff-Rohdaten (Hunks/Zeilen) bereits vor: `extensions/diff-viewer` schreibt sie als `diff-view`-Custom-Einträge in die Sitzungsdatei und veröffentlicht sie zusätzlich live über denselben `custom`-Eventkanal, den die GUI schon für `frontend-bridge/state` nutzt (bislang von `applyCoreEntry` stillschweigend verworfen).

**Optionen:**

1. Eine eigene, zweispaltige Diff-Editor-Ansicht bauen (neues Layout-Konzept, mehr Fläche als der Inspector-Drawer hergibt).
2. Nur Dateinamen auflisten (Ist-Zustand vor dieser Phase) und "Diff funktioniert" als nicht erfüllt dokumentieren.
3. Datei-Liste und Diff im bestehenden Inspector-Drawer vertikal kombinieren: jede Datei ein `<details>`-Element (Muster aus Entscheidung 005), Diff wird erst beim Aufklappen gerendert und aus den bereits vorhandenen `diff-view`-Rohdaten gespeist — live per Custom-Event für die aktuelle Sitzung, per neuem, schreibgeschütztem IPC-Kanal (`gui:getSessionDiffs`, liest nur bereits persistierte Einträge) beim Sitzungswechsel für zuvor entstandene Änderungen.

**Entscheidung:** Option 3.

**Begründung:** Vermeidet ein zweites Layout-Konzept neben dem etablierten Drawer (Regel 3: keine vorgezogene Arbeit, hier zusätzlich keine unnötige Layout-Verzweigung) und erfüllt trotzdem "Diff direkt erreichbar" vollständig, da echte Hunks mit farbig unterschiedenen +/-/Kontext-Zeilen angezeigt werden, nicht nur Dateinamen. Keine zweite Wahrheit (R6): `readSessionDiffs` bildet exakt dieselbe "letzter Eintrag pro Pfad gewinnt"-Semantik nach, die `ChangeTracker.changedFiles` im laufenden Prozess ohnehin verwendet, und liest ausschließlich bereits vom diff-viewer persistierte Daten — keine neue Core-Logik, keine eigene Git-Diff-Berechnung in der GUI. Performance ("große Diffs bleiben performant"): Diff-Inhalt wird pro Datei erst beim Aufklappen gerendert (lazy), auf 600 Zeilen je Datei und 60 Dateien je Ansicht gedeckelt, mit sichtbarer Kürzungszeile statt stillschweigendem Abschneiden.

**Auswirkung:** `gui/main/ipc-handlers.js` (`readSessionDiffs`, IPC-Kanal `gui:getSessionDiffs`, Tail-Read mit 1 MB-Obergrenze analog `readLastFrontendState`), `gui/main/preload.cjs` (`getSessionDiffs`), `gui/renderer/renderer.js` (`applyCustomEntry`/`applyDiffEntry` als neuer Verteiler für `custom`-Events statt des bisherigen alleinigen `applyCoreEntry`-Pfads, `renderChangesBody`/`renderChangedFileRow`/`renderFileDiffContent`/`renderDiffLineEl`, `state.fileDiffs`/`state.expandedDiffFiles`, `loadSessionDiffs()` beim Sitzungswechsel), `gui/renderer/styles.css` (`.diff-file`/`.diff-line`-Regeln), `gui/test/ipc-handlers.mjs` (zwei neue Tests für `readSessionDiffs`, inkl. echtem Session-Fixture-Format).

**Risiko:** Für die _aktuell verbundene_ Sitzung deckt der Live-Custom-Event-Pfad nur Änderungen ab, die entstehen, NACHDEM die GUI an den Pi-Prozess angebunden wurde — Diffs aus der Zeit davor (z. B. bereits vor einem GUI-Neustart erfolgte Änderungen derselben, fortlaufenden Sitzung) werden nicht rückwirkend nachgeladen, da kein API-Weg existiert, um den Dateipfad der aktuell laufenden Sitzung zu erfragen (get_state liefert nur `sessionId`/`isStreaming`/`model`/`thinkingLevel`, keinen Pfad). Bekannte, dokumentierte Lücke analog der in Entscheidung 004 akzeptierten Heuristik-Grenzen — kein Datenverlust beim regulären Sitzungswechsel (dort wird `getSessionDiffs` explizit nachgeladen), nur bei einem GUI-Neustart mitten in einer laufenden Sitzung. Der Tail-Read (1 MB) kann bei sehr langen Sitzungen mit vielen frühen Änderungen die ältesten Diffs auslassen (gleiche Klasse von Limitierung wie `TASK_STATE_TAIL_BYTES`).

---

## Entscheidung 009

**Datum:** 2026-08-30
**Phase:** Phase 7 – Verification
**Problem:** `09_Phase_7_Verification.md` verlangt u. a. "laufende Checks sichtbar" und "Details aufklappbar"/"Fehlerdetails erreichbar". `core.verification` (`FrontendVerificationSummary`, `extension:setup-core`) liefert aber nur das REDUZIERTE Ergebnis eines bereits ABGESCHLOSSENEN Laufs (`RequiredOutcome = success | failed | unavailable` je deklariertem Profil, `extensions/setup-core/verification-status.ts`) — kein Live-"läuft gerade"-Signal und keine Rohausgabe/Fehlermeldung je Check. Zusätzlich behandelte der bisherige GUI-Code `"unavailable"` (Timeout/Abbruch/fehlendes Binary — laut Core-Kommentar bewusst "distinct from a check that ran and said no") optisch identisch mit `"failed"` (beide `✗`), was dem Abschlusskriterium "abgebrochene Checks werden nicht als bestanden gewertet" zwar nicht widerspricht, aber "pass/fail/running/skipped sauber unterschieden" verletzt.

**Optionen:**

1. `FrontendVerificationSummary` um ein Live-"running"-Feld und Rohausgabe je Check erweitern (Core-Änderung in `extensions/setup-core`).
2. Nur den vorhandenen, bereits abgeschlossenen Zustand hübscher darstellen; "laufend" und "Details" als nicht erreichbar hinnehmen.
3. Beides rein in der GUI aus bereits vorhandenen Live-Ereignissen ableiten: `tool_execution_start`/`_end` fließen für JEDEN Werkzeugaufruf ohnehin schon in den Renderer (Activity Stream, Phase 3) und `interactions.classifyActivityKind` erkennt `verify`/`project_check`/verifizierende Bash-Kommandos bereits als `"verification"` — ein einfacher Zähler laufender Aufrufe dieser Art liefert "läuft gerade", ohne dass der Core je ein solches Signal senden müsste. Für Details: die volle Rohausgabe eines Verification-Laufs liegt bereits in der zugehörigen Tool-Card der Activity Stream (Decision 005 "Rohdaten bleiben zugänglich") — die Verification-Ansicht muss sie nicht duplizieren, nur dorthin verweisen (Sprung + Aufklappen).

**Entscheidung:** Option 3, zusätzlich ein eigener, vierter Marker (⚠, Label "kein Ergebnis (Timeout/Abbruch)") für `RequiredOutcome: "unavailable"`, klar getrennt von ✓ (success), ✗ (failed) und ○ (noch nie für diesen Snapshot gelaufen).

**Begründung:** Regel 2 (Core schützen) sagt ausdrücklich: keine tiefen Core-Änderungen, solange die GUI-Anforderung durch Presentation Layer lösbar ist — hier ist sie es vollständig, weil "laufend" nichts anderes ist als "ein bereits durchgereichtes Tool-Ereignis, dessen Ende noch nicht kam", und "Details" bereits an anderer Stelle (Activity Stream) vollständig vorhanden sind. Keine zweite Wahrheit (R6): der Laufend-Zähler bildet kein neues Fachwissen, sondern zählt nur, wie viele bereits als `"verification"` klassifizierte Aufrufe offen sind. Die vier separaten Marker erfüllen "pass/fail/running/skipped sauber unterschieden" wörtlich, ohne den Datenumfang zu beschönigen — ein Timeout sieht nie wie eine bestandene Prüfung UND nie wie eine inhaltlich abgelehnte aus.

**Auswirkung:** `gui/renderer/interaction-helpers.js` (`verificationOutcomeMarker`, reine Zuordnungsfunktion, unit-getestet), `gui/renderer/renderer.js` (`state.runningVerificationCalls`/`state.lastVerificationToolCallId`, Erweiterung von `tool_execution_start`/`_end`, `renderVerificationBody`, `jumpToVerificationDetails`, `verify`-Zeile im Übersichts-`rowDefs` zeigt "⏳ läuft …" auch ungeklappt), `gui/renderer/styles.css` (`.verify-running`, `.verify-details-btn`), `gui/test/renderer-helpers.mjs` (Marker-Test inkl. expliziter Prüfung, dass `"unavailable"` weder wie `✓` noch wie `✗` behandelt wird).

**Risiko:** Die "läuft gerade"-Anzeige kann keinem einzelnen deklarierten Check-Namen zugeordnet werden (nur "irgendeine Verifikation läuft") — ein `project_check`-Lauf, der mehrere Profile gleichzeitig prüft, zeigt keinen Fortschritt pro Profil, nur einen globalen Lauf-Indikator. "Details ansehen" springt zur zuletzt ABGESCHLOSSENEN Verification-Tool-Card, nicht spezifisch zu der Karte, die genau den fehlgeschlagenen Check verursacht hat, falls mehrere Verification-Aufrufe zwischen zwei Snapshots liefen (kein core-seitiger Check-ID↔Tool-Call-Zusammenhang verfügbar) — für den Normalfall (ein `project_check`-Aufruf pro Verifikationszyklus) korrekt, für seltene Mehrfachläufe eine bekannte Unschärfe.

---

## Entscheidung 010

**Datum:** 2026-08-30
**Phase:** Phase 8 – Startscreen
**Problem:** Der bisherige Leerzustand ohne Projekt (`#no-project`) war ein reiner Platzhaltertext ("Kein Projekt geöffnet." + ein Button), der Composer blieb deaktiviert — kein Taskstart ohne vorherigen Umweg über einen Ordner-Dialog. Zusätzlich blieb auch die Hauptfläche eines frisch geöffneten, aber noch nachrichtenlosen Projekts komplett leer (kein Text, kein Hinweis) — beides verletzt "keine leere Hauptfläche" (§10).

**Optionen:**

1. Nur den No-Project-Fall aufwerten (Mockup wörtlich), den zweiten Leerzustand (Projekt offen, keine Nachrichten) unverändert lassen.
2. Für beide Leerzustände dieselbe volle Startscreen-Box (Titel+Eingabefeld+Letzte Projekte) zeigen.
3. Zwei unterschiedlich schwere Zustände: No-Project bekommt die volle Startscreen-Box (Titel/Eingabe/Letzte-Projekte, da hier noch gar keine Eingabemöglichkeit existiert); ein bereits offenes, aber leeres Projekt bekommt nur einen ruhigen Text-Hinweis ("Was möchtest du tun?") in der Mitte der Chatfläche, OHNE zweites Eingabefeld — der echte Composer steht dort bereits am unteren Rand bereit.

**Entscheidung:** Option 3.

**Begründung:** Option 2 hätte zwei Eingabefelder gleichzeitig sichtbar gemacht, sobald ein Projekt offen ist (die neue Box UND den bestehenden Composer) — das widerspricht "visuell ruhig" und "kein Dashboard-Zwang" stärker als die Ersparnis an Code wert wäre. "Letzte Projekte" ist außerdem nur im No-Project-Fall sinnvoll sekundär (im offenen Projekt zeigt die Task-Sidebar bereits die "Letzte Tasks"-Funktion aus Phase 2, eine zweite Liste wäre redundant, R6-Geist auch für UI-Darstellung). Für "neuer Task sofort startbar" ohne Umweg: das Startscreen-Eingabefeld ist beim Rendern automatisch fokussiert, ein Absenden fragt bei Bedarf direkt den Ordner-Dialog ab und sendet den bereits getippten Text unmittelbar nach Sitzungsstart — kein "erst Projekt wählen, dann nochmal tippen".

**Auswirkung:** `gui/renderer/index.html` (`#startscreen` mit Titel/Eingabeformular/"Letzte Projekte"-Liste ersetzt den alten `#no-project`-Platzhaltertext; neues, separates `#chat-placeholder` als Geschwisterelement von `#chat`), `gui/renderer/renderer.js` (`renderNoProjectState`/`renderStartscreenRecentProjects`/`startTaskFromStartscreen`/`startProjectAndTask`/`updateChatEmptyHint`, Aufruf von `updateChatEmptyHint()` in `clearChat()`, `appendUserBubble()` und `scrollToBottom()`), `gui/renderer/styles.css` (`#startscreen`, `.startscreen-recent-row`, `#chat-placeholder:not([hidden])`).

**Risiko:** `startTaskFromStartscreen()` fragt bei jedem Absenden ohne vorherige Projektwahl den OS-Ordner-Dialog ab (keine Möglichkeit, "irgendein zufälliges Projekt" zu erraten) — ein Nutzer, der nur experimentieren will, muss immer erst einen Ordner bestätigen, auch wenn "Letzte Projekte" leer ist (Erststart). Das ist dieselbe Anforderung wie beim alten Verhalten (Ordnerwahl war schon vorher zwingend), also keine Regression, aber weiterhin ein zusätzlicher Klick vor dem ersten Task überhaupt.

---

## Entscheidung 011

**Datum:** 2026-08-30
**Phase:** Phase 9 – Visual Redesign
**Problem:** `11_Phase_9_Visual_Redesign.md` legt eine verbindliche Farbsemantik fest ("Primary → Violett", "Running → neutral/Blau", "Warning → Orange"). Der bestehende Design-Token-Satz aus Phase 1 verletzte das an zwei Stellen: `--accent` (Primary) war Blau statt Violett, und "läuft gerade"-Zustände (`.dot.busy`, `.activity-card.running`, `details.tool-card.running`, `.panel-line.verify-running`) nutzten `--warn` (Orange) statt einer eigenen "Running"-Farbe — eine laufende Prüfung sah damit optisch identisch zu einer echten Warnung aus. Zusätzlich unterschied sich der "läuft gerade"-Marker bei Activity-/Tool-Cards nur durch Farbe vom statischen Aufzählpunkt (gleiches "●"-Glyph), was gegen die Anforderung "keine Farbe als einziges Statussignal" verstößt.

**Optionen:**

1. Nur den Namen der Variablen anpassen, Werte unverändert lassen (Doku-Fix ohne visuelle Wirkung, verfehlt die Vorgabe).
2. `--warn` für Running weiterverwenden, nur `--accent` auf Violett ändern (Running/Warning bleiben nicht unterscheidbar).
3. `--accent` auf Violett ändern, neuen Token `--running` (Blau) einführen und an allen vier "läuft gerade"-Stellen statt `--warn` verwenden; zusätzlich das Running-Glyph bei Activity-/Tool-Cards von "●" (nur umgefärbt) auf ein eigenes Zeichen ("⋯", mit Pulse-Animation) ändern.

**Entscheidung:** Option 3. Der freigewordene alte Blauton (`#6ea8fe`, vorher `--accent`) wird 1:1 als `--running` weiterverwendet — bereits kontrastgeprüft, kein neuer ungetesteter Farbwert.

**Begründung:** Erfüllt die Farbsemantik aus §11 wörtlich und behebt einen echten, vorher unbemerkten Bug (Running sah wie Warning aus). Das eigene Running-Glyph (statt nur Farbe) erfüllt zusätzlich "keine Farbe als einziges Statussignal" für Nutzer, die Farbe schlecht unterscheiden können — vorher war der einzige Unterschied zwischen "läuft" und dem permanenten Aufzählpunkt links die Farbe.

**Auswirkung:** `gui/renderer/styles.css` (`:root`-Token-Block, `.dot.busy`, `.activity-card.running`, `details.tool-card.running`, `.panel-line.verify-running`).

**Risiko:** Keins identifiziert — reine Farbwert-/Glyph-Änderung ohne Struktur-/Verhaltensänderung, durch Test-Suite (10/10 grün) und visuelle Prüfung in der laufenden App abgedeckt.

---

## Entscheidung 012

**Datum:** 2026-08-30
**Phase:** Phase 9 – Visual Redesign
**Problem:** Nutzerwunsch (Zwischenmeldung während der Umsetzung): Farben insgesamt wärmer, zusätzlich Glasmorphismus für einen "modernen, hochwertigen" Eindruck. `11_Phase_9_Visual_Redesign.md` schreibt keine exakten Farbwerte vor ("exakte Farben" von Cursor ausdrücklich NICHT zu übernehmen) — die Statussemantik (§Entscheidung 011) ist aber verbindlich und bleibt unangetastet; "wärmer" wurde daher auf die Flächen-/Text-/Border-Neutraltöne angewendet (dominieren den Gesamteindruck), nicht auf die Statusfarben.

**Optionen (Farbtemperatur):**

1. Nur Akzentfarbe warm einfärben, Flächen/Text kühl lassen (Wärme kaum wahrnehmbar, da Flächen den Gesamteindruck dominieren).
2. Komplette Neutralpalette (bg/surface/text/muted/border) von kühlem Blaugrau (Hue ~215°) auf warmes Espresso/Taupe (Hue ~30°) verschieben, Statusfarben unverändert lassen.

**Entscheidung:** Option 2.

**Optionen (Glasmorphismus):**

1. `backdrop-filter: blur()` überall einsetzen, wo bisher `var(--surface)` stand (Header, Composer, Drawer, Dialoge, Activity-/Tool-Cards, Codeblöcke).
2. Nur auf Flächen, die tatsächlich ÜBER anderem Inhalt schweben (Inspector-Drawer als `position: fixed`-Overlay, Dialoge), echten Blur mit Transparenz einsetzen; dichte Leseflächen (Code/Diff/Rohdaten-Karten) bleiben opak, da Unschärfe unter Text die Lesbarkeit verschlechtert; Header/Composer erhalten nur eine getönt-transparente Fläche ohne eigenen Blur, weil dort im normalen Fluss nichts sichtbar "dahinter" liegt.

**Entscheidung:** Option 2.

**Begründung:** Glasmorphismus wirkt nur dort authentisch, wo tatsächlich etwas hinter der Fläche sichtbar/unscharf wird — Header und Composer überlappen im normalen Dokumentfluss nichts, ein Blur dort wäre nur Kosmetik ohne Funktion. Dichte Text-/Codeflächen (Diff-Zeilen, Tool-Rohausgabe) bewusst NICHT geglast, weil Kontrast/Lesbarkeit dort Vorrang vor Optik hat (§11 "Textkontrast ausreichend").

**Gefundenes Problem beim Test:** Der Inspector-Drawer (`position: fixed`, `bottom: 0`) überlappt vollständig die untere rechte Ecke des Composers (inkl. `button.primary`/"Senden") — das war bereits vor Phase 9 so (Entscheidung 003/006), nur bei opakem Drawer-Hintergrund unsichtbar. Mit `backdrop-filter: blur()` + `saturate(150%)` auf dem Drawer wurde die violette Primärfarbe des darunterliegenden Senden-Buttons durch den Drawer hindurch sichtbar — ein isolierter, unmotiviert wirkender Leuchtfleck (per Screenshot bei 1920×1080 reproduziert), da der Rest der Glasfläche keinen vergleichbar farbigen Inhalt dahinter hat. Kein Compositing-Bug, sondern die korrekte, aber zu intensive Wirkung von hoher Transparenz + Übersättigung. Behoben durch Erhöhen der Glas-Deckkraft (`--glass-bg` 66%→88%, `--glass-bg-strong` 78%→93%) und Reduzieren der Sättigungsanhebung (`saturate(150%)`→`saturate(115%)`) — Blur/Transparenz bleiben als Effekt erkennbar, ohne dass einzelne farbige Elemente dahinter als Fleck durchscheinen. Per Screenshot verifiziert (Fleck verschwunden, Drawer-Inhalt weiterhin klar lesbar).

**Auswirkung:** `gui/renderer/styles.css` (`:root`: `--bg`/`--surface`/`--surface-2`/`--surface-3`/`--text`/`--text-dim`/`--muted`/`--border`/`--border-soft` auf warme Werte, neue Tokens `--glass-bg`/`--glass-bg-strong`/`--glass-border`/`--glass-blur`/`--glass-shadow`; `#status-bar`, `#context-area`, `#composer`, `dialog`, `.dialog.ui-dialog`, `dialog::backdrop` auf die neuen Tokens umgestellt; `.banner-item`-Textfarbe von hartkodiertem Hex auf `color-mix(... var(--err) ...)` umgestellt).

**Risiko:** Glasmorphismus ist rechenintensiver als flache Flächen (`backdrop-filter` erzwingt eigene Compositing-Layer) — bei sehr langen Sitzungen mit häufigem Drawer-Öffnen/-Schließen nicht separat geprofilt (Testplan-Punkt "Drawer öffnen/schließen" unter Performance nur funktional, nicht per Framerate-Messung geprüft). Kein Layout-/Struktureingriff, daher geringes Regressionsrisiko für R2/R6. Die strukturelle Composer/Drawer-Überlappung selbst (Ursache des Leuchtflecks) wurde NICHT behoben — das wäre ein Eingriff in bereits abgeschlossene Phasen (1/4) und damit außerhalb des Scopes von Phase 9 (§Regel 3).

---

## Entscheidung 013

**Datum:** 2026-08-30
**Phase:** Phase 10 – Agentenintegration
**Problem:** `12_Phase_10_Agentenintegration.md` fordert eine "AGENTS"-Statusübersicht (Marker + Rolle + Zustand) und "klare Zuordnung von Activity zu Agent" im Activity Stream. Der Core liefert dafür bereits `core.subagents` (`FrontendSubagentBranch[]`: `agent`, `role`, `runId`, `status: "running"|"paused"|"needs_attention"|"queued"`, optionale `focus`/`progress`) — das war vor Phase 10 nur als reiner Textstring ("N aktiv") in der Inspector-Zeile "Agenten" sichtbar, ohne Marker/Farbe/Details, und die Activity-Stream-Karten für Subagenten-Werkzeugaufrufe trugen alle denselben generischen Titel "Subagent" (`ACTIVITY_PHASE_LABELS.agent`) — zwei verschiedene Subagenten-Rollen hintereinander verschmolzen dadurch zu einer Karte (`ensureActivityCard` gruppierte nur nach Phase, nicht nach Rolle).

Zusätzlich ergab die Code-Prüfung von `extensions/frontend-bridge/index.ts` (`subagentStartEvent`/`handleSubagentCompleted`/`handleSubagentAttention`): `role` ist dort identisch mit `agent` (kein separates menschenlesbares Label), `focus`/`progress` werden nie gesetzt, und der Status wird beim Start-Ereignis (`subagent:async-started`) fest auf `"queued"` gestellt und NIE zu `"running"` weitergeschaltet — für diese Quelle bedeutet `"queued"` also bereits "läuft im Hintergrund", nicht "wartet auf einen Startplatz". Abgeschlossene Läufe werden beim `"subagent:async-complete"`-Ereignis komplett aus der Liste entfernt (kein "fertig"-Zustand wird je persistiert).

**Optionen (Status-Übersetzung):**

1. Enum-Namen wörtlich übernehmen: `"queued"` → "Wartet" (entspricht dem Typnamen, widerspricht aber der tatsächlichen Bedeutung in diesem Core — ein bereits gestarteter, laufender Subagent würde als "wartend" erscheinen).
2. Tatsächliches Verhalten abbilden: `"queued"`/`"running"` beide → "Aktiv" (Running-Farbe), da beide für diesen Aufrufer real "läuft" bedeuten; `"needs_attention"` → eigene Warnfarbe (dieselbe wie Task-Status `needs_input`); `"paused"` → "Pausiert" (neutral).

**Entscheidung:** Option 2.

**Begründung:** Eine wörtliche Übersetzung des Enum-Namens ohne Rücksicht auf das tatsächliche Produzentenverhalten wäre eine irreführende Anzeige, keine ehrlichere (R6 verlangt keine zweite Wahrheit, aber auch keine blinde Eins-zu-eins-Übernahme eines internen Zustandsnamens, der laut Code-Kommentar in `frontend-bridge/index.ts` erkennbar ein grober Platzhalter ist — `focus`/`progress` existieren im Typ, werden aber nie befüllt). Farbsemantik konsequent nach Phase 9 (Entscheidung 011): Running = neutral/Blau, nicht Grün (noch nicht "erfolgreich fertig") und nicht Orange (kein Warnzustand).

**Umsetzung Activity Stream:** `ensureActivityCard`/`buildActivityCard` bekommen einen `groupKey`-Parameter zusätzlich zur Phase — bei `kind === "agent"` und `toolName === "subagent"` wird die Rolle aus `msg.args.agent` (bereits vorhandenes Tool-Argument, keine neue Datenquelle) als `groupKey` UND als Kartentitel (`agentDisplayLabel`, reine Großschreibung) verwendet. `gui/main/pi-rpc-manager.js` (`summarizeToolCall`) bekommt einen eigenen `"subagent"`-Fall für eine lesbare Zusammenfassung (`SUBAGENT scout: <Task gekürzt>`) statt des generischen Zwei-Schlüssel-Fallbacks. Fehlerdarstellung (rote Karte, ✗, "▸ Details") ist unverändert die bestehende generische Tool-Card-Logik (Decision 005) — automatisch korrekt pro Rolle, weil nur Titel/Gruppierung geändert wurden, nicht die Fehlererkennung.

**Umsetzung AGENTS-Status:** Bleibt bewusst Teil des bestehenden Inspector-Drawers (keine neue permanente Ansicht, §Regel "keine permanente separate Agenten-Konsole"/"keine Multi-Agent-Matrix als Standard") — Kollaps-Zeile zeigt bereits "N aktiv · M braucht Eingabe" ohne Aufklappen, aufgeklappt zeigt jede Zeile Rolle + `.pill`-Badge (neue Variante `.pill.running`, Running-Farbe, analog zu den bestehenden `.pill.ok/.err/.warn/.muted`). Bewusst KEINE eigene Zeile für "Pi" (den Hauptagenten) in dieser Liste ergänzt, obwohl das Mockup das zeigt — die Status-Zeile direkt darüber im selben Drawer zeigt bereits Working/Bereit; eine zweite Nennung wäre dieselbe Redundanz, die Entscheidung 006 für den Task-Titel bereits vermieden hat.

**Auswirkung:** `gui/renderer/interaction-helpers.js` (`agentDisplayLabel`, `subagentStatusPresentation`), `gui/renderer/renderer.js` (`ensureActivityCard`/`buildActivityCard` mit `groupKey`, `tool_execution_start`-Handler extrahiert `agentRole`, `renderRowBody` "agents"-Zweig, neue `agentsSummaryLabel`-Funktion, rowDefs "agents"-Wert), `gui/renderer/styles.css` (`.pill.running`), `gui/main/pi-rpc-manager.js` (`summarizeToolCall` "subagent"-Fall), Tests: `gui/test/renderer-helpers.mjs` (zwei neue Unit-Tests), `gui/test/renderer-contract.mjs` (ein neuer Struktur-Test für die Rollen-Trennung).

**Risiko:** Die "Aktiv"-Deutung von `"queued"` gilt nachweislich nur für den EINEN geprüften Core-Produzenten (`frontend-bridge/index.ts`); sollte eine andere/künftige Quelle `"queued"` tatsächlich als "wartet auf Startplatz" verwenden, wäre die Anzeige dort irreführend positiv. Kein Test konnte einen echten laufenden Subagenten erzeugen (bräuchte einen echten Modell-Zugriff) — Verifikation erfolgte über eine reale Electron-Instanz mit per Chrome-DevTools-Protocol injiziertem `state.core.subagents` und über den echten Event-Pfad (`handleEvent`) simulierten `tool_execution_start`/`_end`-Ereignissen (Screenshots vorhanden), nicht über einen Ende-zu-Ende-Lauf mit echtem Subagenten-Prozess. `focus`/`progress` aus `FrontendSubagentBranch` werden nicht angezeigt, da der einzige geprüfte Produzent sie nie befüllt — sollte eine Quelle sie künftig setzen, bräuchte die AGENTS-Zeile eine weitere Detailzeile (aktuell keine tote UI dafür vorgesehen, um keine leeren Felder zu zeigen).
