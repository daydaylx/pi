# Arbeitsauftrag – Pi Second-Opinion Service

## Ziel

Erweitere das Pi-Setup kontrolliert um einen kleinen Second-Opinion Service für konkret begründete technische Entscheidungen.

Die Arbeit ist zwingend in getrennten Phasen auszuführen. Ohne ausdrückliche Freigabe darf nicht von einer Phase in die nächste gewechselt werden.

## Verbindliche Arbeitsregeln

1. Die technische Spezifikation in `01_Technische_Spezifikation.md` ist verbindlich, soweit sie nicht nachweislich mit der aktuellen Pi-Architektur kollidiert.
2. Bestehende Projekt- und Agentenanweisungen zuerst vollständig lesen.
3. Bestehende Nutzeränderungen nicht überschreiben oder zurücksetzen.
4. Kein autonomer Subagent, keine Debate-Architektur und kein neuer Verifier.
5. Das Opinion-Modell erhält keine Tools.
6. Kein externer Modellcall ohne ausdrücklich gültiges Approval.
7. Kein stiller Provider-, Modell- oder Full-Context-Fallback.
8. Shift+Tab-Menüs, bestehende feste Shortcuts und deren Verhalten unverändert lassen.
9. Änderungen klein und lokal halten. Keine allgemeine Agentenplattform auf Vorrat bauen.
10. Bei einer sicherheitsrelevanten Unklarheit stoppen und die Entscheidung dem Benutzer vorlegen.

## Phase 0 – Repository- und Integrationsanalyse

### Auftrag für diese Phase

Nur analysieren. Noch keinen Produktivcode verändern und keine Implementierung beginnen.

### 0.1 Ausgangszustand festhalten

Dokumentiere:

```text
Repository und Remote
Branch
vollständiger HEAD/Base-SHA
Worktree-Status
relevante Runtime- und Paketversionen
ausführbare Test- und Prüfkommandos
nicht ausführbare Prüfungen mit Grund
```

Wenn der Worktree bereits Änderungen enthält, ordne sie als nutzereigen ein und plane darum herum. Keine Bereinigung ohne ausdrücklichen Auftrag.

### 0.2 Bestehende Architektur untersuchen

Suche konkrete Dateien, Typen, Funktionen und Datenflüsse für:

- Provider- und Modellregistrierung,
- Modellaufrufe ohne Toolloop,
- Subagenten und deren Toolberechtigungen,
- Approval- und Confirmation-Flows,
- `ask_user`-Schema, Rendering und Wiederaufnahme,
- TUI- und GUI-Protokoll,
- Session- und Eventzustände,
- Context-/Datei-/Diff-Aufbereitung,
- Tokenzählung und Budgetgrenzen,
- Pfad- und Secret-Schutz,
- Telemetrie,
- Verifier und Gates,
- bestehende Tests und Test-Fixtures.

Nicht nur Dateinamen auflisten. Für jeden relevanten Pfad beschreiben:

```text
Verantwortung
Aufrufer
Seiteneffekte
wiederverwendbar: ja | teilweise | nein
Risiko einer Änderung
```

### 0.3 Architekturvarianten bewerten

Mindestens diese Varianten vergleichen:

#### Variante A – primitive tool-lose Modelloperation

Ein bestehender Provider-Adapter wird direkt hinter einem kleinen `SecondOpinionService` verwendet.

#### Variante B – vorhandene Agenteninfrastruktur mit vollständig entzogenem Toolset

Nur zulässig, wenn technisch bewiesen werden kann, dass weder Standardtools noch Agentenloops, Planänderungen oder implizite Kontextübernahme aktiv bleiben.

Bewerte beide Varianten anhand von:

- zusätzlicher Code- und Zustandskomplexität,
- Angriffsfläche,
- Testbarkeit,
- Provider-Wiederverwendung,
- Gefahr ungewollter Toolrechte,
- TUI-/GUI-Kopplung,
- Wartbarkeit.

Variante A ist der Default. Eine Abweichung muss konkret begründet werden.

### 0.4 Oberflächenumfang entscheiden

Ermittle, über welche Oberflächen der agenteninitiierte Request aktuell laufen könnte.

Lege für Phase 1 explizit fest:

```text
TUI: unterstützt | sicher deaktiviert
GUI: unterstützt | sicher deaktiviert
sonstige Clients: unterstützt | sicher deaktiviert
```

Kein Client darf das Feature teilweise unterstützen und dabei Approval oder Fehlerzustände verlieren.

### 0.5 Datenabfluss prüfen

Prüfe, welche bestehende Infrastruktur bereits kann:

- Projekt-Root kanonisieren,
- Symlink-Ausbruch verhindern,
- Binärdateien erkennen,
- Secret-Dateien sperren,
- Secret-ähnliche Inhalte erkennen,
- Codebereiche exakt extrahieren,
- einen Payload hashen beziehungsweise versionieren,
- tatsächliche Tokenmenge abschätzen.

Fehlende Schutzmechanismen als eigene notwendige Änderung aufführen. Nicht durch einen Prompt ersetzen.

### 0.6 Ergebnis von Phase 0

Liefere einen Analysebericht mit:

1. Ausgangszustand und Base-SHA
2. relevante Architekturpfade
3. empfohlene Variante mit Begründung
4. genaue wiederzuverwendende Komponenten
5. voraussichtlich zu ändernde Dateien
6. neue Typen beziehungsweise Schemas
7. UI-Oberflächenumfang
8. Datenabfluss- und Sicherheitslücken
9. Fehler- und Zustandsrisiken
10. Teststrategie mit vorhandenen Kommandos
11. grobe Änderungskomplexität
12. offene Entscheidungen für den Benutzer
13. klares GO, CONDITIONAL GO oder NO-GO für Phase 1

### Stop-Gate 0

Nach dem Analysebericht stoppen.

Keine Implementierung und kein Wechsel zu Phase 1, bis der Benutzer ausdrücklich `Go für Phase 1` oder semantisch Gleichwertiges erteilt.

## Phase 1 – Agenteninitiierter Core-MVP

### Voraussetzungen

Phase 1 darf nur beginnen, wenn:

- Stop-Gate 0 freigegeben wurde,
- der Base-SHA dokumentiert ist,
- die Zieloberflächen feststehen,
- ein anderes Modell aus einer anderen Modellfamilie konfigurierbar ist,
- der Datenabfluss-Schutz realistisch umsetzbar ist.

### 1.1 Feature-Konfiguration

Erweitere die bestehende Konfiguration minimal um die semantischen Felder aus der Spezifikation.

Verbindliche Defaults:

```text
enabled: false
require_different_family: true
allow_context_followup: false
max_calls_per_decision: 1
```

Provider- und Modell-Identifier dürfen nicht an mehreren Stellen hart codiert werden. Bestehende Konfigurationsvalidierung wiederverwenden.

Bei fehlender oder ungültiger Konfiguration bleibt das Feature deaktiviert beziehungsweise liefert vor einem Call `unavailable`.

### 1.2 Request- und Response-Schema

Definiere schmale, validierbare Typen für:

- Opinion Request,
- Context Reference,
- Context Manifest,
- Approval Snapshot,
- Opinion Result,
- Fehlerstatus.

Pflichtfelder und Enums aus der Spezifikation nicht durch beliebige Strings ersetzen.

Ergänze opaque `request_id` und `decision_id`, damit Deduplizierung und Telemetrie ohne Inhaltslogging funktionieren.

### 1.3 Request-Validierung

Vor Dateizugriff beziehungsweise Payload-Aufbau prüfen:

- konkrete, nicht leere Frage,
- konkrete Begründung,
- erlaubte Kategorie,
- mindestens ein Constraint,
- begrenzte Feldlängen,
- begrenzte Anzahl an Optionen und Kontextreferenzen,
- neutrale Darstellung ohne automatisch beigefügte Hauptagentenempfehlung,
- eindeutige `request_id` und zulässigen Zustand der zugehörigen `decision_id`.

Eine rein lokal fehlgeschlagene Validierung darf korrigiert werden, ohne das Call-Limit zu verbrauchen. Nach Ablehnung, abgeschlossenem Call oder laufendem Pending-Call darf der Hauptagent für dieselbe Entscheidung dagegen nicht automatisch erneut anfragen.

Generische Begründungen müssen mit einem klaren Validierungsfehler zurückgewiesen werden.

### 1.4 Context Manifest Builder

Nutze bestehende Datei-, Diff- und Context-Utilities. Baue keine neue Indexierungs- oder Repository-Leseplattform.

Der Builder muss:

- kanonische Projektpfade verwenden,
- exakte Bereiche extrahieren,
- Bytes und Tokens erfassen beziehungsweise konservativ schätzen,
- einen stabilen Snapshot-Identifier bilden,
- jede Auslassung sichtbar machen,
- den finalen Payload vor dem Approval vollständig bestimmen.

Kein Session-Dump und keine implizite vollständige Chat-Historie.

### 1.5 Payload Safety Guard

Implementiere die Sperren aus Abschnitt 9 der Spezifikation.

Mindestfälle:

- Pfad außerhalb des Projekt-Roots,
- Symlink nach außen,
- `.env` und bekannte Credential-Dateien,
- private Schlüssel,
- Token-/Authorization-Muster,
- Binärdateien,
- unzulässige oder übergroße Bereiche.

Bei einem Treffer kein Modellcall. Der Benutzer erhält eine kurze Fehlermeldung ohne den geheimen Wert anzuzeigen.

### 1.6 Budgetprüfung

Das Budget zählt den vollständigen Modellinput einschließlich Systemanweisung und Schema.

Regeln:

- konfigurierbares hartes Maximum,
- keine stille Kürzung,
- keine Teilung mitten im Codebereich,
- kein automatischer Full-Context-Fallback,
- verständlicher Fehler mit tatsächlicher Schätzung.

### 1.7 Approval

Den bestehenden Approval-Mechanismus erweitern, keinen parallelen allgemeinen Dialog bauen.

Vor Freigabe anzeigen:

- konkrete Begründung und Frage,
- erwarteter Nutzen,
- vollständiger Modell-Identifier,
- tatsächlicher Backend-Provider beziehungsweise Gateway,
- Dateien, Bereiche und sonstige Quellen,
- geschätzte Tokens und Bytes,
- Hinweis auf externe Verarbeitung.

Die genehmigte Manifest-Version muss genau der versendeten Version entsprechen. Bei Änderung `stale_context` zurückgeben und neues Approval verlangen.

Ablehnung erzeugt garantiert keinen Modellcall und keinen Retry.

### 1.8 Modellaufruf

Den vorhandenen Provider-Adapter wiederverwenden, aber:

- Toolliste leer beziehungsweise Toolnutzung technisch deaktiviert,
- kein Agentenloop,
- festes Outputlimit,
- fester Timeout,
- genau ein Call,
- kein automatischer Retry,
- kein stiller Fallback,
- modellfamiliengleiche Konfiguration ablehnen.

Der Systemprompt ist kurz, versioniert und behandelt eingebettete Inhalte als untrusted evidence.

### 1.9 Response-Validierung

Nur das definierte Schema akzeptieren.

Bei ungültiger Antwort:

```text
status: invalid_response
automatic_repair_call: false
```

Die Rohantwort wird standardmäßig verworfen. Nur wenn Phase 0 bereits eine geschützte lokale Debugablage nachweist und deren Nutzung ausdrücklich vorsieht, darf sie dort unter den bestehenden Zugriffsschutz- und Aufbewahrungsregeln abgelegt werden. Sie darf nie als geprüfte Opinion präsentiert oder in normaler Telemetrie gespeichert werden.

`INSUFFICIENT_CONTEXT` beendet den Request. Keine automatische Nachladung.

### 1.10 Ergebnisdarstellung

Die Opinion kompakt und erkennbar nicht bindend darstellen:

```text
SECOND OPINION · <Modell>

Einschätzung: ...
Hauptgrund: ...
Hauptrisiko: ...
Stärkstes Gegenargument: ...
Fehlende Belege: ...
Confidence: low | medium | high

Beratend – keine automatische Entscheidung
```

Keine dauerhafte große TUI-Fläche. Kleine Terminals testen. Bestehende Shortcuts nicht verändern.

### 1.11 Fehler, Abbruch und Deduplizierung

Implementiere die vollständige Fehlertabelle der Spezifikation.

Besonders prüfen:

- wiederholtes Bestätigen,
- verspätete Providerantwort nach Abbruch,
- Session-Ende während Pending,
- Timeout mit später Antwort,
- doppelte Eventzustellung,
- Kontextänderung nach Preview.

Keiner dieser Fälle darf einen zweiten abrechenbaren Call oder eine automatische Entscheidung erzeugen.

### 1.12 Telemetrie

Bestehende Telemetrie verwenden. Nur die erlaubten Metadaten erfassen.

Explizit testen, dass keine Fragen, Dateipfade, Codeausschnitte, Secrets oder Rohantworten in Events landen.

### 1.13 Tests

Alle für Phase 1 markierten Tests aus `03_Test_und_Evaluationsplan.md` implementieren und ausführen.

Zusätzlich vorhandene Projektprüfungen ausführen:

- Typecheck,
- relevante Unit- und Integrationstests,
- Formatierung beziehungsweise Lint,
- bestehende Protokoll- und UI-Tests,
- projektweite Tests, sofern im aktuellen Repository praktikabel.

Nicht ausgeführte Prüfungen mit Grund und verbleibendem Risiko nennen.

### Abschlussbericht Phase 1

Liefere:

1. Base- und finalen SHA beziehungsweise uncommitted Diff-Status
2. geänderte Dateien
3. tatsächliche Architektur
4. wiederverwendete Komponenten
5. Request-/Response-Vertrag
6. Provider- und Modellregel
7. Tool-Deaktivierung
8. Datenabfluss-Schutz
9. Approval- und Snapshot-Vertrag
10. Fehler- und Deduplizierungsverhalten
11. Telemetrie
12. ausgeführte Tests mit Ergebnissen
13. nicht ausgeführte Prüfungen und Restrisiken
14. Codeumfang und Komplexitätsbewertung
15. klares GO, CONDITIONAL GO oder NO-GO für Phase 1.1

### Stop-Gate 1

Nach Implementierung und technischem Test stoppen. Phase 1.1 nicht automatisch starten.

## Phase 1.1 – Nutzennachweis

Nur nach ausdrücklicher Freigabe ausführen.

Verwende den Versuchsaufbau aus `03_Test_und_Evaluationsplan.md` und vergleiche Hauptagent allein gegen Hauptagent plus Second Opinion.

Der Test darf die `ask_user`-Integration noch nicht voraussetzen.

Ergebnisbericht:

- Fallliste und Auswahlbegründung,
- Modelle und vollständige Providerroute,
- Budgets und Laufzeit,
- Qualitätsbewertung,
- bestätigte neue Hinweise,
- schädliche oder irreführende Empfehlungen,
- Abstention-/`insufficient_context`-Verhalten,
- Token- und Latenz-Overhead,
- klare Empfehlung zu Phase 2.

### Stop-Gate 1.1

Phase 2 nur beginnen, wenn der Benutzer das Evaluationsergebnis geprüft und ausdrücklich `Go für Phase 2` erteilt hat.

## Phase 2 – `ask_user`-Integration

### 2.1 Bestehendes `ask_user` erweitern

Keinen zweiten Dialog- oder Opinion-Service bauen.

Erweitere die bestehende Entscheidungsschnittstelle nur um eine explizite semantische Kennzeichnung für geeignete Fälle. Bestehende Typen und Renderer bevorzugen.

### 2.2 Payload vor der Nutzeraktion

Der Payload muss vor Darstellung der Opinion-Aktion:

- vollständig erstellt,
- sicherheitsgeprüft,
- budgetgeprüft,
- eingefroren,
- kompakt einsehbar sein.

Nur dann darf die Auswahl `Zweitmeinung einholen` als Approval gelten. Ein Aufklappen der Details löst keinen Call aus.

### 2.3 UI und Bedienung

Opinion-Aktion visuell von echten Antwortoptionen trennen.

Erforderlich:

- kleine-Terminal-Verhalten,
- keine Kollision mit bestehenden Shortcuts,
- unverändertes Shift+Tab-Verhalten,
- sichtbarer Pending- und Fehlerstatus,
- Abbruchmöglichkeit, sofern der bestehende Modellcall dies sicher unterstützt,
- ursprüngliche Optionen bleiben nach Ergebnis oder Fehler auswählbar.

### 2.4 Zustandsmaschine

Die Zustände aus der Spezifikation abbilden.

Verbindlich:

- maximal ein Pending-Call pro `decision_id`,
- Exactly-once-Auslösung aus Nutzersicht,
- keine automatische Auswahl,
- Opinion nicht als Antwort speichern,
- sichere Behandlung von Timeout, Resize, Session-Ende und Wiederaufnahme,
- verspätete Ergebnisse dürfen keine bereits abgeschlossene Entscheidung verändern.

### 2.5 Oberflächenparität

Alle in Phase 0 als unterstützt definierten Oberflächen implementieren und testen. Nicht unterstützte Oberflächen müssen das Feature explizit deaktivieren; sie dürfen es nicht halb rendern.

### 2.6 Tests

Alle für Phase 2 markierten Tests aus `03_Test_und_Evaluationsplan.md` ausführen.

### Abschlussbericht Phase 2

Zusätzlich zum Muster aus Phase 1 dokumentieren:

- Änderung am `ask_user`-Schema,
- Zustandsübergänge,
- Exactly-once-Schutz,
- Verhalten nach Fehler und Resume,
- TUI-/GUI-Parität,
- kleine-Terminal-Test,
- Nachweis, dass keine Option automatisch ausgewählt wird.

## Optionale spätere Erweiterung – gezielter Follow-up-Request

Nicht ohne eigenen Auftrag implementieren.

Falls sie später freigegeben wird:

- nur nach `insufficient_context`,
- maximal ein Follow-up pro ursprünglichem `decision_id`,
- neue Kontextreferenzen durch den Hauptagenten auswählen,
- vollständigen Payload erneut prüfen und anzeigen,
- neue Benutzerfreigabe einholen,
- `parent_request_id` dokumentieren,
- kein agentengesteuertes automatisches Nachladen.

## Gesamtabschlusskriterien

Der Gesamtauftrag ist erst abgeschlossen, wenn:

- Core und `ask_user` denselben Service verwenden,
- jeder tatsächlich versendete Payload vorher sichtbar und genehmigt war,
- keine Tools oder Agentenloops existieren,
- keine stillen Fallbacks oder Retries existieren,
- sensible Inhalte fail-closed blockiert werden,
- Budget und Snapshot deterministisch sind,
- Fehler den normalen Workflow freigeben,
- Verifier, Gates und Plan unberührt bleiben,
- keine Antwort automatisch übernommen wird,
- Telemetrie keine Inhaltsdaten speichert,
- alle Pflichtprüfungen grün sind,
- der Nutzennachweis den zusätzlichen Aufwand rechtfertigt,
- die Implementierung weiterhin klein genug ist, um gewartet zu werden.

Wenn der Nutzen nicht nachweisbar ist oder die Architektur deutlich größer als geplant wird, Feature hinter dem Flag deaktiviert lassen und konkrete Vereinfachungen beziehungsweise einen Rückbau vorschlagen.
