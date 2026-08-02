# Runbook: einen Benchmark-Lauf durchführen

Alle Befehle relativ zum Repository-Root (`/home/d/.pi/agent`) ausgeführt.

## P3-Controller (33 Scored-Runs)

P3 ist von der älteren Einzelrun-Kurzform unten getrennt. Es nutzt immer
Commit `e46915680d859ac9d6cac615cc197d5a31d46461`, die feste Manifest-ID und
einen privaten State-Ordner unter
`${XDG_STATE_HOME:-~/.local/state}/pi-p3` (0700). Ergebnisse gehören **nie**
nach `benchmarks/results/`.

Alle P3-Scored-Runs pinnen `opencode-go/kimi-k2.7-code` mit Thinking-Stufe
`high`; eine Änderung dieser Modellkonfiguration erfordert eine neue
Manifest- und Baseline-Serie.

```bash
# Einmal vor dem Start: Manifest, Referenzcommit und GNU time prüfen
node benchmarks/harness/p3.mjs validate

# Je Scored-Run: Worktree + expliziten Session-Pfad anlegen, starten,
# Metriken abschließen und die Symlinks/den Worktree entfernen
node benchmarks/harness/p3.mjs prepare p3-01-1
node benchmarks/harness/p3.mjs launch p3-01-1
node benchmarks/harness/p3.mjs finish p3-01-1
node benchmarks/harness/p3.mjs cleanup p3-01-1

# Fortschritt aller 33 Scored-Runs
node benchmarks/harness/p3.mjs summarize
```

`launch` nutzt stets den in den lokalen Metadaten gespeicherten, expliziten
`--session`-Pfad; es sucht nie globale Sessions. Jeder Scored-Start läuft
unter GNU `time -v`; CPU-Zeit, Wall-Clock-Zeit und Peak RSS landen in
`automatic.resources`. `automatic.environment` enthält nur Referenz,
Hash der fest allowlisteten nicht-sensitiven Konfigurationsdateien und
Laufzeit-Fingerprints. Es protokolliert außerdem die effektiven,
nicht-sensitiven Benchmark-Overlays und Umgebungswerte.

`prepare` setzt ausschließlich im isolierten Worktree die drei
`permissions.workflowDefaults` auf `full-access`; dadurch kann der Agent die
ausdrücklich gestellte Benchmark-Aufgabe bearbeiten, ohne die Konfiguration
des Haupt-Checkouts zu verändern. Der Controller setzt keine Ledger- oder
Checkpoint-Gates.

Während `prepare` läuft, ist `PI_CODING_AGENT_DIR` der Worktree. Der
nicht-sensitive Abhängigkeitsbaum `npm/node_modules` wird für die
Modulauflösung verlinkt; `auth.json` und `models-store.json` sind die einzigen
Credential-Symlinks. Ihr Inhalt wird vom Controller weder gelesen, kopiert
noch ausgegeben. `cleanup` entfernt zuerst genau diese Credential-Symlinks
und dann den Worktree. Mit `cleanup <id> --purge` lässt sich auch der lokale
Zustand für eine Wiederholung entfernen.

Die V8-Profile sind bewusst unbewertet und separat: `p3-diag-02-v8-cpu`,
`p3-diag-02-v8-heap`, `p3-diag-09-v8-cpu`, `p3-diag-09-v8-heap`.

Der Offline-Test verwendet einen lokalen Pi-Stummel und ruft kein Modell auf:

```bash
node benchmarks/harness/test/p3.test.mjs
```

## Kurzform: `harness/run-baseline.sh`

Verkettet Schritt 1 (Reset), 3 (Verify) und 4 (Metriken sammeln) für einen
einzelnen Lauf. Schritt 2 (Agent arbeiten lassen) und Schritt 5 (manuelle
Bewertung) bleiben bewusst manuell — siehe `SCORING.md`, "Automatisch vs.
subjektiv".

```bash
# 1. Worktree vorbereiten, Fensterstart notieren
benchmarks/harness/run-baseline.sh prepare <task-id> [worktree-basisverzeichnis]

# 2. Pi im ausgegebenen Worktree-Pfad starten, TASK.md-Auftragstext übergeben

# 3. Verify + Metriken einsammeln (findet die Session-Datei automatisch über
#    das Fensterstart-/Sessionverzeichnis-Muster; bei mehreren Treffern im
#    Fenster oder abweichendem Session-Verzeichnis --session <pfad> explizit
#    angeben)
benchmarks/harness/run-baseline.sh finish <task-id> [worktree-basisverzeichnis] \
  [--allowed-files "a,b,c"] [--session <pfad> ...]
```

Aufgaben mit Fixture-Test (02, 03, 05) und testfreie Aufgaben (06, 09)
werden vom Skript automatisch erkannt (siehe `FIXTURE_TEST_TASKS`/
`NO_TEST_TASKS` am Skriptanfang) und entsprechend behandelt, statt immer
`npm run verify` aufzurufen. Aufräumen (`git worktree remove`) bleibt
manuell, siehe Schritt 6 unten.

Die folgenden Schritte 1–6 beschreiben denselben Ablauf einzeln, für Fälle,
in denen die Kurzform nicht passt (z. B. Aufgabe 10 mit mehreren
Subagent-Sessions).

## 1. Ausgangszustand herstellen

```bash
benchmarks/harness/reset-task.sh <task-id> [worktree-basisverzeichnis]
```

Beispiel:

```bash
benchmarks/harness/reset-task.sh 01-single-file-change /tmp/pi-benchmark
```

Legt einen isolierten Git-Worktree am Referenzcommit `7b886a3` an, verlinkt
`npm/node_modules` aus dem Haupt-Checkout (kein `npm ci` pro Reset nötig) und
kopiert — falls vorhanden — `tasks/<task-id>/fixture/` nach
`<worktree>/benchmark-fixture/`. Gibt den Worktree-Pfad auf stdout aus. Der
Haupt-Checkout bleibt unberührt.

Für Aufgaben mit Fixture-Overlay (02, 03, 05, 09) liegt der eigentliche
Testgegenstand unter `<worktree>/benchmark-fixture/`, nicht unter
`<worktree>/extensions/` — siehe die jeweilige `TASK.md`.

## 2. Agent in diesem Worktree arbeiten lassen

Pi im Worktree-Pfad starten und den Auftragstext aus der jeweiligen
`TASK.md` (Abschnitt "Auftrag") als Nutzeranfrage übergeben. Notiere Beginn-
und End-Zeitstempel (ISO 8601) für die spätere `--window-start`/
`--window-end`-Filterung bei Subagenten-Metriken.

## 3. Verifikation ausführen

```bash
benchmarks/harness/run-verify.sh <worktree-pfad> > /tmp/verify-result.json
```

Setzt `PI_CODING_AGENT_DIR` auf den Worktree-Pfad (siehe
`harness/BASELINE.md`, Fehlschlag 1) und führt `npm run verify` aus. Schreibt
`{"exitCode": N, "durationMs": N, "logFile": "..."}` nach stdout und ein
vollständiges Log nach `<worktree>/.verify-output.log`.

Aufgaben mit eigenständigem Fixture-Test (02, 03, 05) nutzen stattdessen
`node <worktree>/benchmark-fixture/run-fixture-test.mjs`, da
`extensions/diff-viewer/` bei diesem Referenzcommit nicht Teil des
Haupt-`npm run verify` ist.

## 4. Metriken einsammeln

```bash
node benchmarks/harness/collect-metrics.mjs \
  --task <task-id> \
  --worktree <worktree-pfad> \
  --session <pfad-zur-haupt-session-jsonl> \
  --run-history run-history.jsonl \
  --window-start <iso-start> --window-end <iso-ende> \
  --verify-result /tmp/verify-result.json \
  --allowed-files "<komma-getrennte-liste-aus-TASK.md>" \
  > benchmarks/results/<task-id>-<zeitstempel>.json
```

Bei Aufgabe 10 (mit/ohne Subagent) zusätzlich alle Subagent-Session-Dateien
aus dem Laufzeitfenster über weitere `--session`-Flags übergeben.

Session-Dateien liegen unter `sessions/<cwd-slug>/*.jsonl` — den
tatsächlichen Dateinamen (neuester Zeitstempel im Dateinamen) vor dem
Sammelschritt notieren.

## 5. Ergebnis auswerten

`benchmarks/results/<task-id>-<zeitstempel>.json` enthält:

- `automatic.*`: vollautomatisch erhoben, siehe `SCORING.md`.
- `manualAssessment.*`: alle Felder `null` — vor Abschluss der Bewertung von
  Hand ausfüllen (Abgleich gegen "Erwartetes Ergebnis" und
  "Bewertungskriterien" in der jeweiligen `TASK.md`).

## 6. Aufräumen

```bash
git worktree remove --force <worktree-pfad>
git worktree prune
```

## Vergleich zweier Pi-Konfigurationen

Schritte 1–5 zweimal mit identischer Aufgabe, identischem Ausgangszustand,
aber unterschiedlicher Konfiguration (z. B. anderes `defaultModel` oder
andere Permission-Startstufe) durchführen. Die beiden resultierenden
`run-result.json`-Dateien nebeneinander vergleichen — es gibt bewusst keine
automatische Rangbildung oder Gesamt-Score (siehe Nicht-Ziele in
`README.md`).
