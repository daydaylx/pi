# Real-Duel Audit (Phase 0)

> Stand: 2026-09-04. Grundlage fuer `benchmarks/real-duel/` (Modus A). Fuer
> die archivierte Legacy-Infrastruktur (Modus B) siehe
> [`../../docs/benchmark-history.md`](../../docs/benchmark-history.md) und
> [`../../docs/benchmark-archive-audit.md`](../../docs/benchmark-archive-audit.md)
> — dieses Dokument dupliziert beide nicht.

## 1. Zweck & Geltungsbereich

Zwei komplementaere, nicht konkurrierende Vergleichsmodi:

- **Modus A — `real-duel`** (dieses Verzeichnis): tatsaechlich lokal
  genutztes Pi-Setup gegen tatsaechlich lokal genutztes Codex-Setup, ohne
  Home-Isolation, ohne abgeschaltete Extensions/Hooks. Beantwortet: "Welches
  meiner realen Setups loest meine echte Arbeit besser?"
- **Modus B — `controlled-benchmark`** (archiviert, Tag
  `benchmark-legacy-v1-v3-2026-09-04`): Harbor/Docker-basiert, isolierte
  Container, gepinnte Versionen (Harbor 0.22.0, Pi-CLI 0.84.3, Codex 0.151.0,
  Node 22.23.2). Beantwortet: "Welcher Harness gewinnt einen kontrollierten
  Standardbenchmark?" Bleibt vollstaendig reproduzierbar ueber Tag/Branch
  erhalten.

## 2. Herkunft wiederverwendeter Artefakte

`main` enthaelt seit Commit `ea0d4d5` (2026-09-04, "chore(benchmarks):
archive legacy benchmark infrastructure") kein `benchmarks/`-Verzeichnis der
Legacy-Generation mehr. Zugriff auf archivierte Artefakte:

```bash
# einmalig fuer mehrfachen Zugriff:
git worktree add /tmp/archive-ref benchmark-legacy-v1-v3-2026-09-04
# oder einzeln:
git show benchmark-legacy-v1-v3-2026-09-04:harbor-bench/<pfad>
```

| Artefakt                                                         | Bezugsweg                                                 | Direkt wiederverwendbar?                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `postprocess/schema.py` (TelemetryV3, TokenBreakdown)            | `harbor-bench/postprocess/schema.py` im Archiv-Tag        | Ja, als Schema-Vorlage fuer Phase 2                                                                        |
| `postprocess/pi_normalizer.py`                                   | `harbor-bench/postprocess/pi_normalizer.py` im Archiv-Tag | Als Vorlage — Dateiquelle muss von Container-`pi.txt` auf Host-Transkript-Pfad umgestellt werden (Phase 2) |
| `KNOWN_LIMITATIONS.md` (Codex-Trajectory-Redaction-Risiko)       | `harbor-bench/KNOWN_LIMITATIONS.md` im Archiv-Tag         | Ja, Risiko gilt identisch weiter (Abschnitt 7)                                                             |
| `agents/{pi_harness,codex_harness}/agent.py`                     | `harbor-bench/agents/.../agent.py` im Archiv-Tag          | Nur als Vorbild fuer CLI-Aufrufsyntax, nicht direkt lauffaehig (Docker-spezifisch)                         |
| `benchmarks/harness/p5/{launch-codex,collect-codex-metrics}.mjs` | im Archiv-Tag unter `benchmarks/harness/p5/`              | Bessere Vorlage als der ATIF-Normalizer fuer Phase 2 (siehe Abschnitt 6)                                   |

**Nicht direkt wiederverwendbar:** `postprocess/codex_normalizer.py` liest
Harbors natives ATIF `trajectory.json`, das nur entsteht, weil Harbor selbst
als Wrapper mitlaeuft. Im hostnativen Modus A gibt es kein Harbor.

**Zusaetzlicher Fund (uebertrifft die urspruengliche Erwartung):**
OpenBenchs eigene eingebaute Adapter `obench/adapters/pi.py` und
`obench/adapters/codex.py` enthalten bereits vollstaendige, gut dokumentierte
Parser fuer genau die NDJSON-Strukturen, die auch Phase 2 braucht (Pis
`agent_end`/`usage`-Events, Codex' `turn.completed.usage` mit
input/cached/output/reasoning-Aufschluesselung). Diese Adapter laufen aber
mit erzwungener Home-Isolation (isoliertes `HOME`/`CODEX_HOME`, nur
`auth.json` kopiert — explizit um "personal extensions" zu vermeiden) und
sind damit fuer Modus A **nicht als Adapter** nutzbar, wohl aber als
**Referenz fuer die Parsing-Logik** in Phase 2 — moeglicherweise die bessere
Vorlage als sowohl der archivierte `pi_normalizer.py` als auch die P5-mjs-
Skripte. Als Entscheidungsoption fuer Phase 2 vermerkt, hier nicht final
entschieden.

## 3. Reale Pi-Startsequenz

- `pi` = `/home/d/.local/bin/pi` (Shim) -> globales npm-Paket
  `@earendil-works/pi-coding-agent` **0.84.4** (`pi --version`).
- `agentDir` loest **immer** auf `~/.pi/agent` auf (`PI_AGENT_DIR` nicht
  gesetzt) — unabhaengig vom cwd. `~/.pi/agent` **ist** dieses Repository.
  Git-Worktrees isolieren daher nur den **Code-Stand** (die zu bearbeitende
  Aufgabe), **nicht** die Agent-Konfiguration — Settings/AGENTS.md/auth.json
  werden immer vom kanonischen `main`-Pfad geladen, unabhaengig davon, in
  welchem Worktree Pi gerade aufgerufen wird. Das ist fuer Modus A gewollt
  (reale globale Config bleibt real global).
- `settings.json`: Hauptmodell `openai-codex/gpt-5.6-terra`,
  `defaultThinkingLevel: high`, Compaction aktiv (`reserveTokens: 49152`,
  `keepRecentTokens: 20000`), Subagenten-Routing (`investigator`/`debugger`
  -> terra, `verifier` -> `anthropic/claude-sonnet-5`, `thinking: max`,
  `disableBuiltins: true` — nur 3 projektlokale Rollen aktiv), 13 von 17
  Extensions aktiv, `permissions.bash: allow` / `unknownTools: ask`.
- Verifizierte CLI-Flags (`pi --help`): `--print/-p`, `--mode json`,
  `--approve/-a` (= _Projektvertrauen fuer lokale Dateien_, **kein**
  generelles Tool-Auto-Approval). **Empirisch bestaetigt (Smoke-Duel,
  2026-09-04):** `--approve` allein genuegte fuer einen komplett
  unbeaufsichtigten Lauf (Datei-Erstellung im Worktree, Checker PASS nach
  17,2s, kein Blockieren trotz `unknownTools: "ask"`) — fuer diesen
  einfachen Task-Typ musste kein unbekanntes Tool ausserhalb des
  Projektvertrauens angefragt werden. Fuer Aufgaben mit riskanteren
  Tool-Aufrufen (z. B. externe Netzwerkzugriffe) bleibt offen, ob ein
  Prompt den Lauf blockieren wuerde — bei Bedarf in Phase 3 erneut pruefen.
- Doppel-Ladequelle `AGENTS.md`: global via `agentDir` **und** projektlokal
  via cwd-Discovery (der Worktree enthaelt eine git-getrackte Kopie vom
  Base-SHA). Inhaltlich identisch, technisch redundant, harmlos.
- **Reales Risiko (aus OpenBenchs eigener `pi`-Adapter-Dokumentation
  bekannt):** mindestens eine persoenliche Pi-Extension ist dort dafuer
  bekannt, unter `-p`/Print-Mode abzustuerzen ("pi-goal crashes `-p`
  non-interactive mode"). Das betraf ein anderes Extension-Set als das hier
  aktive (13 Extensions, kein `pi-goal` darunter), ist aber ein Hinweis, dass
  Print-Mode-Kompatibilitaet von Extensions nicht garantiert ist — im
  Smoke-Duel zu beobachten, nicht vorab anzunehmen.

## 4. Reale Codex-Startsequenz

- `codex` = `codex-cli` **0.149.1** (`codex --version`) — bewusst nicht auf
  das verfuegbare 0.151.0 aktualisiert (Nutzerentscheidung: real installierte
  Version zaehlt fuer Modus A).
- `CODEX_HOME` nicht gesetzt -> immer `~/.codex/`, unabhaengig vom cwd
  (analog zu Pi).
- `config.toml`: Modell `gpt-5.6-terra`, `model_reasoning_effort: high`,
  `plan_mode_reasoning_effort: xhigh`, kein explizites
  `sandbox_mode`/`approval_policy` (Codex-interne Defaults gelten).
- **lean-ctx** (`~/.codex/instructions.md`, Drittwerkzeug
  `/home/d/.local/bin/lean-ctx`): ersetzt native Read/Grep/Bash/Edit durch
  eigene `ctx_read/ctx_search/ctx_shell/ctx_edit`-Tools. **Nutzerentscheidung:
  bleibt aktiv** — reale, dauerhaft aktive globale Codex-Modifikation, nicht
  kuenstlich entfernt.
- **tty7-Hook** (`~/.codex/hooks.json`): SessionStart/UserPromptSubmit/Stop
  rufen `"/tmp/.mount_tty7.ADDdDpG/usr/bin/tty7-app" agent-hook codex <event>`
  auf. **Verifiziert (2026-09-04): dieser Pfad existiert aktuell nicht**
  (AppImage-Mount-ID ist pro Start neu, `tty7-app` nicht im PATH, kein
  laufender Prozess). **Nutzerentscheidung: bleibt unrepariert.**
  **Empirisch im Smoke-Duel (2026-09-04):** Im erfassten `--json`-Transkript
  von `codex exec` erscheint **keine** Hook-Fehlermeldung — weder Erfolg
  noch sichtbarer Fehler zu SessionStart/UserPromptSubmit/Stop. Zwei
  plausible Erklaerungen (nicht abschliessend unterschieden): (a) diese
  Hooks feuern nur im interaktiven `codex`-Modus, nicht in `codex exec`, oder
  (b) Hook-Fehler landen in einem Codex-internen Log statt in
  stdout/stderr des Prozesses. Praktische Konsequenz fuer real-duel
  identisch: der kaputte Hook hat den unbeaufsichtigten `codex exec`-Lauf
  nicht beeintraechtigt (checker_exit=0, wall_time_s=20,3). Als "Hook-
  Rauschen"-Kategorie bleibt das fuer Phase 2 vorgemerkt, falls spaeter auch
  interaktive Codex-Laeufe Teil von real-duel werden.
- Codex liest projektlokale `AGENTS.md` zusaetzlich mit (verifiziert per
  Binary-String "Read the applicable AGENTS.md instructions.") — im
  Zielrepo real vorhanden, wird automatisch mitgeladen.
- Verifizierte CLI-Flags (`codex exec --help`): `--json`, `-m/--model`,
  `-s/--sandbox {read-only|workspace-write|danger-full-access}`,
  `--approve-for-me` (automatische Freigabe innerhalb der Sandbox, kein
  vollstaendiger Bypass), `-C/--cd`.
  `--dangerously-bypass-approvals-and-sandbox` ist laut Hilfetext fuer
  Container-Isolation gedacht — hier realer Host mit realen Dateien in einem
  echten Git-Worktree, daher **nicht verwendet**.

## 5. Asymmetrie des Freigabemodus

Reale Nutzung ist bei beiden Tools potenziell interaktiv (Mensch bestaetigt
Aktionen); ein unbeaufsichtigter Duell-Lauf braucht zwangslaeufig eine
Auto-Freigabe. Symmetrisch angewendet, fuer beide Seiten dokumentiert:

- **Pi:** `--approve` (Projektvertrauen) + bereits global erlaubtes
  `permissions.bash: allow`.
- **Codex:** `--approve-for-me` + `-s workspace-write` (automatische
  Freigabe innerhalb einer Sandbox, kein vollstaendiger Bypass).

Keine einseitige Bevorzugung — beide Abweichungen vom rein-interaktiven
Alltag sind aus demselben Grund (Unbeaufsichtigtheit) noetig und gleich
dokumentiert.

## 6. Base-Stand-Garantie & Workspace-Architektur

Git-Worktrees vom identischen Base-SHA fuer beide Kandidaten
(`git worktree add <pfad> <base-sha>`), Details und Skript in
`scripts/pi-duel`/`scripts/fingerprint.sh`.

**Wichtiger Architektur-Fund:** OpenBenchs eigene `obench run`-Cell-Loop
materialisiert Task-Workspaces **immer** in ein frisches
`tempfile.mkdtemp()`, gefuellt per Snapshot-Copy oder `git archive`-Export
**ohne `.git`** (`obench/workspace.py`, mit einer harten internen Assertion
gegen ein nachtraeglich vorhandenes `.git`). Es gibt keine
Konfigurationsoption, einen bestehenden Pfad (unseren Git-Worktree) als
Workspace zu uebergeben. Das ist mit der Kernanforderung "echte
Git-Worktrees mit `.git`/`git status`/`git log`/`git blame`" unvereinbar.

**Loesung:** `scripts/pi-duel` nutzt OpenBenchs eigene, geprueften Bausteine
direkt (`obench.candidates.ManifestHarness.run()`,
`obench.run.run_checker()`), ersetzt aber die Workspace-Materialisierung
durch eigene Git-Worktree-Erzeugung. `obench run` selbst (die CLI mit ihrer
eingebauten Cell-Loop) wird fuer git-basierte real-duel-Aufgaben nicht
verwendet. `obench doctor`/`gate`/`report` bleiben unveraendert nutzbar.

Fuer Phase 2/3 relevant: die dort geplante "eigene Worktree-Erzeugung
zuerst, OpenBench bekommt nur den fertigen Pfad"-Idee aus der urspruenglichen
Planung ist durch diesen Fund ueberholt — es gibt keinen Uebergabeweg dafuer
an `obench run`. Die hier gewaehlte Loesung (direkte Modulnutzung) ist der
tragfaehige Ersatz.

## 7. Token-/Telemetrie-Normalisierung

Fuer Phase 1 bewusst **nicht geloest** (`tokens_*` Felder sind `null` in den
`results.jsonl`-Zeilen) — generische `kind="manifest"`-Candidates in
OpenBench liefern grundsaetzlich keine Token-Aufschluesselung (das leisten
nur die eingebauten, isolierten Adapter, siehe Abschnitt 2). Phase 2 baut
das nach, mit drei moeglichen Vorlagen zur Auswahl:

1. Archivierter `pi_normalizer.py` (Container-`pi.txt`-Format) — Dateiquelle
   auf Host-Transkript umstellen.
2. P5-Skripte `launch-codex.mjs`/`collect-codex-metrics.mjs` (lesen Codex'
   eigene `rollout-*.jsonl` unter `$CODEX_HOME/sessions/**`) — Einschraenkung:
   setzten urspruenglich ein **isoliertes** `CODEX_HOME` voraus (genau eine
   Rollout-Datei). Modus A nutzt bewusst das globale, nicht isolierte
   `~/.codex/`, das bereits eine Historie voller Rollout-Dateien enthaelt —
   Zuordnung "welche Datei gehoert zu diesem Run" erfordert einen
   Snapshot-Diff (Dateiliste vor/nach Aufruf), nicht Eindeutigkeit durch
   Isolation.
3. OpenBenchs eigene `obench/adapters/{pi,codex}.py`-Parsing-Logik (Abschnitt 2) — moeglicherweise die robusteste Vorlage, da aktiv gegen reale
   CLI-Versionen getestet.

Kein neuer Recherchebedarf jetzt — Entscheidung faellt in Phase 2.

## 8. Bekannte Risiken

- **OpenBench:** Einzelentwickler-Projekt (`minghinmatthewlam/openbench`),
  erstellt 2026-06-19, Alpha-Status laut PyPI-Klassifizierung. Gepinnt auf
  Tag `v1.0.0` (Commit `ee71845c...`), siehe `OPENBENCH_LOCK`.
- **Codex-Redaction-Filter-Risiko** (aus archiviertem
  `KNOWN_LIMITATIONS.md` uebernommen): Trajectory-/Ergebnisdateien koennen
  bei Nachlese durch einen KI-Agenten in einer interaktiven Sitzung durch
  einen inhaltsbasierten Redaction-Filter korrumpiert werden. Gilt hier
  identisch weiter — Postprocessing (Phase 2) sollte per Batch-Skript
  laufen, nie per Agent-Read einer laufenden Sitzung.
- **lean-ctx und tty7-Hook-Rauschen:** bewusst unveraenderte
  Realitaetsfaktoren (siehe Abschnitt 4), keine Bugs im real-duel-Setup.
- **Pi-Extension-Print-Mode-Kompatibilitaet:** siehe Abschnitt 3, letzter
  Punkt — nicht vorab als Problem angenommen, aber als bekanntes
  Risikomuster zu beobachten.

## 9. Remote-Archiv-Verifikation (Nachtrag 2026-09-04)

Bei der ersten Umsetzung (Phase 0/1, oben) wurde faelschlich angenommen,
Tag und Branch seien bereits vollstaendig "ueber Tag/Branch erreichbar" —
tatsaechlich existierten beide zunaechst nur **lokal**; ein `git clone` von
`origin` konnte das Archiv nicht erreichen (`git ls-remote --tags/--heads
origin` lieferte nichts). Am 2026-09-04 nachgeholt:

```bash
git push origin benchmark-legacy-v1-v3-2026-09-04
git push origin archive/legacy-benchmarks:archive/legacy-benchmarks
```

**Unabhaengig verifiziert** (frischer `git clone` in ein separates
Scratch-Verzeichnis, nicht das bestehende Arbeitsverzeichnis):

- `git fetch --tags` erreicht beide Refs.
- `git show benchmark-legacy-v1-v3-2026-09-04:harbor-bench/PILOT_REPORT.md`
  liefert den erwarteten Inhalt.
- `git worktree add <pfad> archive/legacy-benchmarks` checkt `86dca927...`
  aus, `benchmarks/README.md` und `harbor-bench/README.md` sind vorhanden.
- `main` im selben frischen Clone enthaelt kein `harbor-bench/`, `benchmarks/`
  nur noch `real-duel/` — Generationengrenze bestaetigt.
- Tag und Branch zeigen remote auf denselben Commit
  (`86dca927aa920020157e951786ffb7da5263620d`,
  `git ls-remote --tags/--heads origin`, Tag korrekt auf Commit gepeelt
  via `^{}`).

Ab jetzt gilt "ueber Tag/Branch reproduzierbar erreichbar" als remote
verifizierte Aussage, nicht nur als lokale Annahme.

## 10. Verify-/CI-Status (Phase F, 2026-09-04)

Zwei getrennte, unabhaengige bekannte Abweichungen — nicht miteinander
verwechseln:

**Lokaler bekannter Verify-Gap (dieses Arbeitsverzeichnis):**
`npm run verify`s `test:gui`-Schritt (`gui/test/format-check.mjs && npm
--prefix ../gui test`) bricht lokal bereits am ersten Teilbefehl ab:
`FORMAT DRIFT: renderer/index.html, renderer/styles.css`. `git status`/`git
diff` fuer beide Dateien sind dabei leer — der Arbeitsbaum entspricht exakt
dem committeten Stand. Das deutet auf eine umgebungsabhaengige Formatpruef-
Logik hin (z. B. Prettier-Plugin-Aufloesung), nicht auf echte unformatierte
Aenderungen. Dadurch wird die eigentliche `ui suite` (mocha-Tests) in dieser
lokalen Umgebung gar nicht erreicht.

**GitHub-Actions-Baseline (Workflow "Verify"):** Dort besteht
`format:check` UND `gui/test/format-check.mjs` — der Fehlschlag liegt
stattdessen in der `ui suite` selbst:

```text
FAIL: [Aurora tiles and status pills] a truncated styled line closes its
foreground colour instead of leaking past the ellipsis — expected 2, got 0
FAIL: 123 passed, 1 failed
```

Nachweislich **vorbestehend**, unabhaengig von Archivierung und Real-Duel:
identischer Fehlertext in CI-Runs vom 2026-08-31 (`33449889514`, vor der
Archivierung), 2026-09-02 (`33696423111`, vor Real-Duel) und 2026-09-04
(`33879691336`, der Real-Duel-Phase-0/1-Commit `7de55a2` selbst).
`git diff <archiv-basis>..<real-duel-commit> --stat -- gui/` ist leer —
weder die Archivierung noch Real-Duel haben je eine Datei unter `gui/`
veraendert.

**Konsequenz:** Keine pauschale Aussage "`npm run verify` ist vollstaendig
gruen" treffen. Archivierungs- und real-duel-relevante Checks (Format des
uebrigen Repos, Typecheck, Deadcode, Coverage, Patches, Audit) sind gruen;
die GUI-Testabweichung ist ein separates, vorbestehendes Produktticket
(zwei unterschiedliche Symptome je nach Umgebung) und wird hier bewusst
**nicht** repariert — das waere ein eigenes Produkt-Changeset, siehe
Auftragsabgrenzung.
