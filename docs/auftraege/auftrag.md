# Arbeitsauftrag: Qualitätsbenchmark für den Pi Agent – Pilotphase

> **ÜBERHOLT (2026-07-20):** Der zugrundeliegende Widerspruch ist aufgelöst.
> Auftrag 1 wurde direkt mit der vollen 10-Aufgaben-Version umgesetzt
> (`benchmarks/tasks/01-single-file-change/` … `10-with-without-subagent/`,
> committet in `37b5641`), nicht mit dieser kleineren 3-Fall-Pilotvariante.
> Ein realer Harness-Validierungslauf hat inzwischen stattgefunden (siehe
> `docs/PROJECT_STATE.md`, `benchmarks/results/02-local-bug-pilot-20260720-2228.json`).
> Diese Datei bleibt nur aus Audit-Gründen erhalten und ist kein aktiver
> Auftrag mehr.

> **Übergeordnet:** [Arbeitsaufträge](arbeitsauftraege.md) – dieser Auftrag entspricht Auftrag 1. · [Empfehlungsbericht](../empfehlungsbericht.md) – Strategie-Dach.
> **Beziehung zum Umfang:** Diese Pilotvariante umfasst **3 Testfälle**. Die [Arbeitsaufträge](arbeitsauftraege.md) (Auftrag 1) fordern „mindestens zehn" Aufgabentypen – dieser Auftrag ist die kleinere Pilotvorstufe; die ausbaufähige Vollversion ist dort definiert. _(Aufgelöst, siehe Vermerk oben.)_

## Rolle

Du bist Testarchitekt für KI-Coding-Agenten und entwickelst einen kleinen, reproduzierbaren Qualitätsbenchmark für dieses Repository.

## Ziel

Erstelle eine erste belastbare Benchmark-Grundlage, mit der spätere Änderungen am Pi-Setup objektiv verglichen werden können.

Die Pilotphase soll bewusst klein bleiben. Sie umfasst:

1. ein dokumentiertes Benchmark-Konzept,
2. drei repräsentative Testaufgaben,
3. ein einfaches Ergebnisformat,
4. einen manuellen, aber reproduzierbaren Testablauf.

Noch keine vollständige Automatisierung für zehn oder mehr Aufgaben bauen.

## Nicht-Ziele

- Keine bestehende Pi-Extension verändern.
- Keine Workflow-, Permission-, UI-, LSP- oder Subagentenlogik umbauen.
- Keine Modelle oder Provider wechseln.
- Keine vollständige Benchmark-Plattform entwickeln.
- Keine komplexe Datenbank oder Weboberfläche einführen.
- Keine Ergebnisse erfinden oder nachträglich beschönigen.
- Keine Optimierungen am Pi-Setup durchführen, bevor eine Baseline gemessen wurde.

## Hintergrund

Die vorhandenen Tests prüfen vor allem die technische Korrektheit der Extensions, Zustände, Sicherheitsgrenzen und TypeScript-Implementierung.

Sie beantworten noch nicht zuverlässig:

- Löst Pi reale Coding-Aufgaben beim ersten Versuch korrekt?
- Verändert Pi nur die tatsächlich notwendigen Dateien?
- Wie viele Nutzerkorrekturen sind nötig?
- Welche Tool- oder Edit-Schritte schlagen fehl?
- Verbessern Subagenten, Planung oder hohe Thinking-Level das Ergebnis tatsächlich?
- Welche Konfiguration liefert das beste Verhältnis aus Qualität, Laufzeit und Kosten?

Der Benchmark soll dafür eine kleine, nachvollziehbare Ausgangsbasis schaffen.

## Umfang der Pilotphase

### Aufgabe A: Kleine präzise Änderung

Definiere eine Aufgabe, bei der genau eine kleine Änderung in einer bestehenden Datei erforderlich ist.

Die Aufgabe muss prüfen:

- ob nur die vorgesehene Datei geändert wird,
- ob der Patch klein bleibt,
- ob kein unnötiger Plan oder Subagent verwendet wird,
- ob die passende Prüfung erfolgreich ausgeführt wird.

### Aufgabe B: Lokaler Bugfix

Definiere eine Aufgabe mit einem klar reproduzierbaren Fehler und mindestens einem fehlschlagenden Test.

Die Aufgabe muss prüfen:

- ob Pi die Ursache statt nur das Symptom findet,
- ob der Fix auf den betroffenen Bereich begrenzt bleibt,
- ob der fehlschlagende Test nach der Änderung besteht,
- ob keine unbeteiligten Dateien verändert werden.

### Aufgabe C: Kleine Multi-Datei-Änderung

Definiere eine Aufgabe, die Änderungen in mehreren zusammenhängenden Dateien erfordert.

Die Aufgabe muss prüfen:

- ob Pi den Umfang korrekt erkennt,
- ob ein kurzer Plan einen messbaren Nutzen bringt,
- ob Änderungen zwischen den Dateien konsistent sind,
- ob alle relevanten Prüfungen ausgeführt werden,
- ob Anforderungen während der Umsetzung verloren gehen.

## Anforderungen pro Testaufgabe

Für jede der drei Aufgaben müssen folgende Punkte dokumentiert werden:

### Ausgangszustand

- verwendeter Git-Commit oder Fixture,
- betroffene Dateien,
- bekannte Testlage,
- erforderliche Abhängigkeiten,
- notwendige Umgebung.

### Arbeitsauftrag

- exakter Prompt für den Agenten,
- Ziel,
- Nicht-Ziele,
- erlaubter Änderungsumfang,
- verbotene Änderungen,
- erwartete Verifikation.

### Soll-Ergebnis

- erwartetes Verhalten,
- erwartete geänderte Dateien,
- erlaubte Patchgröße oder grober Änderungsrahmen,
- erwartete Testresultate,
- klare Abbruch- und Erfolgskriterien.

### Messwerte

Erfasse mindestens:

- Erfolg ohne Nachkorrektur: ja/nein,
- vollständig erfüllt, teilweise erfüllt oder fehlgeschlagen,
- geänderte Dateien,
- unnötig geänderte Dateien,
- ungefähre Anzahl geänderter Zeilen,
- fehlgeschlagene Tool-Aufrufe,
- Edit-Wiederholungen,
- ausgeführte Tests und Checks,
- Test- und Build-Ergebnis,
- benötigte Nutzerkorrekturen,
- gestartete Subagenten,
- verwendetes Modell,
- Thinking-Level,
- Workflow-Modus,
- Laufzeit,
- Tokenverbrauch, soweit verfügbar,
- Restfehler oder Unsicherheiten.

## Verzeichnisstruktur

Bevorzuge eine kleine, verständliche Struktur wie:

```text
benchmarks/
├── README.md
├── cases/
│   ├── 01-small-change.md
│   ├── 02-local-bugfix.md
│   └── 03-multi-file-change.md
├── results/
│   └── .gitkeep
└── result.schema.json
```

Eine andere Struktur ist erlaubt, wenn sie nachweislich einfacher oder besser zur vorhandenen Repository-Struktur passt.

## Ergebnisformat

Definiere ein einfaches maschinenlesbares JSON-Format pro Lauf.

Mindestens folgende Felder vorsehen:

```json
{
  "caseId": "01-small-change",
  "runId": "2026-07-20-001",
  "gitCommit": "<commit>",
  "model": "<provider/model>",
  "thinkingLevel": "high",
  "workflowMode": "work",
  "permissionLevel": "read-write",
  "success": true,
  "completion": "complete",
  "changedFiles": [],
  "unexpectedFiles": [],
  "toolFailures": 0,
  "editRetries": 0,
  "subagentCalls": 0,
  "verification": [],
  "durationMs": 0,
  "inputTokens": null,
  "outputTokens": null,
  "userCorrections": 0,
  "lostRequirements": [],
  "residualRisks": [],
  "notes": ""
}
```

Das Schema darf erweitert werden, aber nicht unnötig komplex werden.

## Vorgehen

### Schritt 1: Bestehende Test- und Repository-Struktur prüfen

- vorhandene Tests und Fixtures untersuchen,
- geeignete kleine Zielbereiche identifizieren,
- keine produktiven Kernbereiche unnötig für den Benchmark verändern.

### Schritt 2: Benchmark-Konzept dokumentieren

In `benchmarks/README.md` erklären:

- Zweck,
- Abgrenzung zu den vorhandenen Unit- und Integrationstests,
- Ablauf eines Benchmark-Laufs,
- Rücksetzen auf den Ausgangszustand,
- Bewertung,
- Umgang mit Provider- und Netzwerkfehlern,
- Vergleich mehrerer Konfigurationen.

### Schritt 3: Drei Pilotfälle definieren

- Aufgaben eindeutig beschreiben,
- Soll-Ergebnis und verbotene Änderungen festhalten,
- passende Verifikation bestimmen.

### Schritt 4: Ergebnisformat festlegen

- kleines JSON-Schema erstellen,
- ein ausgefülltes Beispiel als Muster bereitstellen,
- keine erfundenen echten Benchmarkwerte eintragen.

### Schritt 5: Manuellen Testablauf verifizieren

Mindestens einen Trockenlauf dokumentieren:

- Ausgangszustand herstellen,
- Prompt ausführen oder simuliert vorbereiten,
- Änderungen erfassen,
- Tests auswerten,
- Ergebnisdatei erstellen,
- Ausgangszustand wiederherstellen.

Der Trockenlauf darf ohne echten Provider-Aufruf erfolgen, wenn Authentifizierung oder Kosten nicht freigegeben sind. In diesem Fall klar markieren, welche Teile noch nicht real ausgeführt wurden.

## Änderungsregeln

- Änderungen auf `benchmarks/` und zwingend notwendige kleine Test-Fixtures begrenzen.
- Keine Secrets, Auth-Dateien, Sessions oder Providerdaten lesen.
- Keine Pakete installieren oder Dependencies hinzufügen, sofern dies nicht zwingend notwendig und ausdrücklich freigegeben ist.
- Keine bestehende Benchmark- oder Testinfrastruktur ersetzen.
- Keine vollständigen Logs in Ergebnisdateien speichern.
- Providerfehler getrennt von Agentenfehlern behandeln.
- Ergebnisse müssen auf einen konkreten Git-Ausgangszustand zurückführbar sein.
- Subjektive Bewertung klar als subjektiv kennzeichnen.
- Automatisierbare Prüfungen bevorzugen.

## Verifikation

Prüfe am Ende:

1. Existiert eine verständliche Benchmark-Dokumentation?
2. Sind genau drei Pilotaufgaben vollständig definiert?
3. Besitzt jede Aufgabe einen reproduzierbaren Ausgangszustand?
4. Sind Soll-Ergebnis und verbotene Änderungen eindeutig?
5. Können technische Ergebnisse in einem gemeinsamen JSON-Format gespeichert werden?
6. Ist der Ablauf ohne dauerhafte Änderung des Ausgangszustands wiederholbar?
7. Sind Providerfehler von Agentenfehlern getrennt?
8. Wurde keine Pi-Produktivarchitektur verändert?
9. Bestehen weiterhin `npm run typecheck`, `npm test` und `npm run verify`?
10. Ist klar dokumentiert, was erst in einer späteren Ausbaustufe automatisiert wird?

## Ausgabeformat des Agenten

Berichte nach Abschluss ausschließlich in dieser Struktur:

```markdown
## Ergebnis

## Angelegte oder geänderte Dateien

## Pilotaufgaben

## Messkonzept

## Verifikation

## Nicht umgesetzte spätere Ausbaustufen

## Fehler oder Risiken

## Empfehlung
```

## Abschlusskriterien

Der Auftrag ist abgeschlossen, wenn:

- ein dokumentiertes Benchmark-Konzept vorhanden ist,
- drei reproduzierbare Pilotaufgaben definiert sind,
- ein gemeinsames JSON-Ergebnisformat existiert,
- mindestens ein manueller Trockenlauf beschrieben oder durchgeführt wurde,
- keine produktive Pi-Funktion verändert wurde,
- alle bestehenden Prüfungen weiterhin erfolgreich sind,
- die nächste Ausbaustufe klar von der Pilotphase getrennt ist.

## Spätere Ausbaustufe – ausdrücklich noch nicht Teil dieses Auftrags

Erst nach Bewertung der Pilotphase entscheiden, ob folgende Punkte sinnvoll sind:

- Erweiterung auf zehn oder mehr Aufgaben,
- automatische Git-Reset- und Fixture-Verwaltung,
- mehrfach wiederholte Läufe,
- automatische Token- und Laufzeiterfassung,
- Konfigurationsvergleiche,
- Ergebnisberichte und Trendanalyse,
- CI-Ausführung,
- automatisierte Qualitätsbewertung.

Schwierigkeiten: 7/10 | Thinking: high
