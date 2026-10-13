# Phase 0 – Baseline und Befundvalidierung

## Ziel

Den realen Ausgangsstand erfassen, ausführbare Baselineprüfungen nachholen und
unsichere Befunde belegen. In dieser Phase keinen Produktivcode ändern.

## 0.1 – HEAD und Umgebung

1. aktuellen Default-Branch und HEAD erfassen;
2. prüfen, ob `e8196d6` Vorfahr des aktuellen HEAD ist;
3. Änderungen seitdem nach Produktcode/Tests/Doku trennen;
4. Node/npm gegen `.nvmrc`, `engines` und Lockfile prüfen;
5. Arbeitsbranch anlegen, Base-SHA festhalten;
6. `git status --short` und relevante Worktrees/Submodule protokollieren.

### Abschluss

- Base-SHA/Branch/Runtime stehen in `09_STATUS_EVIDENZ.md`;
- betroffene F-IDs wurden bei neueren Produktänderungen neu bewertet;
- Fremdänderungen sind klar abgegrenzt;
- keine Produktdatei wurde verändert.

## 0.2 – Baseline

Reproduzierbar nach Lockfile installieren:

`npm ci --prefix npm --engine-strict`

Dann einmal vollständig ausführen:

- `npm --prefix npm run verify`
- `npm --prefix npm run test:protocol-package`
- `npm --prefix npm run test:frontend-server`
- `npm --prefix npm test`

Protocol/Frontend separat sind in der Baseline noch absichtlich nötig, weil
F-07 gerade prüfen soll, ob sie im Pflichtprofil fehlen.

Fehler klassifizieren als `vorhanden`, `infrastrukturbedingt` oder
`auditbezogen`. Nichts überspringen oder durch Baselineänderungen kaschieren.

## 0.3 – F-01/F-02 reproduzieren

In einem temporären Repository getrennt prüfen:

- Textdiff deutlich >1 MiB;
- Binärdiff deutlich >1 MiB;
- große untracked Datei;
- staged + unstaged Kombination.

Erfassen:

- exakte Diff-/Dateigröße;
- welcher Unterpfad puffert/materialisiert;
- Exitcode/Signal/Fehlerform;
- Verhalten von `collectWorkspaceSnapshot()`;
- Auswirkungen auf Commit- und Recovery-Gate.

Keine versionierten Benchmarkdaten verwenden oder verändern.

## 0.4 – Unsichere Befunde ausschließlich verifizieren

### F-19 – Pfadbasis

Aus Repository-Unterordner testen: staged, unstaged, rename, delete,
untracked. Prüfen, ob alle Pfade dieselbe Root-Basis verwenden und ob der Diff
versehentlich auf den Unterbaum begrenzt wird.

Ende der Aufgabe: `bestätigt` oder `widerlegt` mit konkreter Matrix. Noch kein
Refactor.

### F-23 – Runtime-Metadaten

Zuerst nur klären, was `lastChangelogVersion: 0.84.4` semantisch bedeutet.
Nicht automatisch ein Upgradeexperiment starten. Wenn es **kein Soll-Pin** ist,
F-23 als Metadaten-/Dokufrage bzw. `widerlegt` einordnen.

### F-27 – Session-Mismatch

Über die reale Aufruferkette prüfen, ob `resetForSession()` /
`consumeApproval()` den fraglichen Zustand produktiv erreichen können.
Künstliche Direktaufrufe interner Helfer zählen nicht als Produktionsbeleg.

## 0.5 – Entscheidungsdaten sammeln, noch nicht entscheiden

Für F-06, F-15, F-23 und F-24 in dieser Phase nur festhalten:

- aktuelles Verhalten;
- reale Nutzer-/Sicherheitswirkung;
- Abhängigkeiten;
- offene Faktenfragen.

Optionen/Empfehlung/ADR erst in der Phase, in der die Entscheidung tatsächlich
fällt. So entstehen keine doppelten Entscheidungsdokumente.

## Phase-0-Abschluss

- Baseline einmal vollständig protokolliert;
- F-01/F-02 reproduziert oder sauber widerlegt;
- F-19/F-23/F-27 besitzen Evidenzstatus;
- keine Produktdatei geändert;
- keine Benchmark-/Modellläufe;
- Arbeitsbaum sauber.
