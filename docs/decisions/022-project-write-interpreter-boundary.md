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
