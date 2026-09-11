# Phase 1 – Kritische Snapshot- und Gate-Reparatur

## Scope

F-01, F-02, F-03.

## Ziel

Große oder problematische Workspaces dürfen weder das Verifier-Commit-Gate
fail-open machen noch das Recovery-Gate dauerhaft unlösbar machen. Alle
Snapshotkonsumenten sollen denselben typisierten Fehlervertrag verwenden.

## 1.1 – Aufrufer- und Fehlervertrag

Alle direkten/indirekten Aufrufer von `collectWorkspaceSnapshot()` erfassen.
Pro Aufrufer dokumentieren:

- Zweck;
- bisheriges Fehlerverhalten;
- gewünschtes fail-open/fail-closed-Verhalten;
- sichtbare Nutzer-/Session-/Frontendmeldung.

Genau einen fachlichen Ergebnisvertrag definieren. Mindestens unterscheiden:

- kein Git-Repository;
- Git nicht verfügbar;
- Git-Kommando fehlgeschlagen/abgebrochen;
- Ausgabe/Datei nicht lesbar;
- instabiler Workspace während der Erfassung;
- interne Inkonsistenz.

Keine Dateiinhalte/Secrets in Fehlermeldungen. Typdeklarationen synchron halten.

## 1.2 – Fingerprint-Kompatibilität zuerst einfrieren

Vor dem Streaming-Umbau mehrere kleine Referenz-Fixtures mit erwarteten
Fingerprints festhalten, z. B.:

- sauberer Workspace;
- staged;
- unstaged;
- staged + unstaged;
- rename/delete;
- untracked Textdatei;
- Symlink, soweit bestehendes Verhalten dies unterstützt.

Damit ist beweisbar, dass die neue Implementation nicht unbemerkt die
kanonische Fingerprint-Semantik ändert.

## 1.3 – Patch-/Dateihashing ohne feste 1-MiB-Falle

Anforderungen:

- große staged/unstaged Patches nicht als vollständigen JS-String
  materialisieren;
- Streaming/Prozessausgabe mit korrektem Backpressure-Verhalten;
- Exitcode und Signal sauber auswerten;
- Timeout/Abort kontrolliert behandeln;
- `stderr` begrenzen bzw. kontrolliert sammeln, ohne neuen ENOBUFS-/RAM-Pfad;
- kein Deadlock bei parallelem stdout/stderr;
- deterministische Reihenfolge der Hash-Eingaben;
- untracked reguläre Dateien stückweise hashen;
- Symlinkziele gemäß bisheriger Semantik behandeln;
- nicht-reguläre/unerwartete Dateitypen typisiert ablehnen.

Nur `maxBuffer` stark zu erhöhen ist **kein** zulässiger Abschluss.

Wenn sich Fingerprints absichtlich ändern müssen, zuerst begründen, Verbraucher
inventarisieren, Schema-/Migrationsfolge definieren und erst dann umsetzen.

## 1.4 – Konsistenz bei Mutation während Snapshot-Erfassung

Ein Snapshot darf nicht still aus Status von Zeitpunkt A, Diff von B und
untracked Hash von C zusammengesetzt werden.

Produktionsnah testen, dass eine externe oder parallele Mutation während der
Erfassung entweder:

- zuverlässig erkannt und begrenzt erneut erfasst wird, oder
- als typisierter `instabil`-Zustand endet.

Kein unbegrenztes Retry. Ein instabiler/defekter Snapshot darf kein Gate öffnen.

## 1.5 – Einheitliche Gate-Semantik

### Commit-Gate

Erkannter `git commit` + notwendiger Snapshot + interner Snapshotfehler =>
sichtbar blockieren. Niemals still `PERMITTED`.

### Recovery-Gate

Großer gültiger Diff muss normal prüfbar und entsperrbar sein. Echter
Snapshotdefekt bleibt sicher geschlossen, nennt aber Ursache und einen
nicht-destruktiven manuellen Ausweg. Keine pauschalen `reset --hard`/
`clean -fd`-Empfehlungen.

### Verifier-Aufzeichnung

Snapshotfehler dürfen nicht als PASS/Coverage/Dedup-Evidenz gespeichert werden.
Der Laufzustand muss sichtbar bleiben.

## 1.6 – Produktnahe Regressionen

Mindestens:

1. großer Diff in Verifier-Pflichtpfad: Commit ohne passenden PASS blockiert;
2. großer gültiger Diff: Recovery lässt sich korrekt abschließen;
3. simulierter Snapshotdefekt: Commit sichtbar blockiert;
4. simulierter Defekt: Recovery sicher geschlossen und verständlich erklärt;
5. setup-core/Verifier speichert keinen falschen PASS;
6. Referenz-Fixtures behalten ihre Fingerprints;
7. Mutation während Erfassung erzeugt keinen inkonsistenten gültigen Snapshot.

## Phase-1-Abschluss

- F-01/F-02/F-03 in Matrix `behoben` oder mit belastbarer Gegen-Evidenz
  `widerlegt`;
- fokussierte Snapshot-/Gate-/Recoverytests grün;
- kein Voll-`verify` allein wegen dieses Phasenendes erforderlich, sofern keine
  unerwartete Querschnittsänderung dies rechtfertigt;
- Verifier nur bei berührten geschützten Pfaden;
- Arbeitsbaum sauber.
