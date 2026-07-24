# Benchmark-Baseline: Pi vs. andere Coding-Agenten

> Methodik-Dokument für Issue [#108](https://github.com/daydaylx/pi/issues/108).
> Infrastruktur: [`benchmarks/`](../benchmarks/), Runbook: [`RUNBOOK.md`](../benchmarks/RUNBOOK.md).

## Ziel

Objektiven Qualitätsvergleich zwischen Pi-Konfigurationen und externen
Coding-Agenten (Codex CLI, Claude Code, Gemini CLI) unter identischen,
reproduzierbaren Bedingungen.

## Infrastruktur (bereits vorhanden)

| Komponente | Pfad | Zweck |
|---|---|---|
| 11 Aufgabentypen | `benchmarks/tasks/01-–11-*/` | Ausgangszustand, Auftrag, erwartetes Ergebnis, verbotene Änderungen |
| `reset-task.sh` | `benchmarks/harness/` | Setzt jede Aufgabe auf ihren definierten Ausgangszustand zurück |
| `run-verify.sh` | `benchmarks/harness/` | Führt Task-spezifische Verifikation aus |
| `collect-metrics.mjs` | `benchmarks/harness/` | Sammelt automatische Metriken (geänderte Dateien/Zeilen, Testresultate, Token/Laufzeit) |
| `run-baseline.sh` | `benchmarks/harness/` | Verkettet Reset → Verify → Collect für einen Lauf |
| `RUNBOOK.md` | `benchmarks/` | Schritt-für-Schritt-Anleitung für einen manuellen Lauf |
| `SCORING.md` | `benchmarks/` | Bewertungskriterien: automatisch vs. subjektiv |
| Pilot-Result | `benchmarks/results/02-local-bug-pilot-*.json` | Validiert den Harness (Aufgabe 02, 1 Lauf) |

## Aufgabentypen

| ID | Typ | Besonderheit |
|---|---|---|
| 01 | Ein-Datei-Änderung | Präzise, kleine Änderung |
| 02 | Lokaler Bug | Fixture-Test (verify-prüfbar) |
| 03 | Fehlgeschlagener Unit-Test | Fixture-Test (verify-prüfbar) |
| 04 | Multi-Datei-Änderung | Änderung über mehrere Dateien |
| 05 | Refactoring ohne Verhaltensänderung | Fixture-Test (verify-prüfbar) |
| 06 | Navigation in unbekanntem Code | Testfrei (manuelle Bewertung) |
| 07 | Unterbestimmter Auftrag | Bewertung der Rückfrage-Qualität |
| 08 | Lange Sitzung mit Compaction | Kontext-Erhalt prüfen |
| 09 | Hängender Tool-Aufruf | Kein Fixture-Test (manuelle Bewertung) |
| 10 | Mit/ohne Subagent | Subagenten-Nutzen messen |
| 11 | Context-Ledger-Survival | Context-Ledger nach Compaction/Session-Wechsel |

## Vergleichskandidaten

| Agent | Konfiguration | Thinking | Permission |
|---|---|---|---|
| **Pi (aktuell)** | `setup.json` default, Aurora Night, `read-write` | auto | `read-write` |
| **Pi (vorherige Version)** | Letzter stabiler Tag vor aktuellen Änderungen | auto | `read-write` |
| **Codex CLI** | Default | medium-equivalent | Standard |
| **Claude Code** | Default | medium-equivalent | Standard |
| **Gemini CLI** (optional) | Default | medium-equivalent | Standard |

## Messgrößen (automatisch)

| Metrik | Quelle |
|---|---|
| Erfolg ohne Nachkorrektur | `collect-metrics.mjs` + `manualAssessment` |
| Benötigte Nutzerkorrekturen | `manualAssessment` |
| Unnötig geänderte Dateien | `git diff --stat` vs. erwarteten Scope |
| Unnötig geänderte Zeilen | `git diff --numstat` |
| Fehlgeschlagene Tool-Aufrufe | `isError: true` im Session-Verlauf |
| Test-/Typecheck-/Build-Ergebnis | `run-verify.sh` Exit-Code |
| Tokenverbrauch | Session-Metadaten |
| Laufzeit | Session-Metadaten |
| Modellaufrufe | Session-Metadaten |
| Subagentenaufrufe | Session-Metadaten |
| Verlorene Anforderungen | `manualAssessment` |
| Wiederholte identische Fehler | Doom-Loop-Detektor-Status |
| Verifikations-Gate-Ergebnis | `/verify-gate` Output |
| Edit-Wiederholungen | Edit-Metriken |

## Stichproben-Design

- **3 Wiederholungen** pro Aufgabe × Agent (mindestens)
- Bei stark schwankenden Ergebnissen: **5 Wiederholungen**
- **10 Aufgaben × 3 Läufe × 5 Agenten = 150 Läufe** (Gesamtumfang)
- Reduzierter Umfang für erste Baseline: nur Pi (aktuell) × 10 Aufgaben × 3
  Läufe = **30 Läufe**, externe Agenten später

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

1. **Pi-Baseline (30 Läufe):** `run-baseline.sh` für alle 10 Aufgaben, je 3×
2. **Externe Agenten:** gleiches Protokoll für Codex CLI / Claude Code
3. **Regressionstest:** nach jeder Pi-Architekturänderung Baseline wiederholen
4. **Benchmark versionieren:** `TASK.md`-Änderungen mit Git tracken
