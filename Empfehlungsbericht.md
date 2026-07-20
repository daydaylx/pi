# Empfehlungsbericht für `daydaylx/pi`

**Stand:** 20. Juli 2026  
**Gegenstand:** Welche Konzepte das bestehende Pi-Setup wirklich übernehmen, vereinfachen oder bewusst ablehnen sollte.

## 1. Gesamturteil

Das Repository ist nicht mehr nur eine Sammlung kleiner Pi-Anpassungen. Es ist bereits ein umfangreiches, eigenständiges Agenten-Setup mit:

- zentraler Konfiguration,
- technisch erzwungenen Workflow-Phasen,
- Plan- und Ausführungszuständen,
- Berechtigungsgrenzen,
- Subagenten,
- LSP,
- eigener Aurora-TUI,
- Compaction- und Checkpoint-Regeln,
- umfangreicher Testabdeckung.

Die grundlegende Richtung ist richtig. Das größte Risiko ist inzwischen nicht fehlende Funktionalität, sondern zunehmende Überkonstruktion:

- Konfigurationswerte liegen teilweise in mehreren Dateien,
- es existieren mehr Agentenprofile als praktisch nötig,
- die Standardparallelität ist für ein persönliches CLI-Setup hoch,
- der sichtbare Planworkflow ist komplexer als für den Alltag nötig,
- alte und neue Architekturdokumentation widersprechen sich teilweise,
- technische Tests messen noch nicht ausreichend die tatsächliche Arbeitsqualität des Agenten.

Die wichtigste Empfehlung lautet deshalb:

> Keine weitere breite Funktionsausweitung, bevor das bestehende System konsolidiert, vereinfacht und mit realen Coding-Aufgaben gemessen wurde.

---

# 2. Was unbedingt übernommen beziehungsweise umgesetzt werden sollte

## 2.1 Einen realen Qualitätsbenchmark einführen

### Empfehlung

Ein kleiner, reproduzierbarer Benchmark soll messen, wie gut das Pi-Setup reale Coding-Aufgaben löst.

Die erste Pilotphase sollte nur drei Aufgaben enthalten:

1. kleine präzise Ein-Datei-Änderung,
2. lokaler Bugfix mit fehlschlagendem Test,
3. kleine Multi-Datei-Änderung.

Erfasst werden sollten mindestens:

- Erfolg ohne Nachkorrektur,
- unnötig geänderte Dateien,
- verlorene Anforderungen,
- fehlgeschlagene Tool-Aufrufe,
- Edit-Wiederholungen,
- Test- und Build-Ergebnisse,
- Laufzeit,
- Tokenverbrauch,
- Subagentenaufrufe,
- benötigte Nutzerkorrekturen.

### Warum

Die vorhandenen Tests prüfen sehr gut, ob Extensions, Zustände und Sicherheitsregeln technisch funktionieren. Sie zeigen aber noch nicht zuverlässig, ob Pi Aufgaben besser löst oder ob neue Funktionen nur mehr Komplexität erzeugen.

Ohne Baseline kann später nicht objektiv entschieden werden, ob eine Änderung Qualität, Geschwindigkeit oder Stabilität verbessert.

### Priorität

**Sehr hoch.** Dies ist die Grundlage für alle weiteren Architekturentscheidungen.

---

## 2.2 `setup.json` zur einzigen fachlichen Konfigurationsquelle machen

### Empfehlung

`setup.json` soll die einzige Datei sein, die für die fachliche Pi-Konfiguration manuell gepflegt wird.

Dort sollen zentral liegen:

- UI und Motion,
- Permissions,
- LSP,
- Subagentenlimits,
- Modellrollen,
- Verifikationsprofile,
- aktive optionale Module.

`settings.json` darf weiterhin technisch notwendige Pi-Core-Werte enthalten. Doppelte Werte sollen jedoch generiert oder geprüft statt manuell mehrfach gepflegt werden.

### Warum

Aktuell überschneiden sich unter anderem:

- `setup.json`,
- `settings.json`,
- `extensions/subagent/config.json`,
- hartcodierte Defaults.

Das erhöht das Risiko, dass Modellrollen, Parallelität, UI-Zustand oder aktivierte Komponenten auseinanderlaufen.

### Konkrete Anforderung

`/setup-doctor` soll Abweichungen melden mit:

- erwarteter Wert,
- tatsächlicher Wert,
- zuständiger Eigentümer,
- sichere Korrekturmöglichkeit.

### Priorität

**Sehr hoch.** Konfigurationsdrift wird mit jeder weiteren Funktion teurer.

---

## 2.3 Den sichtbaren Workflow auf drei Hauptaktionen reduzieren

### Empfehlung

Die normale Bedienung soll nur noch drei Hauptaktionen in den Vordergrund stellen:

1. **Planen**
2. **Arbeiten**
3. **Prüfen und abschließen**

Die bestehenden internen Phasen dürfen erhalten bleiben:

- deciding,
- reviewing,
- executing,
- paused,
- blocked,
- ready.

Sie müssen aber nicht alle als gleichwertige Konzepte in der Hauptoberfläche erscheinen.

### Warum

Der Workflow ist technisch robust, aber für alltägliche Aufgaben inzwischen umfangreich:

- Schnellplan,
- Architekturplan,
- Decision Brief,
- Review,
- Ausführung,
- Plan-Todos,
- manuelle Completion,
- automatische Completion,
- Archive und Resume.

Die interne Sicherheit soll bleiben. Die Bedienung sollte jedoch einfacher werden.

### Zielverhalten

- kleine Aufgabe: direkt arbeiten,
- mittlere Aufgabe: kurzer Plan,
- große oder riskante Aufgabe: Architekturplan,
- unklare Entscheidung: Optionen klären,
- Abschluss: zentrale Prüfung statt verstreuter Einzelbefehle.

### Priorität

**Hoch.** Gute UX bedeutet hier weniger sichtbare Konzepte, nicht weniger technische Sicherheit.

---

## 2.4 Ein universelles Verifikations-Gate einführen

### Empfehlung

Jede Coding-Aufgabe soll vor dem Abschluss denselben zentralen Prüfprozess durchlaufen – unabhängig davon, ob sie mit Plan, direkt im Work-Modus oder durch einen Worker ausgeführt wurde.

Der Abschlussprozess muss mindestens:

1. den ursprünglichen Auftrag erneut prüfen,
2. den Diff-Umfang bestimmen,
3. unerwartete Dateien erkennen,
4. relevante Tests, Typecheck, Lint oder Build ausführen,
5. nicht erfüllte Kriterien nennen,
6. Restrisiken nennen,
7. Abschluss erlauben oder den Zustand auf `blocked` setzen.

### Warum

`plan_progress` verlangt bereits Nachweise pro Todo. Diese gute Idee sollte für alle Aufgaben gelten und nicht nur für den Planworkflow.

Das bestehende `verify`-Tool prüft das Pi-Setup. Zusätzlich wird eine vertrauensgebundene Projektverifikation benötigt, ohne freie Shell-Eingaben in einem Spezialtool zu erlauben.

### Technische Grundidee

Projektbezogene Verifikation wird als feste Liste aus Programm, Argumenten und Timeout gespeichert:

- typecheck,
- lint,
- test,
- build,
- optionale projektspezifische Checks.

### Priorität

**Sehr hoch.** Verifikation erhöht die tatsächliche Arbeitsqualität stärker als zusätzliche Agentenrollen oder UI-Funktionen.

---

## 2.5 Subagenten auf vier Kernrollen reduzieren

### Empfehlung

Standardmäßig aktiv und sichtbar bleiben nur:

### `scout`

- relevante Dateien finden,
- Projektstruktur untersuchen,
- Symbole und Abhängigkeiten identifizieren,
- read-only.

### `worker`

- klar abgegrenzte Implementierung,
- definierter Dateiscope,
- einziger normaler Schreibagent.

### `reviewer`

- finalen Diff prüfen,
- Fehler, Regressionen, Scope-Drift und fehlende Tests erkennen,
- read-only.

### `test-runner`

- ausschließlich freigegebene Prüfungen ausführen,
- kein freier Bash-Zugriff,
- keine Produktivdateien verändern.

`oracle` darf als explizit aufrufbare Sonderrolle für schwierige Architektur- oder Fehlersituationen bleiben.

### Was nicht als eigener Agent nötig ist

Diese Rollen sollten als Skills oder Review-Perspektiven umgesetzt werden:

- architect,
- planner,
- security-auditor,
- ui-reviewer,
- docs-auditor.

### Warum

Viele aktuelle Profile nutzen dieselben read-only Tools und unterscheiden sich hauptsächlich durch ihren Prompt. Das erzeugt zusätzliche Dateien, Auswahlmöglichkeiten, Dokumentation und Wartungsaufwand, ohne automatisch bessere Ergebnisse zu liefern.

### Priorität

**Hoch.** Weniger klar abgegrenzte Rollen verbessern Transparenz und Wartbarkeit.

---

## 2.6 Subagenten-Parallelität standardmäßig begrenzen

### Empfehlung

Neue Standardwerte:

- globale Parallelität: **2**,
- maximale Tasks pro Parallelauftrag: **4**,
- maximale Subagentenstarts pro Sitzung: **8 bis 12**.

Eine ausdrücklich aktivierte Burst-Stufe darf für read-only Recherche Parallelität vier erlauben.

### Zusätzliche Regeln

- maximal ein schreibender Worker pro Workspace,
- keine parallelen Worker ohne isolierte Worktrees,
- Reviewer erst auf stabilem Diff oder Snapshot,
- Test-Runner nicht gegen halb geschriebene Dateien laufen lassen.

### Warum

Vier parallele Agenten und bis zu 24 Starts pro Sitzung sind für ein persönliches CLI-Setup unnötig hoch.

Mehr Parallelität erhöht:

- API-Kosten,
- Providerprobleme,
- Terminalbelastung,
- Prozesskonkurrenz,
- schwer nachvollziehbare Fehler,
- konkurrierende Dateiänderungen.

### Priorität

**Hoch.** Einfach umzusetzen und mit geringem Risiko verbunden.

---

## 2.7 Dokumentation konsolidieren

### Empfehlung

Es soll nur drei aktive Dokumentationsebenen geben:

### `README.md`

- Zweck,
- Installation,
- Bedienung,
- kurzer Runtime-Überblick.

### `docs/ARCHITECTURE.md`

Einzige verbindliche Quelle für:

- aktive Extensions,
- UI-Eigentümer,
- Konfigurationsreihenfolge,
- Workflow,
- Permissions,
- Subagenten,
- LSP,
- Compaction,
- Verifikation.

### `docs/PROJECT_STATE.md`

Nur:

- aktuelles Ziel,
- aktuelle Phase,
- offene Fehler,
- letzte Verifikation,
- nächste Schritte.

### Warum

Aktuelle Dokumente beschreiben teilweise unterschiedliche UI-Eigentümer und frühere Komponenten. Solche Widersprüche verschlechtern nicht nur die Wartung, sondern auch den Projektkontext des Agenten.

Historische Audits und Vergleiche sollen archiviert und klar als nicht verbindlich markiert werden.

### Priorität

**Hoch.** Geringer Implementierungsaufwand, hoher Nutzen für Mensch und Agent.

---

## 2.8 Inaktive Altkomponenten und Dependencies entfernen

### Empfehlung

Nach einem stabilen Git-Tag sollen inaktive Komponenten geprüft und bereinigt werden.

Besonders zu prüfen:

- frühere Zentui-Komponenten,
- Tool-Display-Komponenten,
- Activity- und Thinking-Extensions,
- dauerhaft deaktivierte Renderer,
- nicht mehr verwendete npm-Pakete,
- alte Vergleichsimplementierungen.

### Warum

Git ist bereits der bessere Rückbau-Mechanismus. Dauerhaft mitgeführte Altimplementierungen erzeugen:

- falsche Suchtreffer,
- veraltete Dokumentation,
- unnötige Abhängigkeiten,
- größere Test- und Wartungsfläche,
- zusätzliche Sicherheitsrisiken.

### Regel

Keine pauschale Löschung. Für jede Komponente muss belegt werden, ob sie:

- aktiv,
- nur in Tests benötigt,
- oder vollständig ungenutzt ist.

### Priorität

**Hoch**, nach Konfigurations- und Dokumentationskonsolidierung.

---

# 3. Was danach gezielt ergänzt werden sollte

## 3.1 Bedarfsgesteuerte Repository-Übersicht

### Empfehlung

Ein optionaler Befehl wie `/repo-outline` soll bei großen oder unbekannten Repositories eine kompakte Orientierung erzeugen.

Inhalt:

- wichtige Module,
- Einstiegspunkte,
- zentrale Symbole,
- direkte Abhängigkeiten,
- relevante Konfigurationsdateien,
- wahrscheinliche Dateien für die aktuelle Aufgabe.

### Grenzen

- kein permanenter Vollindex,
- keine Vektordatenbank,
- keine dauerhaften Hintergrundprozesse,
- keine vollständige Analyse bei jeder Aufgabe,
- begrenzte Ausgabegröße.

### Warum

Eine kompakte Repo-Map kann Suchaufwand und Kontextverbrauch reduzieren. Für kleine Projekte wäre ein dauerhafter Index jedoch unnötig schwer.

### Priorität

**Mittel.** Erst nach Benchmark und Konsolidierung.

---

## 3.2 Regelbasiertes Modell-Routing

### Empfehlung

Die vorhandenen Rollen bleiben:

- `fast`,
- `primary`,
- `deep`.

Zuordnung:

### `fast`

- Suche,
- Dateiauswahl,
- Formatierung,
- einfache Konfiguration,
- Scout-Aufgaben.

### `primary`

- normale Implementierung,
- lokale Bugs,
- Standardtests,
- mittlere Multi-Datei-Aufgaben.

### `deep`

- Architektur,
- große Refactorings,
- schwierige Fehler,
- riskante Reviews,
- Oracle-Aufgaben.

### Warum

Regelbasiertes Routing ist nachvollziehbar, schnell und günstig. Ein zusätzliches Modell nur zur Entscheidung, welches Modell verwendet werden soll, wäre unnötig.

### Sichtbarkeit

Die UI soll immer zeigen:

- aktive Rolle,
- tatsächliches Modell,
- Provider,
- Thinking-Level,
- automatische oder manuelle Auswahl.

### Priorität

**Mittel.** Erst nach zentraler Konfiguration.

---

## 3.3 Doom-Loop-Erkennung

### Empfehlung

Pi soll wiederholte, offensichtlich erfolglose Aktionen erkennen.

Zu erkennen sind mindestens:

- identischer fehlgeschlagener Tool-Aufruf zweimal,
- gleiche Fehlerklasse dreimal ohne neue Information,
- gleicher Testfehler trotz unverändertem Code,
- mehrfach fehlgeschlagener Edit mit gleichem Suchmuster,
- wiederholtes Lesen ohne neue Begründung,
- Prozess-Timeout,
- Pendeln zwischen zwei identischen Zuständen.

### Reaktion

1. bisherige Strategie stoppen,
2. Wiederholung sichtbar melden,
3. bisherige Versuche zusammenfassen,
4. alternative Strategie verlangen,
5. Scout, Reviewer oder Oracle vorschlagen,
6. bei fehlender sicherer Alternative `blocked` setzen.

### Warum

Provider-Retries lösen Netzwerkfehler. Sie verhindern nicht, dass der Agent fachlich denselben falschen Versuch wiederholt.

### Priorität

**Mittel bis hoch.** Besonders nützlich bei schwerer Fehlersuche.

---

## 3.4 Edit-Fallbacks und Edit-Metriken

### Empfehlung

Keine neue AST-Plattform einführen. Stattdessen eine klare Fallback-Reihenfolge verwenden:

1. präzises `edit`,
2. bei fehlendem Match betroffenen Ausschnitt erneut lesen,
3. Suchmuster einmal präzisieren,
4. größeren strukturierten Patch verwenden,
5. vollständiges `write` nur für neue oder sehr kleine Dateien.

### Metriken

- Anzahl Edit-Versuche,
- fehlgeschlagene Matches,
- Patchgröße,
- vollständig ersetzte Dateien,
- notwendige Reparaturen,
- verwendetes Modell,
- Thinking-Level.

### Warum

Modelle unterscheiden sich stark darin, wie zuverlässig sie Search-and-Replace, Diffs oder vollständige Datei-Ausgaben erzeugen. Das sollte gemessen werden, statt pauschal ein komplexes Edit-System einzuführen.

### Priorität

**Mittel.** Umsetzung nach dem Benchmark, damit der Effekt messbar bleibt.

---

# 4. Was beibehalten, aber nicht weiter ausgebaut werden sollte

## 4.1 LSP

### Beibehalten

- lazy starten,
- nur in vertrauenswürdigen Projekten,
- keine automatische Installation,
- klare Projektpfadgrenzen,
- Timeout und Idle-Shutdown,
- Diagnostics,
- Symbols,
- Definition,
- References.

### Nicht ausbauen

- keine automatische Codeänderung über LSP,
- kein permanenter Server für jede Sprache,
- kein LSP als Ersatz für Tests oder Compiler,
- keine semantische Vollindexierung.

### Begründung

Die aktuelle LSP-Integration ist bereits ausreichend und sicherheitsbewusst. Mehr Integration würde vor allem Prozesse, Fehlerfälle und Wartung erhöhen.

---

## 4.2 Compaction und Projektgedächtnis

### Beibehalten

- Pi-Core als alleiniger Compaction-Eigentümer,
- `docs/PROJECT_STATE.md` als transparentes Arbeitsgedächtnis,
- Context-Checkpoint vor Compaction, Modell- oder Sessionwechsel.

### Nicht ergänzen

- keine zusätzliche Memory-Extension,
- keine automatische Speicherung jeder Beobachtung,
- keine vollständigen Tool-Logs,
- keine ungeprüften Vermutungen als Dauerwissen.

### Begründung

Die bestehende Trennung zwischen Dauerregeln, Referenz, Arbeitszustand und Sitzung ist bereits sinnvoll. Eine weitere Memory-Schicht würde eher Widersprüche und veralteten Kontext erzeugen.

---

## 4.3 Aurora UI

### Beibehalten

Aurora bleibt der einzige Eigentümer permanenter benutzerdefinierter UI-Flächen.

Sichtbar sein sollen nur:

- Workflow-Phase,
- Modellrolle und Modell,
- Thinking-Level,
- aktuelles Tool oder Subagent,
- Laufzeit,
- Kontextstand,
- Verifikationsstatus,
- wartet, blockiert oder möglicherweise festgefahren.

### Nicht ergänzen

- keine vollständige Thinking-Ausgabe,
- keine weiteren permanenten Widgets,
- kein zweiter Footer,
- keine zweite Renderer-Extension,
- keine Terminal-IDE.

### Begründung

Mehr UI erhöht nicht automatisch die Arbeitsqualität. Es erhöht jedoch Renderkomplexität, Timer, Listener und Risiko von Eingabelatenz.

---

# 5. Was bewusst nicht übernommen werden sollte

## 5.1 Keine Multi-Agent-Teams

Keine Agenten, die frei miteinander diskutieren, Unteragenten weiterdelegieren oder einen gemeinsamen autonomen Plan verwalten.

**Warum:** Zu viele Übergaben, hoher Tokenverbrauch und schwer nachvollziehbare Fehler.

## 5.2 Keine automatischen Modell-Debatten

Ein zweites Modell nur explizit bei:

- schwieriger Architektur,
- Sicherheitsreview,
- festgefahrener Fehlersuche,
- riskanten Änderungen.

**Warum:** Ein klarer Reviewer mit Auftrag und Diff ist meist nützlicher als eine offene Diskussion zweier Modelle.

## 5.3 Kein permanenter Repository-Vollindex

**Warum:** Hintergrundprozesse, veralteter Index, zusätzliche Abhängigkeiten und schwer überprüfbarer Kontext.

## 5.4 Keine zweite interne Extension-Plattform

Pi besitzt bereits Extensions und Skills.

**Warum:** Eine zusätzliche Abstraktionsschicht würde Zuständigkeiten und Fehlersuche verschlechtern.

## 5.5 Kein unkontrolliertes automatisches Gedächtnis

Nur bestätigte Entscheidungen und stabiler Projektzustand dürfen dauerhaft gespeichert werden.

**Warum:** Temporäre Vermutungen und einmalige Fehlerursachen werden sonst zu falschen Dauerregeln.

## 5.6 Keine zweite Workflow-Zustandsmaschine

Alle neuen Workflow-Funktionen müssen die vorhandene zentrale Zustandslogik nutzen.

**Warum:** Doppelte Zustände führen zu schwer reproduzierbaren Fehlern.

## 5.7 Keine automatische Rechteeskalation

Kein Modell, Workflow oder Subagent darf den Permission-Level selbstständig erhöhen.

**Warum:** Berechtigungen müssen eine bewusste Nutzerentscheidung bleiben.

---

# 6. Empfohlene Reihenfolge

## Phase 1: Messen und konsolidieren

1. Benchmark-Pilot erstellen.
2. Baseline des aktuellen Setups messen.
3. `setup.json` als zentrale Konfiguration durchsetzen.
4. Dokumentation konsolidieren.
5. Altkomponenten und ungenutzte Dependencies bereinigen.

## Phase 2: Vereinfachen

6. Workflow-Oberfläche auf drei Hauptaktionen reduzieren.
7. Subagenten auf vier Kernrollen reduzieren.
8. Standardparallelität auf zwei begrenzen.
9. universelles Verifikations-Gate einführen.

## Phase 3: Gezielte Qualitätsverbesserungen

10. bedarfsgesteuerte Repository-Übersicht ergänzen.
11. Doom-Loop-Erkennung ergänzen.
12. Edit-Fallbacks und Edit-Metriken ergänzen.
13. regelbasiertes Modell-Routing vereinheitlichen.

## Phase 4: Stabilisieren

14. LSP-Grenzen dokumentieren und absichern.
15. Compaction und Projektgedächtnis vereinheitlichen.
16. Aurora als alleinigen UI-Eigentümer festigen.
17. Architektur-No-Gos dokumentieren und durch Doctor-Checks prüfen.

---

# 7. Empfohlener Zielzustand

Der Zielzustand soll kein kleiner Nachbau von Claude Code, Roo Code, Warp oder einem allgemeinen Multi-Agent-Framework werden.

Er soll aus wenigen klaren Komponenten bestehen:

- eine zentrale Konfiguration,
- eine zentrale Workflow-Extension,
- eine Permission-Policy,
- ein UI-Eigentümer,
- ein optionales LSP-Modul,
- vier klar begrenzte Subagentenrollen,
- ein verbindliches Verifikations-Gate,
- ein kleiner realer Qualitätsbenchmark.

Die sinnvollsten übernommenen Ideen sind:

1. **Aider:** kompakte Repository-Orientierung, Edit-Fallbacks und direkte Verifikation.
2. **Cline:** Planungsumfang abhängig von der Aufgabengröße.
3. **Claude Code:** frische Subagentenkontexte und harte Toolgrenzen.
4. **OpenCode:** einfache Trennung von Plan und Arbeit sowie Schleifenerkennung.
5. **Codex:** Abschluss erst nach nachvollziehbarer Prüfung und konkreten Belegen.

Die wichtigste Architekturregel lautet:

> Eine neue Funktion wird nur aufgenommen, wenn sie eine belegte Lücke schließt, eine klare Zuständigkeit besitzt und im Benchmark einen messbaren Nutzen zeigt.

Schwierigkeiten: 9/10 | Thinking: xhigh
