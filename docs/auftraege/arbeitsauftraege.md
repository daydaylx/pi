# Arbeitsaufträge für die Weiterentwicklung von `daydaylx/pi`

> **Übergeordnet:** [Empfehlungsbericht](../empfehlungsbericht.md) – Strategie-Dach, begründet die Aufträge.
> **Detail zu Auftrag 1:** [Benchmark-Auftrag](auftrag.md) – Pilotphase des Qualitätsbenchmarks.

## Verbindliche Reihenfolge

Die Aufträge nicht parallel und nicht in beliebiger Reihenfolge umsetzen.

1. Qualitätsbenchmark definieren
2. Aktuelle Baseline messen
3. Konfiguration konsolidieren
4. Dokumentation konsolidieren
5. Altkomponenten bereinigen
6. Workflow-Oberfläche vereinfachen
7. Subagenten reduzieren
8. Subagenten-Parallelität begrenzen
9. Universelles Verifikations-Gate ergänzen
10. Bedarfsgesteuerte Repository-Übersicht ergänzen
11. Doom-Loop-Erkennung ergänzen
12. Edit-Fallbacks und Edit-Metriken ergänzen
13. Modell-Routing vereinheitlichen
14. LSP bewusst begrenzen
15. Compaction und Projektgedächtnis absichern
16. Aurora als alleinigen UI-Eigentümer festigen
17. Architektur-No-Gos technisch und dokumentarisch festhalten

Nach jedem Auftrag müssen alle vorhandenen Tests weiterhin erfolgreich sein. Keine weiteren Features neben dem jeweils beauftragten Umfang ergänzen.

---

# Auftrag 1: Realen Qualitätsbenchmark definieren

## Rolle

Du bist Testarchitekt für KI-Coding-Agenten und entwickelst einen reproduzierbaren Benchmark für das Repository `daydaylx/pi`.

## Ziel

Definiere einen kleinen, realistischen Testkatalog, mit dem verschiedene Pi-Konfigurationen objektiv verglichen werden können.

Der Benchmark soll nicht nur prüfen, ob Extensions technisch funktionieren, sondern ob Pi reale Entwicklungsaufgaben korrekt, effizient und ohne unnötige Änderungen löst.

## Nicht-Ziele

- Noch keine Pi-Architektur verändern.
- Keine bestehenden Extensions umbauen.
- Keine Modelle automatisch bewerten.
- Keine öffentlichen Coding-Benchmarks blind kopieren.
- Keine rein synthetischen Aufgaben ohne Praxisbezug erzeugen.

## Kontext

Die vorhandenen Tests prüfen hauptsächlich Extension-Verhalten, Zustände, Sicherheit und TypeScript-Korrektheit. Es fehlt eine Messung der tatsächlichen Agentenqualität bei realen Coding-Aufgaben.

## Auftrag

Erstelle unter einem geeigneten Pfad, beispielsweise `benchmarks/`, ein Konzept für mindestens zehn standardisierte Aufgabentypen:

1. kleine Ein-Datei-Änderung,
2. lokaler Bug,
3. fehlgeschlagener Unit-Test,
4. Änderung über mehrere Dateien,
5. Refactoring ohne Verhaltensänderung,
6. Navigation in unbekanntem Code,
7. absichtlich unterbestimmter Auftrag,
8. lange Sitzung mit Compaction,
9. fehlgeschlagener oder hängender Tool-Aufruf,
10. Aufgabe mit und ohne Subagent.

Definiere für jede Aufgabe:

- Ausgangszustand,
- konkreten Auftrag,
- erlaubten Änderungsumfang,
- erwartetes Ergebnis,
- relevante Tests,
- verbotene Änderungen,
- Abbruchbedingungen,
- Bewertungskriterien.

Definiere außerdem diese Messgrößen:

- erfolgreiche Lösung ohne Nachkorrektur,
- benötigte Nutzerkorrekturen,
- unnötig geänderte Dateien,
- unnötig geänderte Zeilen,
- fehlgeschlagene Tool-Aufrufe,
- Test- und Build-Ergebnis,
- Tokenverbrauch,
- Laufzeit,
- Modellaufrufe,
- Subagentenaufrufe,
- verlorene Anforderungen,
- wiederholte identische Fehler.

## Änderungsregeln

- Benchmark und Produktivcode klar trennen.
- Keine Benchmarkergebnisse erfinden.
- Aufgaben müssen reproduzierbar sein.
- Jede Aufgabe muss auf einen bekannten Ausgangscommit oder eine reproduzierbare Fixture zurücksetzbar sein.
- Bewertung so weit wie möglich automatisieren.
- Subjektive Bewertungen klar von automatischen Messungen trennen.

## Verifikation

Prüfe:

- Sind alle zehn Aufgabentypen abgedeckt?
- Kann jeder Lauf auf denselben Ausgangszustand zurückgesetzt werden?
- Sind Soll-Ergebnis und verbotene Änderungen eindeutig?
- Können mindestens die technischen Metriken automatisch erfasst werden?
- Ist ein Vergleich zwischen zwei Pi-Konfigurationen möglich?

## Ausgabeformat

Berichte:

1. angelegte Dateien,
2. Benchmark-Struktur,
3. Aufgabentypen,
4. Messgrößen,
5. noch nicht automatisierbare Bewertungen,
6. Risiken,
7. Empfehlung für den ersten Testlauf.

## Abschlusskriterien

Der Auftrag ist abgeschlossen, wenn ein reproduzierbarer Benchmarkplan mit mindestens zehn Aufgaben und klaren Qualitätsmetriken vorhanden ist.

Schwierigkeiten: 7/10 | Thinking: high

---

# Auftrag 2: Baseline des aktuellen Pi-Setups messen

## Rolle

Du bist Evaluator für Coding-Agenten und führst eine unveränderte Ausgangsmessung des aktuellen Pi-Setups durch.

## Ziel

Ermittle die aktuelle Qualität, Geschwindigkeit, Stabilität und Ressourcennutzung des bestehenden Systems, bevor Architekturänderungen vorgenommen werden.

## Nicht-Ziele

- Keine Fehler während der Baseline direkt reparieren.
- Keine Modelle oder Konfigurationen wechseln.
- Keine Ergebnisse nachträglich beschönigen.
- Keine Aufgaben während eines Laufs durch zusätzliche Hinweise erleichtern.

## Voraussetzungen

Auftrag 1 muss abgeschlossen sein.

## Auftrag

Führe den definierten Benchmark mit der aktuellen Konfiguration aus.

Halte für jeden Lauf fest:

- verwendetes Modell,
- Thinking-Level,
- Workflow-Modus,
- Permission-Level,
- aktive Extensions,
- gestartete Subagenten,
- geänderte Dateien,
- Prüfresultate,
- Tokenverbrauch,
- Laufzeit,
- Nutzerinterventionen,
- Fehlversuche,
- endgültigen Erfolg oder Misserfolg.

Führe jede Aufgabe nach Möglichkeit mehrfach aus, damit einzelne Zufallsergebnisse nicht überbewertet werden.

Empfohlen:

- mindestens drei Läufe pro Aufgabe,
- bei stark schwankenden Ergebnissen fünf Läufe.

## Änderungsregeln

- Ausgangszustand vor jedem Lauf zurücksetzen.
- Keine manuellen Reparaturen innerhalb des bewerteten Laufs.
- Abgebrochene und fehlgeschlagene Läufe mitzählen.
- Provider- oder Netzwerkfehler separat von Agentenfehlern markieren.
- Rohdaten und zusammengefasste Ergebnisse getrennt speichern.

## Verifikation

Prüfe:

- Wurde jeder Lauf mit identischer Ausgangslage gestartet?
- Sind Modell und Konfiguration dokumentiert?
- Sind fehlgeschlagene Läufe enthalten?
- Lassen sich Durchschnitt, Median und Streuung ermitteln?
- Können spätere Konfigurationen direkt gegen diese Baseline verglichen werden?

## Ausgabeformat

Erstelle einen Baseline-Bericht mit:

1. Gesamterfolgsquote,
2. Erfolgsquote je Aufgabentyp,
3. häufigsten Fehlerklassen,
4. unnötigen Änderungen,
5. durchschnittlicher Laufzeit,
6. durchschnittlichem Tokenverbrauch,
7. Subagentennutzen,
8. Compaction-Problemen,
9. drei größten Qualitätsproblemen,
10. drei Bereichen, die bereits gut funktionieren.

## Abschlusskriterien

Der Auftrag ist abgeschlossen, wenn eine nachvollziehbare und unveränderte Ausgangsmessung vorliegt, gegen die alle späteren Änderungen verglichen werden können.

Schwierigkeiten: 8/10 | Thinking: high

---

# Auftrag 3: `setup.json` zur zentralen Konfigurationsquelle machen

## Rolle

Du bist Systemarchitekt für Konfigurationsmanagement und TypeScript-basierte CLI-Anwendungen.

## Ziel

Reduziere Konfigurationsdrift, indem `setup.json` zur einzigen manuell gepflegten fachlichen Konfigurationsquelle des Pi-Setups wird.

## Nicht-Ziele

- Pi-Core nicht forken.
- Keine neue allgemeine Konfigurationsplattform bauen.
- Keine Secrets oder Authentifizierungsdaten verwalten.
- Projektkonfiguration darf globale Sicherheitsregeln nicht lockern.
- Keine automatische Paketinstallation.

## Kontext

Konfigurationswerte sind derzeit auf mehrere Dateien verteilt:

- `setup.json`,
- `settings.json`,
- `extensions/subagent/config.json`,
- teilweise hartcodierte Defaults.

Doppelt gepflegt werden unter anderem Modellrollen, Theme, Subagenten-Parallelität und Extensions.

## Auftrag

1. Inventarisiere alle aktiven Konfigurationswerte.
2. Ordne jeden Wert genau einem Eigentümer zu.
3. Definiere `setup.json` als fachliche Hauptquelle für:
   - UI,
   - Permissions,
   - LSP,
   - Subagenten,
   - Modellrollen,
   - Verifikation,
   - aktive optionale Module.
4. Prüfe, welche Pi-Core-Werte weiterhin zwingend in `settings.json` liegen müssen.
5. Generiere oder validiere abgeleitete Werte statt sie doppelt manuell zu pflegen.
6. Ergänze `/setup-doctor`, sodass Abweichungen konkret gemeldet werden:
   - erwarteter Wert,
   - tatsächlicher Wert,
   - Eigentümer,
   - sichere Korrekturmöglichkeit.
7. Erhalte die bestehende Priorität:
   - Defaults,
   - globale Konfiguration,
   - vertrauenswürdige Projektkonfiguration.
8. Verhindere weiterhin, dass Projekte:
   - globale Rechte lockern,
   - Host-Verifikationsbefehle ersetzen,
   - globale Modell- oder Subagenteneinstellungen unbemerkt überschreiben.

## Änderungsregeln

- Fail-closed bei ungültiger Konfiguration.
- Unbekannte Schlüssel weiterhin als Fehler melden.
- Keine stillen Migrationen ohne Diagnose.
- Keine Auth-, Session- oder Cachedateien lesen.
- Rückwärtskompatibilität nur dort erhalten, wo sie keinen zweiten dauerhaften Eigentümer erzeugt.
- Veraltete Felder mit klarer Migrationswarnung versehen.

## Verifikation

Ergänze Tests für:

- gültige Konfiguration,
- unbekannte Schlüssel,
- falsche Datentypen,
- ungültige Grenzwerte,
- globale und projektbezogene Priorität,
- verbotene Rechteausweitung,
- Drift zwischen `setup.json` und abgeleiteten Dateien,
- fehlende Konfigurationsdateien,
- alte Konfigurationsversionen.

## Ausgabeformat

Berichte:

1. bisherige Konfigurationsquellen,
2. neuer Eigentümer je Wert,
3. entfernte Duplikate,
4. Migrationsverhalten,
5. neue Doctor-Diagnosen,
6. Tests,
7. verbleibende technisch notwendige Pi-Core-Ausnahmen.

## Abschlusskriterien

- Jeder fachliche Wert besitzt genau einen Eigentümer.
- `setup.json` ist die dokumentierte Hauptquelle.
- Drift wird automatisch erkannt.
- Projektkonfiguration kann keine globalen Grenzen lockern.
- Alle Tests bestehen.

Schwierigkeiten: 9/10 | Thinking: xhigh

---

# Auftrag 4: Dokumentation konsolidieren

## Rolle

Du bist technischer Redakteur und Softwarearchitekt.

## Ziel

Beseitige widersprüchliche, doppelte und veraltete Architekturdokumentation.

## Nicht-Ziele

- Keine Produktivlogik ändern.
- Keine neue Dokumentationsplattform einführen.
- Keine historischen Informationen löschen, die für Audits oder Rückbau noch benötigt werden.
- Keine Architekturbehauptungen ohne Abgleich mit dem aktiven Code übernehmen.

## Auftrag

Reduziere die aktive Dokumentation auf drei verbindliche Ebenen:

### `README.md`

Enthält nur:

- Zweck des Repositories,
- aktive Runtime-Architektur,
- Installation,
- wichtigste Befehle,
- kurze Bedienung,
- Link auf Architektur und Projektstatus.

### `docs/ARCHITECTURE.md`

Wird einzige verbindliche technische Quelle für:

- aktive Extensions,
- Eigentümer jeder UI-Fläche,
- Konfigurationspriorität,
- Workflow-Zustände,
- Berechtigungsmodell,
- Subagentenmodell,
- LSP-Grenzen,
- Compaction,
- Verifikation,
- Installations- und Updategrenzen.

### `docs/PROJECT_STATE.md`

Enthält ausschließlich:

- aktuelles Ziel,
- aktive Phase,
- offene Fehler,
- letzte Verifikation,
- nächste konkrete Schritte.

Inventarisiere anschließend:

- Root-Auditberichte,
- alte Architekturdateien,
- alte Changelogs,
- Vergleichsdokumente,
- überholte Extension-Dokumentation.

Ordne diese Inhalte entweder:

- der verbindlichen Architektur,
- dem Projektstatus,
- einem klar markierten Archiv,
- oder der Löschung zu.

## Änderungsregeln

- Aktiven Code als technische Wahrheit verwenden.
- Widersprüche ausdrücklich auflisten.
- Historische Dokumente nicht weiter als aktive Projektregeln laden.
- Keine vollständigen Auditberichte in `AGENTS.md` übernehmen.
- `AGENTS.md` kurz und handlungsorientiert halten.
- Archivierte Dokumente deutlich als nicht verbindlich markieren.

## Verifikation

Prüfe automatisiert oder per Audit:

- Verweist keine aktive Dokumentation auf deaktivierte UI-Eigentümer?
- Stimmen aktive Extensions mit `settings.json` beziehungsweise generierter Konfiguration überein?
- Stimmen Modellrollen und Befehle mit dem Code überein?
- Gibt es tote Links?
- Gibt es mehrere Dokumente, die sich selbst als verbindliche Architekturquelle bezeichnen?
- Lädt der Agent keine archivierten Dokumente automatisch?

## Ausgabeformat

Berichte:

1. gefundene Widersprüche,
2. neue Dokumentationsstruktur,
3. verschobene Dateien,
4. gelöschte Dateien,
5. archivierte Dateien,
6. noch offene Dokumentationsrisiken.

## Abschlusskriterien

Es existiert genau eine aktive Architekturquelle, ein kurzer README-Einstieg und ein aktueller Projektstatus ohne widersprüchliche Eigentümer oder veraltete Runtime-Aussagen.

Schwierigkeiten: 6/10 | Thinking: high

---

# Auftrag 5: Inaktive Altkomponenten und Dependencies bereinigen

## Rolle

Du bist Maintainer für Node.js- und TypeScript-Projekte mit Schwerpunkt Abhängigkeits- und Laufzeitbereinigung.

## Ziel

Entferne inaktive Altimplementierungen, ungenutzte Dependencies und irreführende Vergleichsdateien aus dem aktiven Repository.

## Voraussetzungen

- Auftrag 3 und Auftrag 4 abgeschlossen.
- Stabiler Git-Tag oder nachvollziehbarer Rückbaupunkt vorhanden.

## Nicht-Ziele

- Keine aktive Funktion entfernen.
- Keine Dependency-Versionen gleichzeitig aktualisieren.
- Keine neue UI oder Ersatzextension einführen.
- Keine Auth-, Session- oder Nutzerdaten verändern.

## Auftrag

1. Ermittle die tatsächlich geladenen:
   - Extensions,
   - Packages,
   - UI-Komponenten,
   - Renderer,
   - Agentenprofile.
2. Prüfe insbesondere alte Zentui-, Tool-Display-, Activity- und Thinking-Komponenten.
3. Ermittle, ob Dependencies noch:
   - importiert,
   - zur Laufzeit geladen,
   - in Tests benötigt,
   - nur historisch vorhanden sind.
4. Entferne ungenutzte Dependencies aus den Manifesten.
5. Entferne oder archiviere deaktivierte Implementierungen.
6. Passe Tests an die aktive Architektur an.
7. Stelle sicher, dass ein Rückbau über Git möglich bleibt und keine Altimplementation dauerhaft mitgeführt werden muss.
8. Ergänze einen Test oder Doctor-Check für:
   - Dependency vorhanden, aber nicht verwendet,
   - Extension konfiguriert, aber nicht vorhanden,
   - Extension vorhanden, aber dauerhaft deaktiviert.

## Änderungsregeln

- Pro Komponente Beleg für „aktiv“, „test-only“ oder „ungenutzt“ liefern.
- Keine pauschale Löschung anhand von Dateinamen.
- Paket-Lockdatei nur durch reguläre Paketmanageroperation ändern.
- Keine Paketupdates mit der Bereinigung vermischen.
- Keine vom Nutzer angelegten Sicherungen außerhalb des Repositories löschen.

## Verifikation

Ausführen:

- Typecheck,
- vollständige Tests,
- Installations-Dry-Run,
- `/setup-doctor`,
- Start der Pi-TUI,
- Aurora-Darstellung,
- Tool-Rendering,
- Subagentenstatus,
- Shutdown ohne verbleibende Timer oder Listener.

## Ausgabeformat

Berichte:

1. entfernte Dependencies,
2. entfernte oder archivierte Dateien,
3. weiterhin benötigte Altkomponenten,
4. angepasste Tests,
5. gemessene Auswirkungen auf Startzeit und Speicher,
6. Rückbauweg.

## Abschlusskriterien

Das aktive Repository enthält keine bekannten dauerhaft ungenutzten Runtime-Komponenten oder Dependencies. Alle aktiven Funktionen und Tests bleiben erhalten.

Schwierigkeiten: 7/10 | Thinking: high

---

# Auftrag 6: Sichtbaren Workflow auf drei Hauptaktionen vereinfachen

## Rolle

Du bist UX-Architekt für Terminalanwendungen und Entwickler des bestehenden Pi-Planworkflows.

## Ziel

Vereinfache die alltägliche Bedienung auf:

1. Planen,
2. Arbeiten,
3. Prüfen und abschließen.

Die robuste interne Zustandsmaschine bleibt erhalten.

## Nicht-Ziele

- Sidecar-State, Plan-ID, Revisionen und Execution-ID nicht ohne nachgewiesenen Grund entfernen.
- Keine Workflow-Sicherheitsgrenzen lockern.
- Keine automatische Ausführung direkt nach der Planung.
- Keine bestehenden Direktbefehle zwingend löschen.
- Kein neues permanentes TUI-Panel.

## Auftrag

Überarbeite Shift+Tab und den normalen Workflow so, dass im ersten Menü nur drei Hauptaktionen dominieren:

### Planen

Öffnet abhängig vom Zustand passende Optionen:

- direkt arbeiten,
- Schnellplan,
- Architekturplan,
- Optionen klären,
- vorhandenen Plan fortsetzen.

### Arbeiten

- arbeitet ohne Plan direkt, wenn kein aktiver Plan vorhanden ist,
- führt einen vorhandenen Plan nur nach expliziter Auswahl aus,
- fragt bei pausierter Ausführung nach Wiederaufnahme,
- überschreibt keinen Plan still.

### Prüfen und abschließen

- zeigt offene Todos,
- führt passende Verifikation aus,
- bietet optionalen Review,
- archiviert erst nach erfüllten Abschlussbedingungen.

Diese Funktionen bleiben als erweiterte Direktbefehle erhalten:

- `/decide`,
- `/review-plan`,
- `/plan-todos`,
- `/done`,
- `/finish`.

Sie sollen jedoch nicht alle als gleichwertige Hauptkonzepte in der Standardbedienung erscheinen.

## Änderungsregeln

- Interne Workflow-Phasen nicht allein wegen der UI umbenennen.
- Workflow und Permission-Level getrennt halten.
- Thinking-Auto und manuelle Thinking-Auswahl erhalten.
- Laufende Turns nicht ohne Nachfrage abbrechen.
- Nichtinteraktive Nutzung weiterhin konservativ behandeln.
- Bestehende Pläne niemals still überschreiben.

## Verifikation

Teste mindestens:

- keine vorhandene Plan-Datei,
- offener Plan,
- vollständig erledigter Plan,
- laufende Ausführung,
- laufender Review,
- pausierte Ausführung,
- blockierte Ausführung,
- nichtinteraktive Umgebung,
- Permission-Wechsel während verschiedener Phasen,
- manueller Thinking-Modus.

Führe zusätzlich einen UX-Vergleich durch:

- Anzahl nötiger Eingaben für kleine Aufgabe,
- mittlere Aufgabe,
- große Aufgabe,
- Fortsetzung eines pausierten Plans.

## Ausgabeformat

Berichte:

1. bisheriger Bedienpfad,
2. neuer Bedienpfad,
3. intern unveränderte Zustände,
4. zurückgestufte Direktbefehle,
5. UX-Testresultate,
6. mögliche Kompatibilitätsrisiken.

## Abschlusskriterien

Ein normaler Nutzer kann Pi über drei verständliche Hauptaktionen steuern, ohne dass Sicherheits-, Resume- oder Plan-Schutzmechanismen verloren gehen.

Schwierigkeiten: 8/10 | Thinking: high

---

# Auftrag 7: Subagenten auf vier Kernrollen reduzieren

## Rolle

Du bist Architekt für kontrollierte Agentendelegation.

## Ziel

Reduziere die standardmäßig sichtbaren und gepflegten Subagentenprofile auf:

- `scout`,
- `worker`,
- `reviewer`,
- `test-runner`.

`oracle` darf als manuell aufrufbare Sonderrolle erhalten bleiben.

## Nicht-Ziele

- Das Subagenten-Paket nicht ersetzen.
- Keine Multi-Agent-Kommunikation einführen.
- Keine zusätzlichen Schreibrollen ergänzen.
- Reviewer und Test-Runner keine freien Bash- oder Schreibrechte geben.
- Keine Rollen nur wegen unterschiedlicher Formulierungen beibehalten.

## Auftrag

Prüfe diese Profile:

- `scout`,
- `planner`,
- `architect`,
- `reviewer`,
- `test-runner`,
- `security-auditor`,
- `ui-reviewer`,
- `docs-auditor`,
- `worker`,
- `oracle`.

Ordne ihre Aufgaben neu zu:

### `scout`

Übernimmt:

- Projektsuche,
- relevante Dateien,
- Symbol- und Abhängigkeitsübersicht,
- begrenzte Architekturorientierung.

### `worker`

Übernimmt ausschließlich klar abgegrenzte Implementierungen.

### `reviewer`

Erhält auswählbare Prüfperspektiven:

- allgemeines Code-Review,
- Sicherheit,
- UI/UX,
- Dokumentation,
- Architektur.

Diese Perspektiven als Skills, Parameter oder kurze Zusatzanweisungen umsetzen, nicht als vollständige neue Agentenprofile.

### `test-runner`

Führt nur freigegebene Verifikation aus und berichtet Ergebnisse.

### `oracle`

Nur explizit verwenden für:

- schwierige Architekturfragen,
- festgefahrene Fehlersuche,
- zweite Meinung bei hohem Risiko.

## Änderungsregeln

- Fresh Context als Standard erhalten.
- Projektkontext weiterhin bewusst vererben.
- Parent-Chat nicht automatisch kopieren.
- Tool-Grenzen technisch über registrierte Tools erzwingen.
- Kompaktes gemeinsames Ergebnisformat erhalten.
- Alte Profilnamen bei Bedarf vorübergehend mit klarer Warnung auf neue Rollen abbilden.

## Verifikation

Teste:

- Tool-Listen jeder Rolle,
- fehlender Bash-Zugriff für read-only Rollen,
- fehlender Schreibzugriff für Reviewer,
- festes `verify` für Test-Runner,
- Fresh Context,
- Projektkontextvererbung,
- Rückgabeformat,
- Verhalten alter Profilnamen,
- Doctor- und Discovery-Ausgabe.

Vergleiche Benchmarkresultate vor und nach der Reduktion.

## Ausgabeformat

Berichte:

1. beibehaltene Rollen,
2. entfernte Rollen,
3. überführte Prüfperspektiven,
4. Kompatibilitätsabbildungen,
5. reduzierte Prompt- und Wartungsfläche,
6. Benchmarkvergleich.

## Abschlusskriterien

Standardmäßig existieren nur vier operative Kernrollen und optional `oracle`. Alle bisherigen sinnvollen Prüfperspektiven bleiben ohne separate Agentenlandschaft nutzbar.

Schwierigkeiten: 7/10 | Thinking: high

---

# Auftrag 8: Subagenten-Parallelität begrenzen

## Rolle

Du bist Performance- und Nebenläufigkeitsarchitekt.

## Ziel

Reduziere unkontrollierte Parallelität und verhindere konkurrierende Schreibzugriffe.

## Auftrag

Setze die Standardwerte auf:

- globale Parallelität: `2`,
- normale maximale Tasks pro Parallelauftrag: `4`,
- maximale Subagentenstarts pro Sitzung: `8` bis `12`.

Ergänze optional eine ausdrücklich aktivierbare Burst-Stufe:

- maximale Parallelität `4`,
- nur für read-only Recherche oder unabhängige Prüfungen.

Definiere zusätzlich:

- maximal einen schreibenden Worker pro Workspace,
- keine parallelen Worker ohne isolierte Worktrees,
- Test-Runner darf nicht gleichzeitig gegen einen aktiv schreibenden Worker laufen, wenn dadurch inkonsistente Ergebnisse möglich sind,
- Reviewer erst nach stabilem Diff oder explizitem Snapshot starten.

## Nicht-Ziele

- Keine automatische Worktree-Orchestrierung einführen.
- Keine verteilte Queue bauen.
- Keine Multi-Agent-Teams.
- Keine Parallelität nur zur optischen Aktivität nutzen.

## Änderungsregeln

- Konfigurationswerte aus der zentralen Quelle beziehen.
- UI muss aktive und wartende Subagenten unterscheiden.
- Provider-Limits und lokale Limits getrennt melden.
- Bei Erreichen eines Limits warten oder sauber ablehnen, nicht still weitere Prozesse starten.
- Abbruch muss Kindprozesse zuverlässig beenden.

## Verifikation

Teste:

- zwei parallele read-only Agenten,
- dritter wartender Agent,
- versuchter zweiter Worker,
- Abbruch eines parallelen Auftrags,
- Timeout,
- Providerfehler,
- Sessionende mit laufenden Agenten,
- Burst-Stufe,
- Rückkehr zur normalen Stufe.

Vergleiche:

- Laufzeit,
- Tokenverbrauch,
- Fehlerrate,
- Terminalreaktion,
- Prozessreste.

## Abschlusskriterien

Normale Sitzungen nutzen maximal zwei parallele Subagenten. Parallele Schreibzugriffe im selben Workspace sind technisch ausgeschlossen oder klar blockiert.

Schwierigkeiten: 6/10 | Thinking: high

---

# Auftrag 9: Universelles Verifikations-Gate einführen

## Rolle

Du bist Qualitätsarchitekt für agentische Entwicklungsworkflows.

## Ziel

Eine Coding-Aufgabe darf erst als abgeschlossen gelten, wenn Änderungen, Anforderungen und relevante Prüfungen nachvollziehbar kontrolliert wurden.

## Nicht-Ziele

- Nicht immer die vollständige Testsuite ausführen.
- Keine beliebigen Projektbefehle automatisch vertrauen.
- Keine erfolgreiche Verifikation erfinden.
- Keine fehlgeschlagenen Tests verschweigen.
- Kein zweites Modell für jede Kleinigkeit erzwingen.

## Auftrag

Implementiere einen zentralen Abschlussprozess, der für direkte Aufgaben und Plan-Ausführungen gleichermaßen gilt.

Der Prozess muss:

1. ursprünglichen Auftrag und Nicht-Ziele laden,
2. `git diff --stat` oder äquivalenten Umfang bestimmen,
3. geänderte Dateien einzeln prüfen,
4. unerwartete Dateien erkennen,
5. relevante Verifikation auswählen,
6. freigegebene Checks ausführen,
7. Ergebnisse gegen Abschlusskriterien prüfen,
8. Restfehler und Unsicherheiten nennen,
9. Abschluss erlauben oder `blocked` setzen.

Ergänze eine projektbezogene, vertrauensgebundene Verifikationskonfiguration für:

- Typecheck,
- Lint,
- Tests,
- Build,
- optional projektspezifische Checks.

Diese Konfiguration darf erst nach Projektvertrauen und klarer Nutzerfreigabe ausführbare Befehle bereitstellen.

## Änderungsregeln

- Setup-Verifikation und Projektverifikation getrennt halten.
- Keine freien Shell-Strings im speziellen Verifikationstool.
- Befehle als ausführbare Datei plus Argumentliste speichern.
- Zeitlimits erzwingen.
- Exit-Code, Dauer und gekürzte relevante Ausgabe erfassen.
- Nicht ausführbare Prüfungen als Restunsicherheit melden.
- Kein grüner Abschluss bei offenen kritischen Fehlern.

## Verifikation

Teste:

- erfolgreiche kleine Änderung,
- fehlgeschlagener Test,
- nicht vorhandener Testbefehl,
- Timeout,
- unerwartete geänderte Datei,
- offenes Plan-Todo,
- direkte Arbeit ohne Plan,
- Plan-Ausführung,
- read-only Reviewer,
- untrusted Projektkonfiguration.

## Ausgabeformat

Abschlussbericht:

1. Auftrag erfüllt: ja/nein/teilweise,
2. geänderte Dateien,
3. ausgeführte Prüfungen,
4. erfolgreiche Prüfungen,
5. fehlgeschlagene Prüfungen,
6. nicht ausführbare Prüfungen,
7. Scope-Abweichungen,
8. Restrisiken,
9. empfohlener nächster Schritt.

## Abschlusskriterien

Keine Aufgabe wird ohne Diff-Kontrolle, Anforderungsabgleich und angemessene Verifikation als vollständig abgeschlossen gemeldet.

Schwierigkeiten: 9/10 | Thinking: xhigh

---

# Auftrag 10: Bedarfsgesteuerte Repository-Übersicht ergänzen

## Rolle

Du bist Entwickler für Kontextmanagement und Code-Navigation.

## Ziel

Ergänze eine kompakte Repository-Übersicht, die nur bei tatsächlichem Bedarf erzeugt wird.

## Nicht-Ziele

- Kein permanenter Vollindex.
- Keine Vektordatenbank.
- Keine dauerhaften Hintergrundprozesse.
- Keine vollständige Analyse vor jeder Aufgabe.
- Keine zusätzliche schwere Abhängigkeit ohne nachgewiesenen Nutzen.

## Auftrag

Entwickle einen aufrufbaren Mechanismus wie `/repo-outline`.

Die Ausgabe soll enthalten:

- wichtige Module und Verzeichnisse,
- Einstiegspunkte,
- zentrale Symbole,
- direkte Import- oder Abhängigkeitsbeziehungen,
- relevante Konfigurationsdateien,
- wahrscheinliche Dateien für die aktuelle Aufgabe,
- Unsicherheiten.

Nutze bevorzugt:

1. Dateisuche,
2. bestehende LSP-Symbole,
3. Importanalyse,
4. gezielte Textsuche,
5. Git-Informationen.

Begrenze die Ausgabe auf ungefähr 1.000 bis 2.000 Tokens beziehungsweise eine klar definierte Textgröße.

Automatische Empfehlung nur bei:

- unbekanntem Repository,
- großem Multi-Modul-Projekt,
- wiederholt erfolgloser Navigation,
- größerem Refactoring,
- unklarem Einstiegspunkt.

## Änderungsregeln

- Ergebnis nicht automatisch als dauerhaftes Gedächtnis speichern.
- Cache nur mit klarer Invalidierung über relevante Dateiänderungen oder Git-Stand.
- Fehler einzelner Sprachserver dürfen die Übersicht nicht vollständig verhindern.
- Relevanz für die aktuelle Aufgabe priorisieren.
- Vollständige Dateiinhalte nicht in die Übersicht kopieren.

## Verifikation

Teste mit:

- kleinem Projekt,
- großem Projekt,
- Projekt ohne LSP,
- Projekt mit mehreren Sprachen,
- unbekanntem Einstiegspunkt,
- Änderung nach erzeugter Übersicht,
- ungültigem Cache,
- sehr großer Verzeichnisstruktur.

Vergleiche Benchmarkaufgaben mit und ohne Übersicht.

## Abschlusskriterien

Die Repository-Übersicht reduziert Suchaufwand bei großen oder unbekannten Projekten, ohne normale kleine Aufgaben messbar zu verlangsamen.

Schwierigkeiten: 8/10 | Thinking: high

---

# Auftrag 11: Doom-Loop-Erkennung ergänzen

## Rolle

Du bist Entwickler für Agentenstabilität und Fehlerwiederherstellung.

## Ziel

Erkenne wiederholte, offensichtlich erfolglose Agentenaktionen und verhindere Endlosschleifen.

## Auftrag

Erzeuge für relevante Tool-Aufrufe eine normalisierte Signatur aus:

- Toolname,
- wesentlichen Argumenten,
- Zielpfad,
- Fehlerklasse,
- Exit-Code,
- optionalem Ergebnis-Hash.

Erkenne mindestens:

- identischer fehlgeschlagener Tool-Aufruf zweimal,
- gleiche Fehlerklasse dreimal ohne neue Information,
- wiederholtes Lesen derselben Datei ohne neue Begründung,
- unveränderter Testfehler nach mehreren Reparaturversuchen,
- Wechsel zwischen zwei identischen Zuständen,
- mehrfach fehlgeschlagener Edit mit gleichem Suchmuster,
- Prozess-Timeout.

Bei Erkennung:

1. aktuelle Strategie stoppen,
2. Schleife sichtbar melden,
3. bisherige Versuche kompakt zusammenfassen,
4. alternative Strategie verlangen,
5. optional Scout, Reviewer oder Oracle vorschlagen,
6. bei fehlender sicherer Alternative in `blocked` wechseln.

## Nicht-Ziele

- Keine allgemeine Selbstreflexion nach jedem Schritt.
- Kein zweites Modell für jede Schleifenerkennung.
- Keine Blockierung legitimer wiederholter Tests mit verändertem Code.
- Keine unsichtbare automatische Eskalation von Rechten.

## Änderungsregeln

- Ähnliche, aber fachlich unterschiedliche Aufrufe nicht pauschal gleichsetzen.
- Nutzerinitiierte Wiederholung erlauben.
- Schwellenwerte konfigurierbar, aber mit konservativen Defaults.
- Historie pro aktiver Aufgabe beziehungsweise Execution-ID führen.
- Schleifendaten nach Abschluss oder Aufgabenwechsel bereinigen.

## Verifikation

Teste:

- identischer fehlgeschlagener Befehl,
- gleicher Test nach unverändertem Code,
- gleicher Test nach geändertem Code,
- wiederholtes Lesen,
- legitime Polling-Aktion,
- Timeout,
- neue Strategie nach Warnung,
- Nutzerfreigabe zur Wiederholung.

## Abschlusskriterien

Pi stoppt erkennbare Wiederholungsschleifen, ohne normale iterative Fehlersuche unnötig zu blockieren.

Schwierigkeiten: 8/10 | Thinking: high

---

# Auftrag 12: Edit-Fallbacks und Edit-Metriken ergänzen

## Rolle

Du bist Entwickler für zuverlässige Codeänderungen durch Sprachmodelle.

## Ziel

Mache Dateiänderungen robuster, kleiner und messbar nachvollziehbar.

## Auftrag

Definiere diese Fallback-Reihenfolge:

1. kleine Änderung über präzises `edit`,
2. bei fehlendem Match betroffenen Ausschnitt erneut lesen,
3. Suchmuster einmal präzisieren,
4. größeren strukturierten Patch verwenden,
5. vollständiges `write` nur bei:
   - neuen Dateien,
   - sehr kleinen Dateien,
   - ausdrücklich begründetem vollständigem Ersatz.

Erfasse Metriken:

- Anzahl Edit-Versuche,
- fehlgeschlagene Matches,
- Patchgröße,
- vollständig ersetzte Dateien,
- unbeabsichtigt geänderte Zeilen,
- notwendige Reparaturversuche,
- verwendetes Modell,
- Thinking-Level.

Definiere Warnungen für:

- vollständiges Überschreiben großer vorhandener Dateien,
- sehr große Patches bei kleinem Auftrag,
- wiederholte Edit-Fehler,
- Formatierung großer unbeteiligter Bereiche.

## Nicht-Ziele

- Kein AST-Framework als Pflicht.
- Keine automatische vollständige Datei-Neugenerierung.
- Kein modellabhängiger Sondercode ohne Messdaten.
- Keine unsichtbare Änderung von Nutzerdateien.

## Änderungsregeln

- Bestehenden Dateistil erhalten.
- Nutzeränderungen außerhalb des Auftrags erhalten.
- Vor größerem Ersatz aktuellen Dateiinhalt erneut lesen.
- Nach jedem Patch Diff prüfen.
- Fallbackschritte und Gründe in Diagnoseinformationen erfassen.

## Verifikation

Teste:

- einfacher exakter Edit,
- mehrfach vorkommender Suchtext,
- veralteter Dateikontext,
- große Datei,
- neue Datei,
- fehlgeschlagener Patch,
- vollständiger Ersatz mit und ohne Berechtigung,
- zwei unterschiedliche Modelle.

Vergleiche die Benchmarkqualität vor und nach der Änderung.

## Abschlusskriterien

Edits scheitern seltener, vollständige Dateiersetzungen werden reduziert und die Qualität verschiedener Modelle kann anhand realer Edit-Metriken verglichen werden.

Schwierigkeiten: 8/10 | Thinking: high

---

# Auftrag 13: Regelbasiertes Modell-Routing vereinheitlichen

## Rolle

Du bist Architekt für Multi-Provider-Modellrouting.

## Ziel

Nutze die vorhandenen Rollen `fast`, `primary` und `deep` konsistent und nachvollziehbar.

## Nicht-Ziele

- Kein zusätzliches Modell zur Routing-Entscheidung aufrufen.
- Kein unsichtbarer Anbieterwechsel.
- Keine automatische Kostenentscheidung ohne sichtbare Regeln.
- Keine dauerhafte Bindung an einen einzelnen Provider.
- Keine übergroße Modellliste in der normalen UI.

## Auftrag

Definiere eine zentrale Zuordnung:

### `fast`

Für:

- Suche,
- Dateiauswahl,
- Formatierung,
- einfache Konfiguration,
- kompakte Zusammenfassungen,
- Scout-Aufgaben.

### `primary`

Für:

- normale Implementierungen,
- lokale Bugs,
- Tests,
- mittlere Multi-Datei-Aufgaben,
- Standardreviews.

### `deep`

Für:

- Architektur,
- große Refactorings,
- schwierige Fehler,
- sicherheitskritische Reviews,
- Oracle-Aufgaben.

Definiere außerdem Thinking-Defaults pro Kombination aus Rolle und Workflow.

Beispiel:

- `fast` + Scout → low oder medium,
- `primary` + Work → high,
- `deep` + Architekturplan → xhigh,
- `deep` + Review → high oder xhigh.

Der Nutzer muss jederzeit erkennen:

- aktive Rolle,
- tatsächliches Modell,
- Provider,
- Thinking-Level,
- manuelle oder automatische Auswahl.

Automatische Wechsel zunächst nur als Empfehlung oder vorab festgelegter Workflow-Wechsel durchführen.

## Änderungsregeln

- Rollen nur zentral konfigurieren.
- Modell muss in `enabledModels` vorhanden sein.
- Ungültige Rolle oder fehlendes Modell fail-closed behandeln.
- Manueller Modellwechsel hat Vorrang, bis Auto wieder aktiviert wird.
- Providerfehler nicht automatisch durch ein deutlich teureres Modell kaschieren.
- Fallbacks sichtbar melden.

## Verifikation

Teste:

- gültige Rollen,
- fehlendes Rollenmodell,
- Modell nicht aktiviert,
- manueller Override,
- Auto-Rückkehr,
- Providerfehler,
- Sessionwiederherstellung,
- Subagentenrolle,
- UI-Anzeige,
- Doctor-Diagnose.

Benchmark:

- kleine Aufgaben mit `fast`,
- Standardaufgaben mit `primary`,
- schwere Aufgaben mit `deep`,
- Vergleich von Qualität, Kosten und Laufzeit.

## Abschlusskriterien

Modellwahl und Thinking sind konsistent, sichtbar und über eine einzige Konfigurationsquelle steuerbar. Automatisches Routing bleibt regelbasiert und überprüfbar.

Schwierigkeiten: 8/10 | Thinking: high

---

# Auftrag 14: LSP bewusst begrenzen und stabilisieren

## Rolle

Du bist Entwickler für Language-Server-Integration und Prozesssicherheit.

## Ziel

Erhalte LSP als optionales Navigations- und Diagnosewerkzeug, ohne es zur zentralen Pi-Abhängigkeit auszubauen.

## Auftrag

Begrenze den offiziell unterstützten Funktionsumfang auf:

- Diagnostics,
- Document Symbols,
- Workspace Symbols, sofern zuverlässig,
- Definition,
- References.

Prüfe und dokumentiere:

- Lazy Start,
- Projektvertrauen,
- erlaubte Serverprofile,
- Projektpfadgrenzen,
- Symlink-Schutz,
- Dateigrößenlimit,
- Request-Timeout,
- Idle-Shutdown,
- Prozessbereinigung,
- Verhalten bei abgestürztem Sprachserver.

Setze `auto` so um, dass Sprachserver nur bei tatsächlichem LSP-Aufruf starten.

## Nicht-Ziele

- Keine automatische Sprachserverinstallation.
- Keine dauerhaften Server für ungenutzte Sprachen.
- Keine automatische Codeänderung über LSP.
- Kein LSP als Ersatz für Tests oder Compiler.
- Keine semantische Dauerindexierung.

## Änderungsregeln

- Projektgrenzen bei allen Pfadangaben prüfen.
- Bei LSP-Fehlern auf normale Suche zurückfallen.
- Fehlender Sprachserver ist kein globaler Pi-Fehler.
- Prozesse bei Sessionende zuverlässig beenden.
- Konkrete Diagnose statt generischem „LSP fehlgeschlagen“.

## Verifikation

Teste:

- Projekt mit funktionierendem LSP,
- Projekt ohne Server,
- nicht vertrauenswürdiges Projekt,
- Datei außerhalb des Projekts,
- Symlink,
- zu große Datei,
- Timeout,
- Serverabsturz,
- Idle-Shutdown,
- Sessionwechsel.

## Abschlusskriterien

LSP verbessert Navigation und Diagnose bei geeigneten Projekten, erzeugt aber keine Pflichtabhängigkeit, dauerhaften Hintergrundprozess oder Sicherheitslücke.

Schwierigkeiten: 7/10 | Thinking: high

---

# Auftrag 15: Compaction und Projektgedächtnis absichern

## Rolle

Du bist Architekt für Kontextmanagement langer Agentensitzungen.

## Ziel

Behalte Pi-Core als einzigen Compaction-Eigentümer und `docs/PROJECT_STATE.md` als transparentes Projektgedächtnis.

## Nicht-Ziele

- Keine zusätzliche Memory-Extension.
- Keine automatische Speicherung jeder Beobachtung.
- Keine vollständigen Chats oder Logs in Projektdateien.
- Keine ungeprüften Annahmen als dauerhafte Regeln.
- Keine zweite Compaction-Implementierung.

## Auftrag

Prüfe und vereinheitliche den Context-Checkpoint.

Ein gültiger Checkpoint enthält nur:

- aktuelles Ziel,
- Nicht-Ziele,
- gültige Einschränkungen,
- bestätigte Entscheidungen,
- betroffene Dateien,
- bereits ausgeführte Änderungen,
- erfolgreiche Prüfungen,
- fehlgeschlagene Prüfungen,
- bekannte Fehler,
- offene Risiken,
- nächste drei konkrete Aktionen.

Er darf nicht enthalten:

- vollständige Tool-Logs,
- Chatverläufe,
- Secrets,
- verworfene Optionen ohne aktuellen Erklärungswert,
- ungeprüfte Vermutungen.

Definiere klare Auslöser:

- vor manueller Compaction,
- vor Modellwechsel,
- vor neuer Session innerhalb derselben Aufgabe,
- nach abgeschlossenem größeren Teilabschnitt,
- bei hohem Kontextverbrauch.

Definiere außerdem, wann eine neue Session statt Compaction verwendet werden soll.

## Änderungsregeln

- Projektstatus nur bei erlaubtem Dokumentationsschreiben aktualisieren.
- Keine Compaction automatisch durch den Checkpoint starten.
- Unsicherheiten ausdrücklich markieren.
- Alte abgeschlossene Aufgaben aus dem aktiven Projektstatus entfernen oder archivieren.
- Globale Regeln nicht mit aktuellem Arbeitsstand vermischen.

## Verifikation

Teste:

- lange Sitzung,
- manueller Modellwechsel,
- Compaction,
- Sessionfortsetzung,
- Wechsel des Hauptziels,
- fehlerhafter alter Projektstatus,
- read-only Modus,
- offene Tests,
- verworfene Architekturentscheidung.

Benchmarke insbesondere verlorene Anforderungen nach Compaction.

## Abschlusskriterien

Nach Compaction oder Sessionwechsel bleiben Ziel, Einschränkungen, Änderungen, Prüfstatus und nächste Schritte erhalten, ohne unnötige Logs oder veraltete Annahmen mitzuschleppen.

Schwierigkeiten: 7/10 | Thinking: high

---

# Auftrag 16: Aurora als alleinigen UI-Eigentümer festigen

## Rolle

Du bist TUI-Architekt für performante Terminalanwendungen.

## Ziel

Aurora bleibt alleiniger Eigentümer für alle benutzerdefinierten permanenten UI-Flächen.

## Auftrag

Definiere und erzwinge klare UI-Eigentümerschaft:

### Aurora besitzt

- Editor-Chrome,
- Footer,
- Activity-Anzeige,
- Working-Indikator,
- Workflow-Status,
- Modell- und Thinking-Anzeige,
- Kontextanzeige,
- Subagentenstatus.

### Andere Extensions dürfen

- temporäre Menüs öffnen,
- Notifications auslösen,
- Zustandsdaten an Aurora publizieren.

### Andere Extensions dürfen nicht

- einen zweiten permanenten Footer registrieren,
- einen zweiten permanenten Working-Indikator betreiben,
- eigene dauerhafte Timer für UI-Bewegung behalten,
- Tool-Semantik zur Darstellung verändern,
- vollständige Thinking-Inhalte anzeigen.

Die normale Statusanzeige soll kompakt enthalten:

- Workflow-Phase,
- Modellrolle und Modell,
- Thinking-Level,
- aktuelles Tool oder Subagent,
- Laufzeit,
- Kontextstand,
- Verifikationsstatus,
- `wartet`, `blockiert` oder `möglicherweise festgefahren`.

## Nicht-Ziele

- Keine Terminal-IDE bauen.
- Keine vollständigen Tool-Logs permanent anzeigen.
- Keine aufwendigen Animationen ohne Zustandsnutzen.
- Keine zweite Renderer-Extension.
- Keine Cloud- oder Weboberfläche.

## Änderungsregeln

- Nur ein Motion-Ticker und nur bei aktiver Bewegung.
- `reduced` und `off` dürfen keine Timer behalten.
- Alle Listener und Timer bei Shutdown oder Sessionwechsel entfernen.
- Kleine Terminalbreiten unterstützen.
- Status darf Eingabe und Toolausgabe nicht verdecken.
- Kein messbarer Eingabelag durch UI-Aktualisierung.

## Verifikation

Teste:

- normale Sitzung,
- Tool-Aufruf,
- Subagent,
- Planphase,
- Workphase,
- Review,
- Blockierung,
- Terminalbreiten,
- Motion-Modi,
- Shutdown,
- Sessionwechsel,
- längere Laufzeit.

Messe:

- Eingabelatenz,
- CPU im Idle,
- Anzahl aktiver Timer,
- verbleibende Listener,
- Renderfehler.

## Abschlusskriterien

Aurora besitzt eindeutig alle permanenten UI-Flächen. Es existieren keine konkurrierenden Renderer, Footer, Statuswidgets oder verbleibenden Animationstimer.

Schwierigkeiten: 7/10 | Thinking: high

---

# Auftrag 17: Architektur-No-Gos festhalten und absichern

## Rolle

Du bist leitender Systemarchitekt und schützt das Pi-Setup vor unnötiger Komplexität.

## Ziel

Dokumentiere und prüfe klare Grenzen, welche Architekturkonzepte nicht ohne neuen, messbaren Nutzen eingeführt werden dürfen.

## No-Gos

### Keine Multi-Agent-Teams

Keine Agenten, die frei miteinander diskutieren, Aufgaben weiterdelegieren oder gemeinsame autonome Pläne verwalten.

### Keine automatischen Modell-Debatten

Ein zweites starkes Modell nur explizit für:

- schwierige Architektur,
- Sicherheitsreview,
- festgefahrene Fehlersuche,
- riskante Änderungen.

### Kein permanenter Repository-Vollindex

Nur bedarfsgesteuerte Übersicht oder bereits vorhandene LSP-Funktionen.

### Keine zweite interne Extension-Plattform

Pi-Extensions und Skills sind ausreichend.

### Kein unkontrolliertes automatisches Gedächtnis

Nur bestätigte Entscheidungen und stabiler Projektzustand dürfen dauerhaft gespeichert werden.

### Keine zweite Workflow-Zustandsmaschine

Alle neuen Workflow-Funktionen müssen die bestehende zentrale Zustandsmaschine verwenden.

### Kein zweiter UI-Eigentümer

Aurora bleibt alleiniger Eigentümer permanenter UI-Flächen.

### Keine automatische Rechteeskalation

Kein Modell, Subagent oder Workflow darf Permission-Level selbstständig erhöhen.

## Auftrag

1. Ergänze diese Grenzen in die verbindliche Architektur.
2. Definiere für neue Extensions eine kurze Aufnahmeprüfung:
   - Welches konkrete Problem wird gelöst?
   - Welche bestehende Funktion reicht nicht?
   - Welche neue Runtime-Komponente entsteht?
   - Welche Latenz und Speicherlast entsteht?
   - Wie wird der Nutzen im Benchmark gemessen?
   - Welche bestehende Komponente kann ersetzt werden?
   - Wie erfolgt der Rückbau?
3. Ergänze `/setup-doctor` oder einen Architekturcheck für:
   - mehrere permanente UI-Eigentümer,
   - mehrere Compaction-Eigentümer,
   - doppelte Konfigurationsquellen,
   - unbegrenzte Subagenten-Parallelität,
   - unbekannte dauerhafte Hintergrundprozesse,
   - nicht gepinnte Runtime-Pakete.
4. Definiere: Eine neue Extension wird nur aufgenommen, wenn sie:
   - eine belegte Lücke schließt,
   - im Benchmark einen Nutzen zeigt,
   - klare Zuständigkeit besitzt,
   - vollständig deaktivierbar ist,
   - keine bestehende Kernfunktion dupliziert.

## Nicht-Ziele

- Innovation nicht grundsätzlich verhindern.
- Keine starre Verbotsliste ohne Ausnahmeprozess.
- Keine Entscheidungen allein anhand von Codezeilen treffen.
- Keine automatische Löschung unbekannter Extensions.

## Verifikation

Prüfe die aktuelle Architektur gegen alle No-Gos und liefere:

- erfüllt,
- teilweise erfüllt,
- verletzt,
- nicht beurteilbar.

Führe für jede Abweichung eine konkrete kleinste Korrektur an.

## Abschlusskriterien

Die Architektur besitzt verbindliche, überprüfbare Grenzen gegen unnötige Multi-Agent-, Memory-, Index-, UI- und Extension-Komplexität. Neue Funktionen benötigen einen messbaren Nutzen statt nur eine interessante Idee.

Schwierigkeiten: 6/10 | Thinking: high
