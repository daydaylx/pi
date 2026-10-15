# Delegierte Analyse- und Fix-Läufe mit externen Agenten

Diese Referenz beschreibt die Arbeitsweise des Audits vom 2026-10-13: Claude
Code koordiniert und prüft, externe Agenten (`agy` mit Gemini Flash, Codex mit
`gpt-6-luna`) analysieren und erstellen Fix-Prototypen. Sie betrifft nicht die
Pi-internen Subagenten (siehe [`subagents.md`](subagents.md)) und gehört nicht
zu den verbindlichen Regeln in `AGENTS.md`; sie hält fest, was sich bewährt hat
und was nicht.

Stand der Werkzeuge: `agy` 1.3.3, Codex CLI 0.162.1, NixOS mit
`systemd-run --user`. Die Hilfsskripte des Audits waren sitzungslokal; die
Vorlagen unten ersetzen sie.

## Rollen und Grundsätze

| Rolle         | Aufgabe                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Koordinator   | plant, schneidet Aufträge, startet Sitzungen, prüft jeden Befund selbst, integriert und committet     |
| Analyse-Agent | liest einen read-only Snapshot und liefert einen Bericht im Pflichtformat                             |
| Fix-Prototyp  | ändert ausschließlich eine eigene Kopie und berichtet; übernommen wird nur, was der Koordinator prüft |
| Nutzer        | entscheidet über Umfang, Entfernungen und alles, was Deployment betrifft                              |

- **Delegation konsequent:** Die eigentliche Code-Analyse läuft über die
  Agenten, der Koordinator führt keine Parallelanalyse aus. Fällt ein Agent
  technisch aus, wird der Ausfall benannt und der Executor gewechselt; der
  Koordinator übernimmt die Analyse nicht stillschweigend.
- **Gegenprüfen ist Koordinatorarbeit:** Reproduktionen, Messungen und
  Testläufe macht der Koordinator selbst. Eine Agentenaussage gilt erst nach
  eigener Ausführung oder einem nachvollzogenen Codepfad.
- **Keine Geheimnisse an externe Modelle:** Snapshots enthalten nur getrackte
  Dateien. Sitzungsinhalte werden nur aggregiert ausgewertet (Zähler, keine
  Texte).
- **Nur lokal verändern, was der Auftrag verlangt:** Das Projektrepo bleibt
  während der Analyse unberührt; Commits und Pushes folgen danach in kleinen
  Schritten durch den Koordinator.

## Ablauf in Phasen

1. **Baseline (ohne Modell):** Snapshot von HEAD (`git archive HEAD`),
   `npm run verify` in einer isolierten Kopie, Versions- und Drift-Messung
   (aktive Runtime gegen Pin, installierte Kopie gegen Repo). Das liefert den
   belegten Ausgangszustand, gegen den alles Spätere verglichen wird.
2. **Inventar und Aufträge:** Funktionen mit stabilen IDs (`H0001` …)
   maschinell extrahieren, in Bereiche schneiden (Permission-Engine, Plan/Work,
   Verifier, Recovery, UI, LSP, Frontend, Fork …) und je Bereich eine
   Auftragsdatei schreiben. Alle Aufträge teilen einen Kontext
   (`00_CONTEXT.md`) mit Regeln, Systemüberblick und Pflichtformat.
3. **Analyse:** je Bereich eine read-only Sitzung. Mehrere laufen parallel,
   begrenzt durch das Kontingent (siehe unten).
4. **Gegenprüfung:** jeden Befund reproduzieren oder den Codepfad bis zur
   Entscheidung nachvollziehen; Status vergeben; Priorität neu setzen.
5. **Fix-Prototypen:** getrennte Aufträge je Themenblock in einer
   Schreibkopie. Der Koordinator validiert jeden Prototyp in einer frischen
   Kopie und integriert per 3-Wege-Merge.
6. **Abschluss:** Bericht, Coverage-Matrix (jede Funktion hat ein Urteil),
   Commits, Deployment mit Backup.

## Isolation

`agy` besitzt im Headless-Betrieb keine eigene Lese- oder Schreibgrenze; nur
`run_command` wird abgelehnt. Gemessen: Es liest beliebige Dateien und
schreibt außerhalb des Arbeitsverzeichnisses. Die Grenze setzt deshalb das
Betriebssystem:

- Snapshot und Auftragsdateien liegen unter einem Scratch-Verzeichnis; die
  Sitzung läuft in `systemd-run --user` mit `ProtectHome=tmpfs`,
  `ProtectSystem=strict`, `NoNewPrivileges=yes`. Beschreibbar ist nur `out/`,
  bei Fix-Prototypen zusätzlich die Schreibkopie `rw/<ID>/`.
- Das echte Repo, `~/.pi` und alles andere im Home sind in der Sitzung
  unsichtbar. Kontrolle: Schreibversuch in den Snapshot scheitert mit
  „read-only file system“.
- Nach jeder Sitzung werden alle Tool-Aufrufe aus dem Protokoll auf Pfade
  außerhalb des Snapshots geprüft.
- Zugangsdaten der Agenten sind in der Sitzung lesbar (gleicher Aussteller wie
  Empfänger). Das ist ein bewusstes Restrisiko; die Kontrolle ist das
  Befehlsprotokoll (`stream-json` bzw. `command_execution`-Events).

### Vorlage: `agy`, read-only Analyse

```bash
#!/usr/bin/env bash
# JOB = Auftrags-ID; A = Arbeitsverzeichnis mit snap/ (git archive), out/, snap/_audit/tasks/
JOB="$1"; A=/pfad/zum/audit
MODEL="${MODEL:-gemini-3.8-flash-high}"
PROMPT="Lies die Auftragsdatei $A/snap/_audit/tasks/$JOB.task.md und führe sie vollständig aus. Regeln: $A/snap/_audit/00_CONTEXT.md."
exec systemd-run --user --wait --collect --pipe --quiet --unit="audit-$JOB-$(date +%s)" \
  -p ProtectHome=tmpfs -p ProtectSystem=strict -p NoNewPrivileges=yes \
  -p BindReadOnlyPaths="$HOME/.local/bin/agy" \
  -p BindPaths="$HOME/.gemini $HOME/.cache/antigravity" \
  -p ReadWritePaths="$A/out" -p WorkingDirectory="$A/snap" \
  -E HOME="$HOME" -E PATH="/run/current-system/sw/bin:$HOME/.local/bin" \
  "$HOME/.local/bin/agy" -p "$PROMPT" --model "$MODEL" \
  --output-format stream-json --print-timeout 5400s \
  > "$A/out/$JOB.stream.jsonl" 2> "$A/out/$JOB.err"
```

Fortsetzung einer abgebrochenen Sitzung: dasselbe Kommando mit
`--conversation <ID>` und einem Prompt, der den Bericht in kleinen, getrennten
Dateien neu verlangt. Ein Modellwechsel mitten in der Konversation
funktioniert.

### Vorlage: Codex, read-only oder mit Schreibkopie

```bash
#!/usr/bin/env bash
# JOB, MODE (read|write), EFFORT (low|medium|high|xhigh), RW (nur bei write)
A=/pfad/zum/audit; PROMPT="Lies die Auftragsdatei $A/snap/_audit/tasks/$JOB.task.md und führe sie aus. Letzte Nachricht = Bericht."
N="$HOME/.local/opt/node-v22.23.2-linux-x64"; T="$A/codextmp/$JOB"; mkdir -p "$T"
[ "$MODE" = write ] && SB=workspace-write CWD="$RW" || { SB=read-only; CWD="$A/snap"; }
exec systemd-run --user --wait --collect --pipe --quiet --unit="codex-$JOB-$(date +%s)" \
  -p ProtectHome=tmpfs -p ProtectSystem=strict -p NoNewPrivileges=yes \
  -p BindReadOnlyPaths="$N" \
  -p BindPaths="$HOME/.codex/auth.json:$A/codexhome/auth.json" \
  -p ReadWritePaths="$A/codexhome $A/out $T ${RW:-}" -p WorkingDirectory="$CWD" \
  -E HOME="$T" -E CODEX_HOME="$A/codexhome" -E TMPDIR="$T" -E XDG_RUNTIME_DIR="$T" \
  -E PATH="$N/bin:/run/current-system/sw/bin" \
  "$N/bin/codex" exec --skip-git-repo-check --ephemeral --ignore-rules -s "$SB" \
  -m gpt-6-luna -c "model_reasoning_effort=\"$EFFORT\"" \
  -c 'sandbox_workspace_write.exclude_slash_tmp=true' \
  -c 'sandbox_workspace_write.exclude_tmpdir_env_var=true' \
  -c "sandbox_workspace_write.writable_roots=[\"$T\"]" \
  -c 'sandbox_workspace_write.network_access=false' \
  --json -C "$CWD" -o "$A/out/$JOB.final.md" "$PROMPT" \
  < /dev/null > "$A/out/$JOB.jsonl" 2> "$A/out/$JOB.err"
```

Gelernt beim Aufbau:

- `stdin` muss `/dev/null` sein, sonst hängt die Sitzung.
- `TMPDIR` muss beschreibbar sein, sonst scheitert die innere Bubblewrap-
  Sandbox von Codex; deshalb die `exclude_*`- und `writable_roots`-Einträge.
- Die innere Sandbox blockiert Git-Starts (`spawnSync git EPERM`). Testläufe des
  Agenten sind deshalb nie maßgeblich; der Koordinator validiert jede Änderung
  zusätzlich außerhalb der Sandbox.

## Modell- und Denkstufenwahl

Die Denkstufe richtet sich nach dem Auftrag, nicht nach Gewohnheit.

| Auftragstyp                                                                       | `agy` (Modellvariante)    | Codex (`model_reasoning_effort`) |
| --------------------------------------------------------------------------------- | ------------------------- | -------------------------------- |
| Sicherheits-, Zustands-, Nebenläufigkeitslogik, Datenabfluss, Lebenszyklen        | `gemini-3.8-flash-high`   | `high`                           |
| Code ändern (Fix-Prototypen)                                                      | `gemini-3.8-flash-high`   | `high`                           |
| Konsistenz- und Strukturprüfungen (UI-Darstellung, Prompts/Doku, Tests/CI)        | `gemini-3.8-flash-medium` | `medium`                         |
| Berichtsabschluss nach Resume, Test-Triage mit klarem Kriterium                   | `gemini-3.8-flash-medium` | `medium`                         |
| rein mechanische Aufgaben (Listen, Formatierung, Zusammenfassung von Ergebnissen) | `gemini-3.8-flash-low`    | `low`                            |

Bei `agy` steckt die Stufe in der Modellvariante, es gibt keine getrennte
Effort-Option. Codex wird nur mit `gpt-6-luna` verwendet.

### Kontingent

- Beobachtet: etwa 24 Sitzungen in 90 Minuten (bis zu 14 parallel) erzeugten
  rund 10 Mio. Cache-Read- und 0,7 Mio. Ausgabe-Tokens und liefen in
  `RESOURCE_EXHAUSTED (429)`; gleichzeitig endeten acht Sitzungen.
- Gegenmaßnahmen in dieser Reihenfolge: weniger parallele Sitzungen,
  günstigere Stufe, Sitzung mit `--conversation` fortsetzen statt neu starten,
  zuletzt den Executor wechseln (hier von `agy` auf Codex).
- Quoten gelten je Modellfamilie und Konto; ein erschöpftes Modell sperrt
  nicht zwingend die anderen, aber im Audit waren schließlich alle
  `agy`-Modelle gleichzeitig erschöpft.
- Netzwerk-Timeouts in der finalen Generierung (`retryable`) und
  Token-Refresh-Rennen kommen vor: den Bericht deshalb schon im Auftrag in
  mehreren kleinen Dateien verlangen.

## Aufträge

Eine Auftragsdatei enthält: Ziel und Umfang (Dateien, Funktions-IDs), Regeln
(read-only, erlaubte Pfade, keine Netz- und Installationsbefehle), Prüfkriterien
(Korrektheit, Zuverlässigkeit, Reibung, Performance, Architektur, Sicherheit,
UX), Prioritätsskala (P0–P3 als Vorschlag) und das Pflichtformat.

Pflichtformat eines Analyseberichts (maschinell auswertbar):

- Abschnitt **Funktionsprüfung:** jede Funktions-ID genau einmal mit Urteil
  `OK`, `BEFUND`, `UNKLAR` oder `NICHT_GEPRÜFT`. `OK` gilt nur für gelesene
  Funktionen.
- Abschnitt **Befunde:** je Befund Ort (`Datei:Zeile`), Kategorie, Beschreibung,
  **wörtliches Code-Zitat**, Auswirkung, Konfidenz, Prioritätsvorschlag, kleine
  gezielte Empfehlung und Prüfidee.
- Abschnitte **Zusammenspiel**, **Verworfene Vermutungen**, **Offene Punkte**.

Fix-Aufträge zusätzlich: der reproduzierte Befund (Eingabe, Ist, Soll je
Stufe), **Gegenproben**, die unverändert bleiben müssen, der Hinweis auf die
kleinste Änderung ohne Refactoring, die auszuführenden Prüfungen und ein
Abschlussbericht mit Dateien, Zeilen, Anzahl neuer Assertions und tatsächlichen
Prüfergebnissen.

## Gegenprüfung

Jeder Befund bekommt einen Status:

| Status         | Bedeutung                                                        |
| -------------- | ---------------------------------------------------------------- |
| Bestätigt      | selbst reproduziert oder Codepfad lückenlos nachvollzogen        |
| Teilweise      | Kern stimmt, Teilbehauptung falsch oder Auswirkung geringer      |
| Wahrscheinlich | Code gelesen und plausibel, nicht ausgeführt (so gekennzeichnet) |
| Unbewiesen     | Hypothese ohne Messung, höchstens P3                             |
| Fehlalarm      | durch Ausführung oder Gegenmechanismus widerlegt                 |
| Hinfällig      | betroffenes Modul wurde entfernt                                 |
| Unverifiziert  | nicht gegengeprüft, im Register offen geführt                    |

Methode:

- Funktionen und Guard-Ketten über die vorhandenen Testharnesse
  (`tests/shared/harness.mjs`, `jiti-loader.mjs`) in isolierter Kopie
  ausführen; Messungen an Sitzungsdaten nur aggregiert.
- **Modellfreie Zitatprüfung:** ein Skript vergleicht jedes zitierte Stück mit
  der Datei an der angegebenen Zeile.
- Wirkung prüfen, nicht nur den Fund: ist der Pfad erreichbar (etwa durch ein
  geschlossenes Schema) und fängt ein anderer Mechanismus ihn ab?
- Prioritäten selbst setzen; nie die des Agenten übernehmen.

Ergebnis im Audit vom 2026-10-13 (1 269 Funktionen in 172 Dateien):

- Zitattreue hoch (547 zitierte Zeilen: 496 exakt, 44 verschoben, 7 nicht
  auffindbar, keine erfundenen Belege), Befundtreue deutlich geringer.
- Von 154 Befunden mit Priorität vergaben die Agenten 2× P0 und 29× P1; nach
  Gegenprüfung blieben 0× P0 und 8× P1. 51 Befunde wurden herabgestuft, 31
  blieben, keiner wurde hochgestuft; 4 waren Fehlalarme, 14 nur teilweise
  richtig.
- Zwei Probleme fand nur die Gegenprüfung (die `@`-Pfadvariante der
  Schreibgrenze und die ungegatete Permission-Testdatei).
- Typische Fehlurteile: nicht erreichbare Pfade (Aktion `single` im
  geschlossenen Harness-Schema), übersehene Gegenmechanismen (angeblicher
  Deadlock im FAST-Tier, den die Eskalation auflöst) und halb richtige
  Behauptungen (Redaktions-Regex, Snapshot ohne `.git`).

## Fix-Prototypen validieren und integrieren

1. **Diff** der Schreibkopie gegen den Snapshot erzeugen
   (`diff -ruN -x node_modules -x dist`).
2. **Frische Testkopie** bauen: getrackte Dateien aus `git ls-files` per
   `tar`, `node_modules` per `cp -al` (Hardlinks), eigenes `HOME`,
   `GIT_CONFIG_GLOBAL=/dev/null`, damit Projekt und `~/.pi` unberührt bleiben.
3. **Alle Stufen** ausführen (`npm run verify`: format, lint, typecheck,
   deadcode, Coverage/Tests, Patches, Frontend-Contracts, Audit), jede Stufe mit
   eigenem Log, damit Format- und Logikfehler getrennt auswertbar sind.
4. **3-Wege-Merge** in den aktuellen Stand: Basis ist der Snapshot, von dem der
   Agent ausging; „theirs“ die Schreibkopie; „current“ der heutige Stand.
   `git merge-file --diff3` je Datei; Löschungen nur, wenn die lokale Datei
   unverändert ist; Konflikte als `.CONFLICT` ablegen statt zu raten.
5. **Gesamtlauf** `npm run verify` auf dem Ergebnis, erst dann in das echte
   Repo kopieren.
6. **Commits** thematisch trennen (Entfernung, Fixes, Vereinfachung, Tests,
   Pin-Bump). Mehrere Stufen lassen sich aus Baumständen bauen: temporärer
   Index, `git write-tree`, `git commit-tree -p <Eltern>`, danach
   `git update-ref`. Commit-Nachricht nennt Ursache, Änderung und Prüfung.

Abweisungsgründe, die vorkamen: ein Fix widersprach einem absichtlichen Test
(`git stash list` gilt bewusst nicht als sicher), ein Fix verursachte eine
Regression in einem unbeteiligten Test (Zeilenumbruch in `system-context`) und
Prototypen legten ihre Tests in eine ungegatete Datei, die nie lief.

## Deployment (nur auf Auftrag)

1. **Backup zuerst.** Der Installer sichert nichts und überschreibt auch
   `setup.json`, `models.json`, `keybindings.json` und `web-search.json`.
   Sicherung von `~/.pi/agent` ohne `sessions/`, `git/` und `npm/node_modules`
   (oder mit, wenn die Runtime geändert wird).
2. `node scripts/install-user.mjs` als Trockenlauf, danach `--apply`.
3. Runtime lock-konform: `npm install --ignore-scripts` in `~/.pi/agent/npm`
   (nie `npm ci`; `node-pty` bleibt gebaut).
4. Runtime-Patches: `node scripts/apply-runtime-patches.mjs` als Trockenlauf,
   dann `--apply` (siehe [`RUNTIME_PATCHES.md`](RUNTIME_PATCHES.md)).
5. Smoke: `pi --version`, ein Headless-Lauf (`pi -p … --no-session`), ein
   `subagent`-Aufruf mit `action: "list"`, `tests/runtime-patches.mjs`.

## Fehler dieses Audits (nicht wiederholen)

- `--apply` vor dem Backup ausgeführt; wiederhergestellt werden konnte nur,
  was in Git oder im Diff bekannt war.
- Mutationsprobe mit `git checkout <Datei>` zurückgesetzt und dabei
  uncommittete Arbeit verworfen. Mutationsproben auf Kopien oder mit
  Patch-Umkehr durchführen.
- `HOME` für ein Staging überschrieben und im selben Aufruf `git push`
  ausgeführt: es fehlten die Zugangsdaten.
- Agenten-Priorität zunächst ungeprüft übernommen; erst die Gegenprüfung
  trennte Alarm von Befund.
- Ungegatete Testdateien gaben falsche Sicherheit; eine Referenzprüfung aller
  `*.test.mjs` gegen `tests/run-all.mjs` gehört in die Triage.

## Checkliste

- [ ] Snapshot aus `git archive HEAD`, nur getrackte Dateien, keine Secrets
- [ ] Baseline gemessen (`verify`, Versionen, Drift) vor dem ersten Agenten
- [ ] Auftrag mit Kontext, Pflichtformat und Gegenproben; Bericht in Teilen
- [ ] Denkstufe und Parallelität dem Kontingent angepasst
- [ ] Sitzung abgeschirmt, Schreibzugriff nur auf `out/` und `rw/<ID>/`
- [ ] Protokoll auf Zugriffe außerhalb des Snapshots geprüft
- [ ] Jeder Befund reproduziert oder lückenlos nachvollzogen, Priorität neu
- [ ] Fix in frischer Kopie vollständig verifiziert, per 3-Wege-Merge integriert
- [ ] Commits thematisch getrennt und gepusht; Deployment nur auf Auftrag
- [ ] Vor `--apply` Backup; danach Smoke-Test und Patch-Verifikation
