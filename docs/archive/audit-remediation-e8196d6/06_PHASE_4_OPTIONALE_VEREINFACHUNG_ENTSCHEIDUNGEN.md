# Phase 4 – Optionale Vereinfachungen und P2/P3-Entscheidungen

## Scope

F-11, F-12, F-13, F-14, F-15, F-18, F-19, F-23, F-24.

## Grundregel

Diese Phase ist **kein Refactor-Zwang**. Eine Änderung ist nur besser, wenn sie
Netto-Komplexität, Fehlerrisiko oder Wartungskosten nachweislich reduziert.
Weniger Zeilen allein zählen nicht.

P2/P3 dürfen `bewusst behalten` oder `deferred` werden. `deferred` braucht
Grund, Rest-Risiko und konkreten Wiederaufnahme-Trigger.

## 4.1 – F-11 Knip/Dead Exports

`knip` Exportprüfung diagnostisch aktivieren, Treffer klassifizieren und nur
belegte Dead-Code-Fälle entfernen. Dynamische/öffentliche Exporte eng
suppressieren, nicht global abschalten. `gateBlocked()` eindeutig nutzen oder
entfernen.

## 4.2 – F-12 Capability-Bridges

### Defaultentscheidung

**Bewusst behalten**, solange keine konkrete Fehlerklasse oder klare
Netto-Komplexitätsreduktion belegt ist.

Vor möglicher Abstraktion Verhalten, Typguard, Timeout, Default und
fail-open/fail-closed pro Bridge tabellarisch vergleichen. Eine generische
`createCapabilityBridge<T>`-ähnliche Lösung nur übernehmen, wenn sie weniger
Zustände/Indirektion erzeugt und sicherheitsrelevante Defaults sichtbar hält.

## 4.3 – F-13 Permission-Sessionzustand + Legacy-Sunset

Nur bei tatsächlichem Gewinn vereinfachen.

Anforderungen bei Änderung:

- minimale unabhängige Zustandswerte;
- alte Sessions weiterhin lesbar;
- neue Sessions nur noch kanonisches neues Schema schreiben;
- explizite Session-/Schema-Version bzw. eindeutig prüfbare Migration;
- Fixtures für alt/neu/inkonsistent/fehlend;
- dokumentiertes Kriterium, wann Legacy-Leser später entfernt werden darf.

Keine dauerhafte Doppelwelt ohne Sunset-Regel erzeugen.

## 4.4 – F-14 Typ-/Enum-Wahrheitsquellen

Nicht vorab festlegen, dass das Wire-Paket zwingend die Quelle sein muss.
Zuerst Abhängigkeitsrichtung und Runtime-/Buildgrenzen bestimmen.

Dann entweder:

- eine praktisch nutzbare kanonische Laufzeitquelle wählen; oder
- getrennte Definitionen mit strengem automatischem Paritäts-/Contract-Test
  behalten.

CLI/TUI darf nicht unnötig von vorgebauten GUI-Artefakten abhängig werden.

## 4.5 – F-15 zwei `frontend-protocol`-Bedeutungen

Default: **Namen behalten**, wenn eine Umbenennung nur kosmetisch wäre.
Umbenennen nur, wenn F-14 ohnehin eine atomare Konsolidierung erfordert und der
Gewinn die breite Import-/Build-/Doku-Migration rechtfertigt.

Keine halben Alias-Migrationen ohne Enddatum.

## 4.6 – F-18 Normalisierung vs. Bewertung

Nur bestätigte `assess…`-/`allowed…`-Funktionen mit Eingabemutation ändern.
Normalisierung explizit, idempotent und separat testbar machen; Bewertung soll
anschließend pure sein. Sicherheitsresultate/Guardreihenfolge nicht verändern.

## 4.7 – F-19 Pfadbasis – nur bei Phase-0-Bestätigung

Bei Bestätigung:

- echten Repo-Root einmal bestimmen;
- Status/Rename/Delete/untracked auf dieselbe root-relative kanonische Form;
- Unterordneraufruf darf sicherheitsrelevante Repo-Bereiche nicht verlieren;
- Fingerprint-/Schemafolgen bewusst prüfen.

Bei Nicht-Reproduktion: `widerlegt`, keine Codeänderung.

## 4.8 – F-23 Runtime-Version

### Defaultablauf

1. zuerst klären, ob `lastChangelogVersion` überhaupt ein Soll-Pin ist;
2. wenn nein: Metadaten korrigieren oder F-23 widerlegen – **kein Upgrade-Test
   nur wegen der höheren Zahl**;
3. nur wenn ein echter Pin-/Kompatibilitätskonflikt belegt ist, isoliert prüfen,
   ob ein Runtime-Upgrade sinnvoll ist.

Ein Upgrade ist ein eigener risikoreicher Eingriff und soll nicht künstlich in
diese Remediation gezogen werden.

## 4.9 – F-24 Archive/Benchmark-Artefakte

### Defaultentscheidung

`deferred` bzw. bewusst behalten, solange Stage-2-Arbeit oder ihre
Nachvollziehbarkeit noch relevant ist.

In diesem Auftrag:

- keine Benchmark-Rohdaten verschieben/löschen;
- keine neue Archivmigration;
- Aufbewahrungszweck und späteren Trigger dokumentieren.

Beispiel-Trigger: „nach formalem Abschluss und Archivierung der laufenden
Stage-2-Auswertung in einem separaten Housekeeping-Auftrag“.

## Phase-4-Abnahme

- alle Scope-IDs klassifiziert;
- nur Änderungen mit belegtem Netto-Gewinn umgesetzt;
- Migrationen besitzen Rückweg/Sunset, wo nötig;
- fokussierte Tests grün;
- bei großem Querschnittsrefactor optional vollständiges `verify`, sonst bis
  Final warten;
- Arbeitsbaum sauber.
