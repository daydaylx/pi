# PILOT_REPORT.md — Benchmark v3 Teil D: Pi vs. Codex, alle 8 Tasks

Vollständiger Pilotlauf, nachdem `PILOT_PLAN.md`s ursprünglicher 4-Run-Umfang
auf alle 8 fertigen Hard-Suite-Tasks erweitert wurde (2026-09-02/03). Beide
Agenten liefen mit ihrem jeweils echten, realen Setup: Pi mit vollständigem
Produktstack (`extensions/`, `agents/`, `settings.json` inkl. echter
Subagenten-Rollen/Modelle, `skills/`), Codex mit lokal installiertem
CLI-Tarball + echter `config.toml` — Details und Begründung in
`ENVIRONMENT_LOCK.md` und den Docstrings von `agents/pi_harness/agent.py`
bzw. `agents/codex_harness/agent.py`. Rohdaten (Trajektorien, Session-Logs,
Docker-Build-Kontexte, ~245 MB) liegen lokal unter `jobs/pilot-*` und
`jobs/smoke-*`, bewusst nicht versioniert (`.gitignore`) — Job-Namen unten
sind die Referenz zur Reproduktion via `harbor run`.

## Ergebnis-Matrix

| Task                            | Pi    | Codex | Job-Verzeichnisse (Pi / Codex)                     |
| ------------------------------- | ----- | ----- | -------------------------------------------------- |
| httpx-01-deep-diagnosis         | 0     | 0     | `pilot-final-pi-3` / `pilot-codex-local-cfg-4`     |
| httpx-02-sync-async-consistency | 0     | 0     | `pilot-remaining-pi-2` / `pilot-remaining-codex-2` |
| httpx-03-redirect-state         | 0     | 0     | `pilot-remaining-pi-2` / `pilot-remaining-codex-2` |
| httpx-04-auth-state             | 0     | 0     | `pilot-remaining-pi-2` / `pilot-remaining-codex-2` |
| httpx-05-streaming-lifecycle    | **1** | **1** | `pilot-remaining-pi-2` / `pilot-remaining-codex-2` |
| httpx-06-config-propagation     | 0     | 0     | `pilot-remaining-pi-2` / `pilot-remaining-codex-2` |
| httpx-07-architecture-refactor  | **1** | **1** | `pilot-final-pi-3` / `pilot-final-codex-httpx07-2` |
| httpx-08-subagent-candidate     | 0     | 0     | `pilot-remaining-pi-2` / `pilot-remaining-codex-2` |

2/8 echte Erfolge, identisch für beide Agenten.

## Befund 1: systematischer Scope-Control-Fehler, nicht Pi-spezifisch

Alle 6 Fails (beide Agenten) haben denselben Grund: die jeweils
SHA-256-geschützte, aufgabenrelevante Testdatei wurde verändert (i.d.R. um
einen neuen Regressionstest für den eigenen Fix zu ergänzen), obwohl die
Instruktion explizit "only fix the underlying bug; do not weaken or remove
existing tests" verlangt. Betroffene Dateien: `test_queryparams.py` (01),
`test_redirects.py` (02, 03), `test_auth.py` (04), `test_proxies.py` (06,
08).

**Beide Agenten treffen exakt dieselbe Datei bei identischem Task** — das
ist kein Pi-Harness-Defekt, sondern eine Verhaltenstendenz auf Modellebene
(vermutlich shared, da Pi über `openai-codex/gpt-5.6-terra` und Codex direkt
über `openai/gpt-5.6-terra` laufen — möglicherweise dasselbe Modell über
unterschiedliches Provider-Routing). Konkrete, umsetzbare Konsequenz für
`AGENTS.md`/den Pi-Systemprompt: eine explizite Regel wie "füge niemals
Tests zu bestehenden Testdateien hinzu, um einen eigenen Fix zu belegen,
außer explizit angefragt" fehlt bisher.

## Befund 2: Pi ist bei identischem Ergebnis spürbar teurer

Aggregiert über alle 8 Tasks (Token-Zahlen aus `pi.txt`s `usage`-Feld pro
Turn bzw. `postprocess/codex_normalizer.py`s `TokenBreakdown` aus
`trajectory.json`, alle 8 Codex-Trajektorien diesmal sauber lesbar, siehe
`KNOWN_LIMITATIONS.md` #5 zur sonstigen Unzuverlässigkeit):

|                | Pi        | Codex     |
| -------------- | --------- | --------- |
| Input (frisch) | 392.330   | 301.417   |
| Cache-Read     | 4.192.256 | 3.494.912 |
| Output         | 82.450    | 32.965    |
| Gesamt-Kontext | 4.667.036 | 3.829.294 |
| Kosten (USD)   | $2,61     | $1,70     |

Pi verbraucht ~54 % mehr Kosten und **2,5× so viele Output-Tokens** bei
identischer Erfolgsquote. `httpx-08` (30 Turns, $0,60) sticht heraus — im
zugehörigen `pi.txt` sind mehrfache eigene Subagenten-Delegationen
("verifier"-Rolle, je bis zu 20 Min Timeout) sichtbar. Ansatzpunkt: prüfen,
ob die Subagenten-Delegation hier echten Mehrwert bringt oder überwiegend
Overhead erzeugt.

## Infrastruktur-Fixes, die diesen sauberen Lauf erst ermöglicht haben

Alle in `KNOWN_LIMITATIONS.md`/`agents/codex_harness/agent.py`/
`agents/pi_harness/agent.py` im Detail dokumentiert, hier nur die Liste:

1. Codex' eigenes ~310-MB-Plattform-Binary lässt sich in dieser Sandbox
   nicht zuverlässig per `npm install` laden → `CodexHarnessTrackA` lädt
   stattdessen einen lokal vorinstallierten CLI-Tarball hoch.
2. `nvm`s Installer nutzt standardmäßig `git clone` statt Tarball-Download,
   sobald Git im Container vorhanden ist (immer der Fall) — das scheiterte
   wiederholt an einem Auth-Fehler zu github.com. Fix: `METHOD=script`
   (nvms eigener Override), in beiden Agent-Adaptern.
3. Derselbe Bug traf auch Pis eigenen Runtime-`git clone` von
   `pi-subagents` beim ersten Subagenten-Spawn → jetzt vorab im
   Produktstack-Tarball gebündelt (lokaler Checkout, Fork-SHA verifiziert
   identisch zum Pinning).
4. 12 gleichzeitige Container (zwei Jobs × 4 Concurrency) haben die
   DNS-Auflösung dieser Sandbox komplett lahmgelegt
   (`Could not resolve 'deb.debian.org'`) → `-n 2` behoben.
5. Ein einzelner "Selected model is at capacity"-Fehler (Codex,
   httpx-07, erster Versuch) wurde als Infrastruktur-Rauschen erkannt und
   sauber retryed, nicht als echtes Scheitern gewertet.

## Was dieser Report NICHT ist

Kein statistisch belastbares Ranking (k=1 pro Zelle, nicht die geplanten
k=3 aus Teil E) und keine vollständige 12-Task-Suite (8 von 12 gebaut,
siehe `PILOT_PLAN.md`). Ausreichend, um die eingangs gestellte Frage zu
beantworten ("wo muss ich an meinem Pi-Setup noch arbeiten") — nicht
ausreichend für eine abschließende Pi-vs-Codex-Bewertung.
