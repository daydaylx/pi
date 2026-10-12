# 022 — Project-write fragt bei opakem Code gezielt nach

## Kontext

`project-write` erlaubt Bash grundsätzlich innerhalb der Projektgrenze. Ein
Interpreter kann jedoch Code aus `node -e`, `python -c`, stdin oder einer
externen Skriptdatei ausführen, ohne dass die Shell-Policy den eigentlichen
Schreibzugriff sehen kann. Dadurch konnte ein Aufruf wie `node -e ...` ohne
Rückfrage durchlaufen, obwohl die Berechtigungsbeschreibung riskante Aktionen
zur Bestätigung vorsieht. YOLO blockierte diese Form bereits hart; readonly
ließ sie bereits nur dann zu, wenn sie nachweislich rein lesend war.

## Entscheidung

Die gezielte Variante wird umgesetzt:

- **readonly:** Inline-, stdin- und Interpreter-Skriptaufrufe bleiben blockiert,
  sofern sie nicht als feste, rein lesende Versionsabfrage erkannt werden.
- **project-write:**
  - Inline-Code (`-e`, `--eval`, `-c`, `--command`, `-p`/`--print`), stdin-Code
    (`-`, Pipeline oder kein Skriptargument) und Skripte außerhalb des Projekts
    benötigen eine Bestätigung.
  - Ein ausdrücklich projektinterner Skriptpfad bleibt erlaubt, damit normale
    projektinterne Werkzeuge und Prüfskripte nicht pauschal aus dem Workflow
    entfernt werden.
- **confirm-all:** bleibt bei nicht nachweislich rein lesenden
  Interpreteraufrufen bei der allgemeinen Bestätigung.
- **yolo:** behält die harte Sperre für opake Interpreter und externe
  Schreibzugriffe; die gezielte project-write-Regel lockert diese Grenze nicht.

Die Erkennung normalisiert nur die sichtbare Kommandoform und prüft Pfad- sowie
Symlink-Grenzen. Sie ist **keine OS-Sandbox** und behauptet nicht, den Inhalt
eines projektinternen Skripts sicher analysieren zu können.

## Konsequenzen und Rest-Risiko

Ein bestätigtes oder ausdrücklich internes Skript läuft weiterhin mit den
Rechten des Pi-Prozesses. Indirekte Mechanismen wie ein bereits gestarteter
Shell-Alias, Funktionen, dynamisch zusammengesetzte Befehle oder die Semantik
eines Skriptinhalts werden nicht als vollständige Sandbox behandelt. Sichtbare
Shell-Variablen, harte Secret-/System-Grenzen, Symlink-Ausbrüche und externe
Schreibpfade bleiben unabhängig davon geschützt.

Die Rückfrage ist der normale Rückweg: Der Operator kann den konkreten Lauf
bestätigen, ihn ablehnen oder für strengere Kontrolle `readonly` bzw.
`confirm-all` verwenden. Für eine strengere Produktpolicy kann die gezielte
Regel später ohne Datenmigration auf alle opaken project-write-Interpreter
verallgemeinert werden.

## Evidenz

`tests/workflow-mode/permissions.test.mjs` prüft für node- und python-Inline-
Code, stdin-Code, ein internes Skript, ein externes Skript und einen direkten
externen Schreibpfad alle vier Permission-Level. Die Matrix bestätigt dabei
insbesondere `project-write = allow` nur für den internen Skriptpfad und
`project-write = ask` für die drei opaken/externalen Risikoklassen.

## Nachtrag 2026-10-12 — YOLO 1/2 folgen derselben gezielten Regel

**Anlass:** Ausgewertete Sitzungen vom 11./12.10. zeigten, dass YOLO 1
projektinterne Prüfskripte (`node quickpanel/tests/x.test.js`,
`python3 -I quickpanel/tests/shell_smoke.py`) hart blockierte, während
`project-write` sie ohne Rückfrage ausführt. Wer YOLO einschaltete, um weniger
unterbrochen zu werden, konnte dadurch seine Tests nicht mehr starten; die
Meldung („System-/Secret-Grenze") nannte die eigentliche Grenze nicht.

**Entscheidung:** Die Regel „Inline-/stdin-Code und Skripte außerhalb des
Projekts sind opak, ein literaler projektinterner Skriptpfad ist normale
Projektarbeit" (`projectWriteInterpreter`) gilt auch für `yolo` und `yolo-ask`.
YOLO 1 blockiert weiterhin hart, YOLO 2 fragt weiterhin, YOLO 3 lässt zu —
aber nur für die opaken Formen, nicht mehr für projektinterne Skripte.

- Unverändert hart: `node -e`, `python -c`, `bash -c`, stdin/Pipe/Heredoc,
  `-r ./x.js`-Preloads, Skripte außerhalb des Projekts oder über Symlink-
  Ausbrüche, `echo … > x.sh && bash x.sh` (Redirect + Interpreter), bare
  `node`/`python3` ohne Skriptargument.
- Die Blockmeldung nennt jetzt die Grenze und den zulässigen Weg.

**Rest-Risiko:** Ein projektinternes Skript läuft mit den Rechten des
Pi-Prozesses; sein Inhalt wird nicht analysiert (gilt seit ADR 022 auch für
`project-write`). YOLO ist damit für projektinterne Skripte nicht strenger als
der Standard, behält aber alle übrigen harten Grenzen (Secrets, Systempfade,
sudo, Paketmanager, externe Schreibzugriffe, unquotierte Variablen).

**Plan Mode (ebenfalls 2026-10-12):** `command -v|-V NAME` (nur die
Nachschlageform, auch mit `-p`) gilt als rein lesend; `subagent` mit
`action=list|status` ohne Arbeitsbeschreibung ist im Planmodus erlaubt.
`stop`/`interrupt`, Delegationen und jede andere `command`-Form bleiben
gesperrt.
