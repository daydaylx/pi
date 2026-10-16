# 041 — Recovery-Gate entfällt, ein Unterbrechungshinweis bleibt (2026-10-16)

## Status

Angenommen, 2026-10-16. Ersetzt 016 (Recovery-Gate) und den Teil der Recovery-Automatik aus 040.
Ergänzt 036 (offene Systemprofil-Policy) und 040 (Shell-Policy, offene Befunde).

## Fragestellung

Das Recovery-Gate entstand zusammen mit dem Planmodus (ADR 016). Der Planmodus ist entfernt
(ADR 035). Ist Recovery im heutigen Harness noch eine eigenständige Aufgabe, und wenn ja, in
welcher einfachsten Form?

## Befund (am Code und an der Runtime belegt)

Was Pi selbst abdeckt (Runtime 1.2.0, `pi-ai/dist/api/transform-messages.js`,
`pi-coding-agent/dist/core/agent-session.js`):

- **Provider-Fehler und Verbindungsabbrüche:** natives Retry (`retry.*`, hier `maxRetries: 5`).
- **Aufrufe ohne Ergebnis:** `closePendingToolCalls` ergänzt beim Senden „No result provided“
  (`isError: true`). Das Modell sieht also, dass ein Aufruf nicht bestätigt wurde.
- **Fehlerhaft oder abgebrochen beendete Assistentenbeiträge** werden nicht erneut gesendet.
- **Session-Wiederaufnahme:** der JSONL-Zweig ist die vollständige Wahrheit.

Was Pi nicht liefert: den **Workspace-Zustand** nach einem unterbrochenen `bash`, `write` oder
`edit` und den Hinweis, _welche_ mutierenden Aufrufe unbestätigt sind. Genau das war der Nutzen
des Gates, nur nicht dessen Sperre.

Was das Gate zuletzt tatsächlich tat (Code vor dieser Änderung):

- Seit ADR 040 prüft der Turn-Start offene Gates selbst (`inspectOpenGates`) und gibt sie frei. Die
  Freigabebedingung war nur „Snapshot lesbar und `git status` gelungen“. `git diff --stat` durfte
  fehlschlagen, ohne dass das Gate geschlossen blieb (`"(Diff-Zusammenfassung nicht verfügbar)"`);
  die Prüfung stellte nie fest, ob die unterbrochene Aktion vollständig war. Die Sperre schützte
  also nicht vor Wiederholung, sie erzwang nur einen lesenden Aufruf.
- Es blieb eine Sperre genau dann, wenn die Prüfung selbst scheiterte (kaputtes Git, nicht
  erfassbarer Snapshot). Das Modell musste dann `recovery_check` aufrufen, scheiterte gleich und
  bekam nach drei Fehlern die Rückfrage, die Recovery abzuschalten. Das ist Reibung ohne Schutz.
- Pro Turn liefen zwei Workspace-Snapshots (Start und Ende, je Wurzel), unabhängig davon, ob ein
  Fehler auftrat; bei großen Arbeitsbäumen sind das Sekunden.
- Messung (Bestandsaufnahme 16.10.): 314 von 25 337 Tool-Ergebnissen (1,2 %) vom Gate blockiert,
  überwiegend weil das Modell vor dem Lesen schrieb.
- Auswertung der 412 lokalen Sessions ohne Benchmark-Läufe (einmalige, nicht versionierte Auswertung): 148
  `recovery-required`-Marker, 77 mit möglicher Mutation. In 45 dieser Fälle machte der Folgelauf
  mutierende Aufrufe, in 12 davon wiederholte er einen nicht rein lesenden Aufruf des unterbrochenen
  Laufs identisch (Testläufe, `git status`, zweimal ein identisches `git commit -m …`) — **trotz
  aktivem Gate**. Die Sperre verhinderte die Wiederholung nicht; sie erzwang einen Lesezugriff
  davor. Das zeigt zugleich, dass der Hinweis auf unbestätigte Aufrufe einen echten Zweck hat.
- Das offene Systemprofil (`pis`, ADR 036) kannte das Gate auf `project-write` und `yolo*` ohnehin
  nicht. Auf `readonly`, `confirm-all` und `headless` gilt es dort nur für den Workspace-Ordner
  des Profils, nie für den Systemzustand (NixOS, Dienste), um den es dort geht.

## Bewertung der Alternativen

**A — Recovery vollständig entfernen.** Erspart den Rest an Code. Es fehlte der Hinweis auf
unbestätigte mutierende Aufrufe und der Zustand des Arbeitsbaums nach einem Abbruch. Native
Mechanismen melden `No result provided`, aber nicht, ob `npm install`, `git commit` oder ein
Schreibvorgang gelaufen ist. Das Risiko ist die blinde Wiederholung eines nicht idempotenten
Befehls; es ist selten, aber real und mit wenig Code abzudecken. **Verworfen.**

**B — Minimaler Zustandscheck, kein Gate.** Beim Start des nächsten Laufs wird aus dem nativen
Session-Zweig abgeleitet, ob der letzte Lauf endete, bevor das Modell seine mutierenden Aufrufe
bestätigen konnte (Fehler, Abbruch, Aufruf ohne Ergebnis, Tool-Ergebnisse ohne Antwort). Nur dann
bekommt das Modell **einen** versteckten Hinweis: die mutierenden Aufrufe mit ihrem Ergebnisstand
und `git status --short`. Keine Sperre, kein Marker-Zustand, kein eigenes Tool, keine
Workspace-Snapshots pro Turn. **Gewählt.**

**C — Heutige Form behalten.** Es gibt keinen reproduzierbaren Vorteil gegenüber B (siehe Befund:
das Gate gab sich beim Turn-Start selbst frei), aber sechs zusätzliche Zustände (Required,
Checked, Disabled, Skipped, Fingerprint je Wurzel, Gate-Status im Footer), ein Tool, eine
Setup-Option und ein Hard-Pfad-Katalog, die alle gepflegt und getestet werden müssen. **Verworfen.**

## Entscheidung

- `extensions/resilience/interruption.ts` (neu, rein): `findInterruptedRun` und
  `formatInterruptionNotice`. Keine Persistenz außer einem Telemetriemarker.
- `extensions/resilience/index.ts` behält die Telemetrie (`resilience.failure`, `turn-start`,
  `turn-settled`, `compaction-boundary`) und hängt beim Turn-Start den Hinweis an. Ein Marker
  `resilience.interruption-notice` zählt jeden Hinweis (für `/session-health`) und verhindert die
  Wiederholung für denselben Abbruch.
- Entfernt: `recovery_check`, Marker `recovery-required` und `recovery-checked`, das Gate in
  `permissions/guards.ts` (Statusabfrage, YOLO-3-Bypass, Blocktext), die Fähigkeitsbrücke
  `shared/recovery-capabilities.ts` (nur `toolEffect` blieb, jetzt in `interruption.ts`),
  `resilience/recovery-state.ts`, die Setup-Option `recovery.skipWithoutGit`, die
  Footer-Statusanzeige, der Hard-Pfad „Kritischer Recovery-State“ (Workspace-Snapshot bleibt Hard-Pfad,
  weil das Verifier-Ticket daran hängt), die Workspace-Fingerprints pro Turn.
- Alte Sitzungen mit offenem Gate sperren nichts mehr. `/session-health` zählt die alten Einträge
  weiter getrennt (`legacyRequired`, `legacyChecked`) und neue Hinweise (`notices`).

## Sicherheitsnachweis

- Schreib-, Shell- und Pfadgrenzen hängen nicht an Recovery: sie liegen in `permission-policy.ts`,
  `tool-policy.ts`, `guards.ts` (Trust, Symlink, Secrets, Projektgrenze) und bleiben unverändert.
  Die Tests dafür laufen weiter (440 + 1621 + Runtime-Suite grün).
- Neue Tests: Erkennung (`error`, `aborted`, `no-result`, `no-follow-up`, fehlerhaft beendete Beiträge
  führen ihre Aufrufe nicht aus, lesende Läufe schweigen, ein späterer regulärer Lauf hebt den
  Abbruch auf, Wiederholung wird unterdrückt, Sitzungswechsel verwirft den Hinweis), reale
  Git-Fixtures (geänderte Datei im Bericht, kein Git, 4 000 untracked Dateien bleiben begrenzt),
  ein Altgate sperrt weder `write` noch `bash`, die Klassifikation bleibt fail-closed für unbekannte
  Werkzeuge.
- Restrisiko: Ein Modell kann einen Hinweis ignorieren. Vorher konnte es auch den Zwang zum Lesen
  durch ein reines `git status` erfüllen, ohne den Befund zu beachten. Eine Garantie gab es nicht.
- Restrisiko: Mehrere Projektwurzeln. Der Bericht zeigt `git status` nur für die primäre Wurzel;
  die Aufrufliste im Hinweis nennt alle mutierenden Aufrufe mit Pfad.

## Rückfallweg

- Git: `git revert <Commit dieser Änderung>` stellt Gate, Tool, Setup-Option und Tests wieder her
  (ein Commit, gepusht). Die alten Sitzungsdaten bleiben lesbar.
- Installation: Backup `~/.pi/agent-backups/pre-harness-abschluss-20261016` wird vor dem
  Überschreiben der aktiven Installation angelegt.

## Risiken des offenen Systemprofils (`pis`, ADR 036), gesondert bewertet

Die Policy bleibt wie entschieden. Eigenständige Risiken, die weder Recovery noch Sandbox lösen:

1. **Heuristik statt Sandbox:** Inline-Code in Interpretern (`python3 -c`, `node -e`) und verschleierte
   Löschbefehle (`r=rm; $r x`) werden nicht erkannt. Bestätigt wird, was als Programmname im Befehl
   steht. Akzeptiertes Restrisiko laut ADR 036.
2. **Behoben am 2026-10-16:** Schreibzugriffe auf Blockgeräte per Umleitung oder `cp`
   (`> /dev/sda`, `cp x /dev/nvme0n1`) galten als frei, weil das Muster nur `/dev/sd/…` kannte;
   `git push origin +main` (Force per Refspec) und Befehle in Backticks (`` `rm x` ``) wurden nicht
   erkannt. Die Tests decken diese Fälle ab.
3. **Offen, bewusst nicht geändert:** `mv`/`cp` überschreiben Dateien ohne Rückfrage,
   `rsync --delete`, Kürzung per `: > datei`, `git checkout -- .` und `git restore .` verwerfen
   Änderungen ohne Rückfrage. Das widerspricht ADR 036 nicht (nur Löschen im engeren Sinn), ist aber
   ein Weg, Arbeit zu verlieren. Eine Aufnahme in die Heuristik wäre eine eigene Entscheidung.
4. **Kein Systemzustands-Recovery:** Ein unterbrochener `nixos-rebuild`/`systemctl`-Vorgang hinterlässt
   Zustand, den kein Workspace-Check zeigt. Der Hinweis nennt immerhin die unbestätigten Aufrufe;
   die Prüfung des Systems selbst (`nixos_status`, `system_unit_status`) bleibt Aufgabe des Modells.
5. **Aktivierung nur mit Bestätigung:** `nixos-rebuild switch|boot|test` und `nixos_apply` bleiben
   bestätigungspflichtig; das ist der einzige harte Schutz vor einem nicht rückholbaren Systemwechsel.

## Offene Befunde aus ADR 040, Stand nach dieser Änderung

- `sed`-Skripte mit `w`/`W`/`e`/`s///e`/`-f`: **behoben** (Commit `a792ee5`). Ein Skript gilt nur als
  Filter, wenn es ausschließlich ersetzt, löscht, ausgibt und Text einfügt; alles andere ist ein
  opaker Aufruf wie `node -e`.
- Subshells, Gruppen, Command Substitution, Backticks und Prozess-Substitution verdeckten Interpreter:
  **behoben**. Die Innenteile werden einzeln geprüft; ein `cd` im äußeren Teil macht den Pfad
  unbekannt; Schreibfähigkeit wird vom gesamten Befehl vererbt.
- Wrapper vor Interpretern (`timeout`, `nohup`, `time`, `nice`, `command`, `xargs`, `find -exec`),
  `eval`, `source`/`.`, `bun`, `tsx`, `ts-node`: **behoben**.
- `cd link; touch z` über einen Symlink aus dem Projekt: **behoben** (Operator-Trennung in der
  Schreibzielprüfung).
- Weiterhin offen und bewusst nicht gelöst: Interpreter-Skripte lesen und schreiben beliebig, sobald
  sie als Projektskript gelten; die Policy prüft die Befehlsform, nicht den Inhalt (ADR 022).
