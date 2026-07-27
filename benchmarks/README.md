# Pi-Qualitätsbenchmark

Reproduzierbarer Aufgabenkatalog, um zu messen, ob eine gegebene
Pi-Konfiguration (Modell, Permission-Startstufe, Subagenten-Policy,
Thinking-Level) reale Entwicklungsaufgaben in diesem Repository korrekt,
sparsam und ohne unnötige Nebenwirkungen löst.

## Ziel

Die bestehende Testsuite (`tests/run.mjs`) prüft Extension-Verhalten,
Zustandsmaschinen, Security-Eigenschaften und TypeScript-Korrektheit. Sie
beantwortet nicht die Frage nach der tatsächlichen Agentenqualität bei
echten Coding-Aufgaben. Dieser Benchmark schließt genau diese Lücke.

## Nicht-Ziele

- Keine Änderung an Pi-Architektur, `extensions/**`, `settings.json` oder
  sonstigem Produktivcode.
- Kein automatisches Ranking oder Gesamt-Score zwischen Modellen/
  Konfigurationen — die Harness liefert Rohmesswerte, keine Bewertungsformel.
- Keine öffentlichen Coding-Benchmarks (SWE-bench, HumanEval etc.) kopiert;
  alle Aufgaben verwenden echten Code aus diesem Repository.
- Keine rein synthetischen Aufgaben ohne Praxisbezug.

## Struktur

```text
benchmarks/
├── README.md              dieses Dokument
├── SCORING.md              Messgrößen-Definitionen, automatisch vs. subjektiv
├── RUNBOOK.md              Schritt-für-Schritt-Anleitung für einen Lauf
├── tasks/<nn-name>/
│   ├── TASK.md             vollständige Spezifikation (8 Pflichtfelder)
│   └── fixture/            nur bei Aufgaben, deren Zieldatei(en) beim
│                           Referenzcommit noch nicht existieren
├── harness/
│   ├── BASELINE.md         bekannte, referenzcommit-eigene Testabweichungen
│   ├── reset-task.sh       Worktree am Referenzcommit anlegen + Fixture kopieren
│   ├── run-verify.sh       npm run verify im Worktree ausführen, Exit-Code/Dauer erfassen
│   ├── collect-metrics.mjs Automatische Messgrößen aus Session-Logs extrahieren
│   ├── p3.mjs              Zustandslokaler Controller für die 35 P3-Scored-Runs
│   ├── p3-manifest.json    unveränderlicher P3-Laufplan (Referenz + A/B-Paare)
│   └── schema/run-result.schema.json   Ausgabeformat
└── results/                Lauf-Ergebnisse (nie erfundene Werte, nur reale Läufe)
```

## Trennung von Produktivcode

`benchmarks/` ist nicht in `settings.json` → `extensions` referenziert,
enthält keine `.ts`-Extension-Module und wird nicht von `tests/run.mjs`
importiert. `npm run verify` prüft `benchmarks/` nicht mit.

## Referenzcommit

Alle Aufgaben referenzieren `7b886a3` ("Überarbeite TUI-Menüs und Dialoge").
Aufgaben, deren betroffene Datei(en) bei diesem Commit noch nicht existieren
(`extensions/diff-viewer/`, `tests/fixtures/fake-lsp.py` waren zum
Zeitpunkt der Konzepterstellung unkommittiert), liefern einen eigenständigen
Fixture-Snapshot unter `tasks/<id>/fixture/` statt eines Patches — siehe
jeweilige `TASK.md` für die Begründung im Einzelfall.

Siehe `harness/BASELINE.md` für bekannte, vom Agenten unabhängige
Testabweichungen bei diesem Referenzcommit.

## Die 10 Aufgabentypen

| ID  | Name                                | Referenzzustand  |
| --- | ----------------------------------- | ---------------- |
| 01  | Kleine Ein-Datei-Änderung           | Commit `7b886a3` |
| 02  | Lokaler Bug                         | Fixture-Snapshot |
| 03  | Fehlgeschlagener Unit-Test          | Fixture-Snapshot |
| 04  | Änderung über mehrere Dateien       | Commit `7b886a3` |
| 05  | Refactoring ohne Verhaltensänderung | Fixture-Snapshot |
| 06  | Navigation in unbekanntem Code      | Commit `7b886a3` |
| 07  | Absichtlich unterbestimmter Auftrag | Commit `7b886a3` |
| 08  | Lange Sitzung mit Compaction        | Commit `7b886a3` |
| 09  | Hängender Tool-Aufruf               | Fixture-Snapshot |
| 10  | Mit/ohne Subagent (zwei Läufe)      | Commit `7b886a3` |

## Änderungsregeln

- Benchmark und Produktivcode bleiben strikt getrennt (siehe oben).
- Keine Benchmarkergebnisse erfinden — `results/` enthält ausschließlich
  Ausgaben echter `collect-metrics.mjs`-Läufe.
- Jede Aufgabe ist auf denselben Ausgangszustand rücksetzbar
  (`harness/reset-task.sh <task-id>`).
- Bewertung so weit wie möglich automatisiert (siehe `SCORING.md`).
- Subjektive Bewertungen sind im Ausgabeformat klar von automatischen
  Messungen getrennt (`manualAssessment` vs. `automatic` in
  `run-result.json`).

## Erster Testlauf

Empfehlung: Aufgaben **02** (lokaler Bug) und **09** (hängender Tool-Aufruf)
zuerst, mit der aktuellen Standardkonfiguration aus `settings.json`.

1. Beide Aufgaben haben eine eindeutige, automatisch prüfbare
   Erfolgsbedingung, was die Harness selbst validiert, bevor subjektivere
   Aufgaben (06, 07, 08, 11) hinzugenommen werden.
2. Aufgabe 09 nutzt ein bereits vorhandenes Fixture
   (`tests/fixtures/fake-lsp.py --hang`) ohne zusätzlichen
   Vorbereitungsaufwand.
3. Beide Aufgaben sind kurze Einzelsitzungen (keine Compaction, kein
   Multi-Run-Vergleich wie Aufgabe 10) — validiert `collect-metrics.mjs` an
   einem einfachen Fall, bevor Zeitfenster-Zuordnung bei Subagenten
   (Aufgabe 10) oder Compaction-Erkennung (Aufgabe 08) getestet werden.

Siehe `RUNBOOK.md` für die konkreten Schritte.

## P3: 35 kontrollierte Läufe

P3 verwendet ausschließlich Commit
`e46915680d859ac9d6cac615cc197d5a31d46461` und den festen Plan in
`harness/p3-manifest.json`: Aufgaben 01–09 je drei Mal, drei A/B-Paare für
Aufgabe 10 sowie ein Ledger-aktiv/deaktiviert-Paar für Aufgabe 11. Die 35
Scored-Runs und die optionalen, unbewerteten V8-Diagnosen für Aufgaben 02 und
09 sind getrennt dokumentiert.

Der Controller schreibt niemals nach `benchmarks/results/`. Worktrees,
Sessions, Ressourcenmessungen und Resultate liegen privat unter
`${XDG_STATE_HOME:-~/.local/state}/pi-p3` (Modus `0700`). Siehe `RUNBOOK.md`
für die stabilen Befehle `validate`, `prepare`, `launch`, `finish`, `cleanup`
und `summarize`.

Jeder isolierte P3-Worktree erhält eine dokumentierte, gehashte
`setup.json`-Overlay mit `full-access` für Arbeits- und Plan-Workflows, damit
die Aufgaben tatsächlich bearbeitbar sind; die Quellkonfiguration bleibt
unverändert. Ledger-Checkpoints sind außerhalb von Aufgabe 11 explizit
deaktiviert, damit ihr Session-Shutdown-Eintrag nicht als aufgabenfremde
Änderung in die Messung fällt.
