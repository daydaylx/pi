# Benchmark-Baseline: Pi vs. andere Coding-Agenten

> **Historisches Dokument.** Die beschriebene Infrastruktur (`benchmarks/`)
> wurde am 2026-09-04 archiviert und existiert auf `main` nicht mehr.
> Aktueller Stand: [`docs/benchmark-history.md`](../benchmark-history.md).
> Reproduzierbarer Archivstand: Tag `benchmark-legacy-v1-v3-2026-09-04`.
>
> Methodik-Dokument für Issue [#108](https://github.com/daydaylx/pi/issues/108).
> Ursprüngliche Infrastruktur (nur im Archiv-Tag erreichbar): `benchmarks/`,
> Runbook `benchmarks/RUNBOOK.md`.

## Ziel

Objektiven Qualitätsvergleich zwischen Pi-Konfigurationen und externen
Coding-Agenten (Codex CLI, Claude Code, Gemini CLI) unter identischen,
reproduzierbaren Bedingungen.

## Infrastruktur (bereits vorhanden)

| Komponente            | Pfad                                           | Zweck                                                                                   |
| --------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| 10 Aufgabentypen      | `benchmarks/tasks/01-–10-*/`                   | Ausgangszustand, Auftrag, erwartetes Ergebnis, verbotene Änderungen                     |
| `reset-task.sh`       | `benchmarks/harness/`                          | Setzt jede Aufgabe auf ihren definierten Ausgangszustand zurück                         |
| `run-verify.sh`       | `benchmarks/harness/`                          | Führt Task-spezifische Verifikation aus                                                 |
| `collect-metrics.mjs` | `benchmarks/harness/`                          | Sammelt automatische Metriken (geänderte Dateien/Zeilen, Testresultate, Token/Laufzeit) |
| `run-baseline.sh`     | `benchmarks/harness/`                          | Verkettet Reset → Verify → Collect für einen Lauf                                       |
| `RUNBOOK.md`          | `benchmarks/`                                  | Schritt-für-Schritt-Anleitung für einen manuellen Lauf                                  |
| `SCORING.md`          | `benchmarks/`                                  | Bewertungskriterien: automatisch vs. subjektiv                                          |
| Pilot-Result          | `benchmarks/results/02-local-bug-pilot-*.json` | Validiert den Harness (Aufgabe 02, 1 Lauf)                                              |

## Aufgabentypen

| ID  | Typ                                 | Besonderheit                           |
| --- | ----------------------------------- | -------------------------------------- |
| 01  | Ein-Datei-Änderung                  | Präzise, kleine Änderung               |
| 02  | Lokaler Bug                         | Fixture-Test (verify-prüfbar)          |
| 03  | Fehlgeschlagener Unit-Test          | Fixture-Test (verify-prüfbar)          |
| 04  | Multi-Datei-Änderung                | Änderung über mehrere Dateien          |
| 05  | Refactoring ohne Verhaltensänderung | Fixture-Test (verify-prüfbar)          |
| 06  | Navigation in unbekanntem Code      | Testfrei (manuelle Bewertung)          |
| 07  | Unterbestimmter Auftrag             | Bewertung der Rückfrage-Qualität       |
| 08  | Lange Sitzung mit Compaction        | Kontext-Erhalt prüfen                  |
| 09  | Hängender Tool-Aufruf               | Kein Fixture-Test (manuelle Bewertung) |
| 10  | Mit/ohne Subagent                   | Subagenten-Nutzen messen               |

## Vergleichskandidaten

| Agent                      | Konfiguration                                       | Thinking          | Permission            |
| -------------------------- | --------------------------------------------------- | ----------------- | --------------------- |
| **Pi (aktuell)**           | `setup.json` default, Aurora Night, `project-write` | auto              | `project-write`       |
| **Pi (vorherige Version)** | Letzter stabiler Tag vor aktuellen Änderungen       | auto              | `read-write` (Legacy) |
| **Codex CLI**              | Default                                             | medium-equivalent | Standard              |
| **Claude Code**            | Default                                             | medium-equivalent | Standard              |
| **Gemini CLI** (optional)  | Default                                             | medium-equivalent | Standard              |

## Messgrößen (automatisch)

| Metrik                          | Quelle                                        |
| ------------------------------- | --------------------------------------------- |
| Erfolg ohne Nachkorrektur       | `collect-metrics.mjs` + `manualAssessment`    |
| Benötigte Nutzerkorrekturen     | `manualAssessment`                            |
| Unnötig geänderte Dateien       | versionierter Workspace-Snapshot vs. erwarteten Scope |
| Unnötig geänderte Zeilen        | staged, unstaged und untracked Snapshot-Daten |
| Fehlgeschlagene Tool-Aufrufe    | `isError: true` im Session-Verlauf            |
| Test-/Typecheck-/Build-Ergebnis | `run-verify.sh` Exit-Code                     |
| Tokenverbrauch                  | Session-Metadaten                             |
| Laufzeit                        | Session-Metadaten                             |
| Modellaufrufe                   | Session-Metadaten                             |
| Subagentenaufrufe               | Session-Metadaten                             |
| Verlorene Anforderungen         | `manualAssessment`                            |
| Wiederholte identische Fehler   | Session-JSONL (`toolCall`/`toolResult`)       |
| Verifikations-Ergebnis          | `run-verify.sh` Exit-Code                     |
| Unnötige Edit-Wiederholungen    | `git diff --numstat` + manuelle Scope-Prüfung |

## Workspace-Snapshot

P4 und der allgemeine Collector verwenden denselben versionierten Snapshot. Er
enthält den Git-Stand, staged und unstaged Änderungen, untracked Dateien,
Renames und Deletes sowie einen inhaltssensitiven Fingerprint. Ergebnisdaten
enthalten nur Pfade, Zustände und Hashes; Patches, Dateiinhalte und absolute
Pfade werden nicht gespeichert. Damit ist ein erfolgreicher Lauf mit
indexierten oder untracked Agentenänderungen nicht länger unsichtbar.

## Stichproben-Design

- **3 Wiederholungen** pro Aufgabe × Agent (mindestens)
- Bei stark schwankenden Ergebnissen: **5 Wiederholungen**
- **10 Aufgaben × 3 Läufe × 5 Agenten = 150 Läufe** (Gesamtumfang)
- P3: Aufgaben 01–09 je drei Läufe plus drei A/B-Paare für Aufgabe 10 =
  **33 Scored-Runs**, externe Agenten später

## Ablauf pro Lauf

1. **Reset:** `run-baseline.sh prepare <task-id>` → Ausgangszustand herstellen
2. **Agent-Lauf:** Pi mit `TASK.md`-Auftragstext starten, Agent arbeiten lassen
3. **Verify + Collect:** `run-baseline.sh finish <task-id>` → Fixture-Test +
   Metriken sammeln
4. **Manuelle Bewertung:** `manualAssessment` im Result-JSON ausfüllen
   (Nachkorrekturen, verlorene Anforderungen, Scope-Treue)

## Auswertung

Pro Agent-Konfiguration:

- Erfolgsquote gesamt und pro Aufgabentyp
- Häufigste Fehlerklassen
- Durchschnittliche Laufzeit und Tokenverbrauch
- Scope-Treue (unnötige Änderungen)
- Stabilität (Streuung über Wiederholungen)

## Nächste Schritte

1. **Pi-P3-Baseline (33 Scored-Runs):** Die feste P3-Serie mit `prepare`,
   `launch`, `finish` und `cleanup` gemäß `benchmarks/RUNBOOK.md` ausführen.
2. **Externe Agenten:** gleiches Protokoll für Codex CLI / Claude Code
3. **Regressionstest:** nach jeder Pi-Architekturänderung Baseline wiederholen
4. **Benchmark versionieren:** `TASK.md`-Änderungen mit Git tracken
