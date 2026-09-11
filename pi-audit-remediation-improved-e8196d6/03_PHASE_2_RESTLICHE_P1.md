# Phase 2 – Restliche P1-Befunde

## Scope

F-04 bis F-10. Ziel ist, nach dieser Phase **keinen offenen bestätigten P1**
mehr zu haben.

## 2.1 – F-04: Verifier-Retry nach urteilsloser Ausgabe

Eine gemeinsame Definition eines **auswertbaren Verifier-Laufs** verwenden.
`completed` ohne erkanntes Urteil ist keine gültige Evidenz.

Tests:

- `completed` ohne Urteil => Retry erlaubt;
- derselbe Lauf => keine Commitdeckung;
- echter auswertbarer identischer Lauf => Dedup bleibt aktiv;
- expliziter Re-Verify-Pfad bleibt möglich;
- unbekannte Ausgabe wird nicht zu PASS/FAIL erfunden.

## 2.2 – F-05: Verifikationsstatus unabhängig von TUI publizieren

Fachliche Statusaktualisierung und `publishAuroraVerification()` vom
UI-spezifischen `ctx.ui.setStatus` trennen. `ctx.hasUI` darf nur den echten
TUI-Aufruf begrenzen.

Tests für TUI und headless/RPC:

- Status setzen;
- Status löschen;
- wiederholtes identisches Settle-Ereignis;
- keine Eventschleife/Doppelpublikation.

## 2.3 – F-06: `project-write`/Interpreter bewusst entscheiden

F-06 ist P1 und muss vor Checkpoint A geschlossen werden.

### Vor Entscheidung testen

Für alle Permission-Level mindestens:

- `node -e` / äquivalenter Inline-Code;
- `python -c` / äquivalenter Inline-Code;
- stdin-Code;
- projektinternes Skript;
- externes Skript;
- offensichtlicher direkter externer Schreibpfad.

### Entscheidungsoptionen

1. streng: opake Interpreter in `project-write` fragen;
2. gezielt: Inline/stdin/externe Skripte fragen, normale projektinterne
   Skripte erlauben;
3. Verhalten bewusst behalten, Schutzversprechen klar dokumentieren.

Keine Regex-Lösung als scheinbare OS-Sandbox verkaufen. Die Entscheidung muss
Schutzversprechen, Restumgehungen und Rückweg nennen. `bewusst behalten` ist
zulässig, wenn die Grenze ehrlich dokumentiert und die bestehende Semantik
bewusst akzeptiert wird.

## 2.4 – F-07: Protocol + Frontend-Server in kanonisches Verify

- `test:protocol-package` und `test:frontend-server` in das kanonische
  Pflichtprofil aufnehmen;
- Build nicht unnötig mehrfach ausführen;
- lokales `project_check(profile="verify")` und CI auf dasselbe npm-Profil
  ausrichten;
- temporäre Fehler-Injektion beweist, dass beide Suiten `verify` tatsächlich
  rot machen;
- Kontrollfehler vollständig zurücknehmen.

F-28 hier nicht nebenbei lösen.

## 2.5 – F-08: Git-Commit-Erkennung mit klarer Grenze

### Grundsatz

Keinen eigenen vollständigen Shellparser bauen. Unterstützte Formen explizit
festlegen und testen. Nur sicher normalisierbare Formen behandeln.

### Positive Mindestfälle

- `git commit`
- `/usr/bin/git commit`
- `env git commit`
- `env NAME=value git commit`
- `NAME=value git commit`
- `git -c user.name=test commit`
- `git -C <repo> commit`
- `git --git-dir=<...> commit`
- `git --work-tree=<...> commit`
- `git --no-pager commit`
- sinnvolle Kombinationen globaler Git-Optionen

`command git commit`, `sh -c 'git commit'`, `bash -lc 'git commit'` nur dann
unterstützen, wenn ein bereits vertrauenswürdig vorhandener Parser sie sicher
auflösen kann. Sonst als bewusste Grenze dokumentieren.

### Negative Mindestfälle

- `echo "git commit"`
- `printf '%s' 'git commit'`
- `git status`
- `git commit-tree`
- Kommentar/Textdatei mit `git commit`

Keine Substring-Suche.

## 2.6 – F-09: autoritative Policy-Schicht statt Einzelfunktionsdogma

Vorher/Nachher-Matrix über Permission-Level, read/write, intern/extern,
Systempfad, Symlink-Ausbruch und Runtime-Dokumentationsausnahme erstellen.

Ziel:

- genau **eine autoritative Policy-Schicht** besitzt harte Projekt-/Symlink-
  Sicherheitsentscheidungen;
- Hilfsfunktionen dürfen Mechanik ausführen, aber keine konkurrierende Policy;
- nur tatsächlich unerreichbare Duplikatzweige entfernen;
- Runtime-Dokumentationsausnahme entweder end-to-end wirksam machen oder
  bewusst entfernen;
- vollständigen Guardpfad testen, nicht nur interne Helfer.

## 2.7 – F-10: Hot Path vereinfachen, keinen Cache-Komplex bauen

### Verbindliche Erstlösung

**Kein Cache über Toolaufrufe hinweg in dieser Remediation**, solange nicht
nach der einfachen Optimierung eine gemessene, weiterhin relevante
Performanceblockade übrig bleibt.

Zuerst messen:

- Git-Prozesszahl;
- Laufzeit;
- grobes Speicherverhalten;
- normaler Toolpfad;
- aktives Recovery-Gate;
- kleiner und großer Workspace.

Dann nur:

- mehrfache Snapshotberechnung innerhalb **derselben fachlichen Entscheidung**
  zusammenführen;
- vorhandenes Ergebnis innerhalb desselben synchronen Kontrollpfads
  weiterreichen;
- unnötige Git-Aufrufe eliminieren.

Keine Mutationsgeneration, Repo-/Turn-/Session-Cache-Invalidierungsmaschine
bauen, nur um diesen Auditpunkt zu schließen.

Wenn danach die Performance weiterhin unzureichend ist, Evidenz dokumentieren
und einen **separaten** Folgeauftrag für langlebiges Caching anlegen. Der
Sicherheitszustand darf für Performance nicht abgeschwächt werden.

### Abschluss

- Vorher/Nachher-Prozesszahl und Laufzeit dokumentiert;
- messbar weniger redundante Git-Arbeit oder nachweislich kein relevanter
  Doppelpfad mehr vorhanden;
- keine stale-PASS-Klasse neu eingeführt;
- externe Mutation bleibt durch die Snapshot-Konsistenzregeln sicher.

## Phase-2-Abschluss

- F-04–F-10 besitzen Endstatus;
- kein bestätigter P1 ist `offen`, `blockiert` oder `deferred`;
- fokussierte Regressionen grün;
- danach **nicht** noch mehrere Zwischen-Vollprüfungen starten, sondern direkt
  Checkpoint A ausführen.
