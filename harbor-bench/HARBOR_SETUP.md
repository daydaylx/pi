# Harbor-Setup (Sitzung 1)

## Installation

- Harbor **v0.22.0** (`uv tool install harbor`, global CLI verfügbar) UND als
  gepinnte Projekt-Dependency in `pyproject.toml` (`harbor==0.22.0`) mit
  `uv.lock` — Ausführung im Projektkontext über `uv run harbor ...` (cwd
  `harbor-bench/`, damit der Custom-Agent-Importpfad `agents.pi_harness.*`
  auflösbar ist).
- Voraussetzungen bereits lokal vorhanden und verifiziert: Docker 29.7.1
  (läuft), Python 3.12.3, uv 0.9.12.
- Kein bestehendes Harbor-Install im Repo vorgefunden (Neuinstallation).

## Verzeichnisstruktur (Stand Sitzung 1)

```
harbor-bench/
  pyproject.toml, uv.lock        # Harbor 0.22.0 gepinnt
  agents/pi_harness/agent.py     # PiHarnessTrackA-Stub (Sitzung 1)
  tasks/hello-world/              # trivialer Dummy-Task
  jobs/                           # Harbor-Output (gitignored)
```

Die vollständige Zielstruktur (`environments/`, `postprocess/`, `reports/`,
`tasks/01..10`) folgt in Sitzung 2/3 laut Plan.

## Dummy-Task

`tasks/hello-world/` (per `harbor init dummy/hello-world --task` gescaffoldet,
dann angepasst): Agent muss `/app/hello.txt` mit exaktem Inhalt
"Benchmark v2 smoke test OK" erzeugen. `tests/test_outputs.py` (pytest)
prüft das, `tests/test.sh` schreibt `reward.txt` (0/1).

## Sitzung-1-Ergebnisse (reale Läufe, keine Mocks)

### Codex (Harbors eingebauter Adapter) — GRÜN

```
uv run harbor run --path tasks/hello-world -a codex -m openai/gpt-5.6-terra \
  --ae CODEX_FORCE_AUTH_JSON=1 --agent-setup-timeout-multiplier 5 \
  --jobs-dir jobs --job-name s1-codex-smoke-2 -y
```

- Modell: `gpt-5.6-terra` (identisch zur lokalen Codex-CLI-Konfiguration,
  `~/.codex/config.toml`).
- Auth: `CODEX_FORCE_AUTH_JSON=1` lässt Harbors Codex-Adapter das lokale
  `~/.codex/auth.json` (OAuth) in den Container hochladen und verlinken
  (`_resolve_auth_json_path`/`upload_file` in
  `harbor/agents/installed/codex.py`) — funktioniert unverändert.
- Ergebnis: `reward = 1.0`, 1/1 Trials, 0 Exceptions.
  `n_input_tokens: 28650, n_cache_tokens: 25088, n_output_tokens: 101,
cost_usd: 0.0134`. `jobs/s1-codex-smoke-2/hello-world__yNBT6kU/agent/trajectory.json`
  (ATIF) vorhanden und lesbar.
- **Erster Versuch** (Standard-Timeout, ohne Multiplier) schlug mit
  `AgentSetupTimeoutError` nach 360s fehl — kalter Container ohne
  gecachtes `apt-get`/`nvm`/`npm install -g @openai/codex`. Kein Bug,
  reine Kaltstart-Langsamkeit. Mit 5x-Multiplier (30 Min) lief der
  komplette Job in 11m28s durch. **Für Sitzung 2/3 relevant**: ein
  vorgebautes, getaggtes Image (statt Install bei jedem Trial) ist
  wirtschaftlich sinnvoll — siehe offene Frage im Plan (Sitzung 1,
  Punkt 4). In diesem Setup noch nicht geprüft/gelöst.

### Pi-Stub (`PiHarnessTrackA`, eigener Custom-Agent-Importpfad) — Plumbing GRÜN, Task-Ergebnis ROT

```
uv run harbor run --path tasks/hello-world \
  -a agents.pi_harness.agent:PiHarnessTrackA \
  -m openrouter/minimax/minimax-m3:free --env-file .env.sitzung1 \
  --agent-setup-timeout-multiplier 5 --jobs-dir jobs \
  --job-name s1-pi-stub-smoke -y
```

- Modell bewusst ein kostenloses OpenRouter-Modell (nicht `gpt-5.6-terra`/
  `-luna`) — auf ausdrücklichen Wunsch des Nutzers während der Sitzung, um
  den reinen Plumbing-Nachweis kostenlos abzuschließen. Ein Lauf mit dem
  echten Produktivmodell/OAuth folgt planmäßig in Sitzung 2, nicht hier.
- **Plumbing-Nachweis erfolgreich**: `harbor run --agent agents.pi_harness.agent:PiHarnessTrackA`
  löst unseren eigenen Custom-Agent-Importpfad korrekt auf, installiert
  `@earendil-works/pi-coding-agent` im Container, führt `pi --print --mode
json` aus, sammelt Logs/Kontext ein, der Verifier läuft — 0 Exceptions,
  vollständiger Job-Zyklus in 3m42s.
- **Task-Ergebnis rot** (`reward = 0.0`): `hello.txt` wurde nicht erzeugt.
  Ursache im Agent-Log (`pi.txt`) eindeutig sichtbar:
  `"errorMessage":"401: {\"message\":\"Missing Authentication header\",\"code\":401}"`
  vom OpenRouter-Backend. **Root Cause**: Harbors generischer
  `passthrough`-Mechanismus für Pi (`ModelConnectionSpec(passthrough=True)`
  in `harbor/agents/installed/pi.py`) setzt zwar `OPENROUTER_API_KEY` als
  Prozessumgebungsvariable im Container, aber Pi selbst liest
  Provider-Zugangsdaten nicht aus einer generischen Env-Var, sondern aus
  seinem eigenen `auth.json` unter `PI_CODING_AGENT_DIR` (siehe
  `benchmarks/`-Recherche: `auth.json`-Einträge mit `type`/`key` je
  Provider). Ohne befülltes `PI_CODING_AGENT_DIR/auth.json` im Container
  bleibt die Anfrage unauthentifiziert.
- **Konsequenz für Sitzung 2** (kein Widerspruch zum bestehenden Plan,
  sondern eine konkrete Bestätigung davon): der geplante eigene
  `BaseAgent`-Adapter (nicht Harbors generischer `BaseInstalledAgent`
  -Passthrough) muss `auth.json` aktiv in den Container hochladen —
  exakt nach dem bereits im Plan referenzierten, jetzt zusätzlich
  live verifizierten Vorbild von Harbors eigenem Codex-Adapter
  (`_resolve_auth_json_path` liest `~/.codex/auth.json` vom Host,
  `environment.upload_file(...)`, `chown` auf den Container-Nutzer,
  Symlink nach `$CODEX_HOME/auth.json`). Für Pi: analog `PI_CODING_AGENT_DIR`
  setzen und ein (minimales, nur die benötigten Provider-Einträge
  enthaltendes) `auth.json` hochladen statt auf generische Env-Var-
  Passthrough zu vertrauen.

### Pi mit echter `openai-codex`-OAuth + `gpt-5.6-terra` — GRÜN (Nachtrag, noch in Sitzung 1)

Auf Nutzerwunsch direkt im Anschluss ergänzt, statt bis Sitzung 2 zu warten:
`PiHarnessTrackA.run()` wurde umgebaut, um Risiko 1 aus dem Plan
("OAuth-Credential-Mounting ... braucht expliziten Test") jetzt schon real
zu lösen, statt nur zu vermuten.

```
uv run harbor run --path tasks/hello-world \
  -a agents.pi_harness.agent:PiHarnessTrackA -m openai-codex/gpt-5.6-terra \
  --agent-setup-timeout-multiplier 5 --jobs-dir jobs \
  --job-name s1-pi-realauth-smoke -y
```

- Mechanismus (analog zu Harbors eigenem Codex-Adapter, jetzt für Pi
  nachgebaut): `run()` liest den `openai-codex`-Eintrag aus dem lokalen
  `/home/d/.pi/agent/auth.json` **auf dem Host** (also innerhalb des
  Harbor-Orchestrator-Prozesses, nie im Container), lädt **nur diesen einen
  Eintrag** (nicht die volle Datei — Credential-Hygiene, keine unbeteiligten
  Provider-Tokens im Wegwerf-Container) nach
  `/tmp/harbor-pi-harness-auth/auth.json` im Container hoch
  (`_upload_config_text`, chown/chmod 600 wie bei Codex), setzt
  `PI_CODING_AGENT_DIR` auf dieses Verzeichnis und ruft
  `pi --print --mode json --provider openai-codex --model gpt-5.6-terra ...`
  explizit auf — **ohne** `settings.json`/`models-store.json` im Container.
- Ergebnis: `reward = 1.0`, 0 Exceptions, 3m03s Gesamtlaufzeit (nur
  npm-Install kostet Zeit, kein Auth-Problem mehr).
  `n_input_tokens: 2336, n_cache_tokens: 0, n_output_tokens: 63,
cost_usd: 0.0054`.
- **Erkenntnis**: die `openai-codex`-Provider-API-Form ist offenbar in der
  `@earendil-works/pi-coding-agent`-Runtime selbst fest hinterlegt (Built-in,
  kein Nachladen aus `models-store.json` nötig) — `models-store.json` ist
  demnach eher Cache/Override-Schicht, keine zwingende Voraussetzung für
  bekannte Erstanbieter-Provider. Nicht abschließend verifiziert, nur
  empirisch beobachtet.
- **Kein `trajectory.json`** in diesem Job (anders als bei Codex): Harbors
  `Pi`-Basisklasse setzt `SUPPORTS_ATIF` nicht, `populate_context_post_run`
  füllt nur `AgentContext` (Tokens/Kosten) direkt aus `pi.txt`, schreibt aber
  keine eigene ATIF-Trajectory. Für die in Phase 5 des Plans vorgesehene
  Normalisierungsschicht (`normalize_trajectory.mjs`) heißt das: auf der
  Pi-Seite muss entweder ATIF selbst erzeugt werden (`SUPPORTS_ATIF = True`
  - eigene `Trajectory`-Serialisierung) oder die Nachbearbeitung liest
    wahlweise `trajectory.json` (Codex) oder Pis natives `session.jsonl` direkt
    — als offener Designpunkt für Sitzung 2/3 vermerkt, nicht mehr nur
    Vermutung.
- **Nicht getestet und mit diesem schlanken Stub (bloßes npm-Paket, kein
  `AGENTS.md`/`extensions/`/`agents/verifier.md`) auch nicht sinnvoll
  testbar**: Subagenten-Delegation (z. B. `verifier` → `claude-sonnet-5`).
  Ohne die Produktivstack-Dateien kennt die Runtime keine Rollen/Kriterien,
  und die triviale Ein-Datei-Aufgabe böte ohnehin keinen Anlass zur
  Delegation. Das erfordert den echten Produktivstack im Container
  (`AGENTS.md`, `extensions/`, `agents/*.md`, `settings.json` mit
  `enabledModels` inkl. `anthropic/claude-sonnet-5`, zusätzlich den
  `anthropic`-OAuth-Eintrag analog hochladen) **und** eine Aufgabe, die
  Delegation plausibel rechtfertigt — beides weiterhin Sitzung 2/3, nicht
  mit vertretbarem Aufwand in diesen Dummy-Check vorziehbar.

### Pi mit echtem Produktivstack + `verifier`-Subagenten-Delegation — GRÜN (zweiter Nachtrag, noch in Sitzung 1)

Auf Nutzerwunsch komplett vorgezogen (ursprünglich Sitzung 2/3): `install()`
lädt jetzt ein reales Tarball des Produktivstacks
(`environments/build-tarball.sh` → `environments/pi-product-stack.tar.gz`,
62 MB, gitignored) hoch und entpackt es nach `/opt/pi-harness` im Container
— `AGENTS.md`, `APPEND_SYSTEM.md`, `settings.json`, `models-store.json`,
`agents/*.md`, `extensions/`, `shared/`, `themes/`, das exakt aufgelöste
`npm/node_modules` (Node 22 via `nvm`, kein `npm install` nötig — nur
kopiert). `run()` lädt jetzt **beide** von `settings.json`s
`subagents.agentOverrides` benötigten Provider-Einträge hoch
(`openai-codex` und `anthropic`), nicht nur einen.

```
uv run harbor run --path tasks/hello-world \
  -a agents.pi_harness.agent:PiHarnessTrackA -m openai-codex/gpt-5.6-terra \
  --extra-instruction "After creating the file, delegate to the verifier \
subagent to independently confirm hello.txt exists with the exact expected \
content, then report the verifier's verdict in your final answer before \
finishing." \
  --agent-setup-timeout-multiplier 5 --agent-timeout-multiplier 3 \
  --jobs-dir jobs --job-name s1-pi-prodstack-verifier-3 -y
```

`--extra-instruction` (statt die Task-Datei zu ändern) fordert Delegation
ausdrücklich an — deckungsgleich mit dem in `AGENTS.md` selbst genannten
Kriterium "eine ausdrückliche Nutzeranforderung", nicht künstlich
konstruiert.

**Zwei reale Infra-Bugs unterwegs gefunden und behoben** (beide jetzt in
`agents/pi_harness/agent.py` / `environments/build-tarball.sh` gefixt):

1. `pi-subagents` klont zur Laufzeit seinen exakt gepinnten Fork
   (`daydaylx/pi-subagents`) per `git clone` in `PI_CODING_AGENT_DIR/git/...`
   — auch wenn eine aufgelöste Kopie schon in `npm/node_modules` liegt.
   Ohne `git` im Container: `Error: spawn git ENOENT`. Fix:
   `ensure_system_dependencies(..., ("curl", "git"))`.
2. Mehrere Extensions importieren aus einem eigenständigen Top-Level-
   Verzeichnis `shared/` (z. B. `extensions/resilience/index.ts` →
   `../../shared/workspace-snapshot.mjs`) sowie `themes/` — beide lagen
   **nicht** unter `extensions/` und fehlten im ersten Tarball. Fix:
   `build-tarball.sh` packt jetzt zusätzlich `shared/` und `themes/` ein.

**Ergebnis nach beiden Fixes**: `reward = 1.0`, 0 Exceptions, 19m40s
Gesamtlaufzeit (node-Install + 62-MB-Upload + echte Mehrturn-Sitzung mit
Delegation), `n_input_tokens: 184521, n_cache_tokens: 132608,
n_output_tokens: 4994, cost_usd: 0.1903`.

**Wichtiger Nebenfund — kein Infra-Bug, aber sicherheitsrelevant**: Der
Verifier-Subagent (`anthropic/claude-sonnet-5`) konnte sich nicht
authentifizieren: `OAuth refresh failed for anthropic: ... invalid_grant,
"Refresh token not found or invalid"`. Der lokale
`/home/d/.pi/agent/auth.json`-Eintrag für `anthropic` zeigte schon vor
diesem Testlauf ein abgelaufenes Access-Token (`expires: 2026-08-28`,
Testzeitpunkt 2026-08-31/09-01) — die Anthropic-OAuth-Session war also
bereits **vor** diesem Benchmark-Lauf lokal veraltet, nicht durch den Test
verursacht (nur lesender Zugriff auf die Datei, kein lokaler Refresh
ausgelöst). **Genau richtiges Verhalten unter dieser Bedingung**: Der
Fallback (`openai-codex/gpt-5.6-terra`) griff, der Hauptagent meldete
ehrlich `"Verifier verdict: UNVERIFIABLE"` statt stillschweigend Erfolg zu
behaupten — deckt sich exakt mit der `AGENTS.md`-Regel zu FAIL/UNVERIFIABLE.
**Für dich**: Falls du den `verifier`-Subagenten mit echtem
`claude-sonnet-5` (statt Fallback) testen willst — lokal lokal neu
authentifizieren (`anthropic`-OAuth in Pi erneuern), unabhängig von diesem
Benchmark-Vorhaben.

**Damit ist genau dein Wunsch erfüllt**: Pi läuft über die echte
`openai-codex`-Auth mit `gpt-5.6-terra`, und der Verifier-Subagenten-Pfad
(Rolle → `claude-sonnet-5`, Fallback → `gpt-5.6-terra`) ist real durchlaufen
und ausgelöst worden — nur die Anthropic-Anmeldung selbst war lokal
abgelaufen, unabhängig vom Benchmark-Code.

### Wiederholung nach lokaler Re-Authentifizierung (`s1-pi-prodstack-verifier-4`) — GRÜN, jetzt ohne Fallback

Auf Nutzerhinweis ("auth ist durch") direkt erneut mit identischem Kommando
gelaufen, nachdem die lokale `anthropic`-OAuth-Session erneuert wurde
(`auth.json`-Ablaufzeit jetzt `2026-09-01T06:18Z`, vorher bereits
`2026-08-28` abgelaufen).

- Ergebnis: `reward = 1.0`, 0 Exceptions, nur noch **5m01s** (vorher 19m40s
  — die Zeitdifferenz war der fehlgeschlagene Refresh-Versuch plus
  Fallback-Handling, kein struktureller Overhead).
  `n_input_tokens: 152846, n_cache_tokens: 116736, n_output_tokens: 3998,
cost_usd: 0.1435`.
- Finale Antwort: `"Created hello.txt. Verifier verdict: PASS."`
- Verifiziert im Log: `"provider":"anthropic","model":"claude-sonnet-5"`
  tatsächlich verwendet (kein Fallback auf `gpt-5.6-terra` mehr nötig),
  46 `toolName:"subagent"`-Einträge (Delegation + interne Verifier-Turns),
  keine `invalid_grant`/Refresh-Fehler mehr im Log.
- **Damit ist der komplette Verifier-Subagenten-Pfad mit den echten,
  produktiv konfigurierten Modellen (`openai-codex/gpt-5.6-terra` Haupt,
  `anthropic/claude-sonnet-5` Verifier) einmal vollständig grün
  nachgewiesen** — nicht mehr nur über den Fallback.

## Offene Punkte für Sitzung 2/3

1. ~~OAuth-/API-Key-Mounting für Pi~~ — für beide benötigten Provider
   (`openai-codex`, `anthropic`) real gelöst und verifiziert.
2. Vorgebautes Image vs. Install-pro-Trial (Wirtschaftlichkeit) — noch nicht
   geprüft. Jetzt zusätzlich relevant: 62-MB-Tarball-Upload pro Trial ist für
   einen einzelnen Sitzung-1-Lauf unproblematisch, für einen echten
   Mehrfach-Pilot (24-36 Läufe) ein Zeit-/Bandbreitenposten — vorgebautes
   Image würde das eliminieren.
3. `@latest` wurde für Codex-Paketinstallation verwendet (nicht
   versionsgepinnt); Pi-Seite installiert jetzt gar nicht mehr per npm
   (Tarball-Kopie des lokal exakt aufgelösten `node_modules`) — für
   reproduzierbare Serien Codex-Version ebenfalls pinnen (Plan-Risiko 4).
4. ATIF-Erzeugung auf der Pi-Seite — Designentscheidung noch offen (siehe
   oben, unverändert).
5. Anthropic-OAuth-Session lokal erneuern, falls echte (nicht Fallback-)
   Verifier-Läufe mit `claude-sonnet-5` gebraucht werden.
6. `install()` läuft aktuell bei jedem Trial komplett neu (Node-Install +
   Tarball-Upload, ~2-3 Minuten reiner Setup-Overhead vor jedem echten
   Agentenlauf) — für den Piloten in Sitzung 3 relevant für Laufzeit-
   Budgetierung.

## Nicht angetastet

Kein produktiver Pi-Code verändert (`ask-user.ts`-Fix für Track B bleibt
weiterhin ein separat freizugebender Schritt, wurde in dieser Sitzung nicht
angefasst). Keine bestehenden `benchmarks/`-Daten verändert. Keine
Secrets im Repo committet (`auth.json` nie ins Tarball, nur einzelne
Provider-Einträge zur Laufzeit hochgeladen, `.env*`/`environments/*.tar.gz`
gitignored).
