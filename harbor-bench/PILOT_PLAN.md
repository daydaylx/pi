# PILOT_PLAN.md — Benchmark v3 Teil D (Vorschlag, noch nicht ausgeführt)

Zweck: die volle Pipeline (echter Agentenlauf -> Verifier-Reward ->
Telemetrie-Normalizer -> `scoring.py`) einmal end-to-end an einer kleinen,
bewusst gewählten Teilmenge validieren, bevor der volle 72-Run-Hauptbenchmark
(Teil E) angestoßen wird — wörtliche Vorgabe des Arbeitsauftrags ("NICHT
direkt mit Teil E beginnen", explizite Gates zwischen den Teilen).

## Vorbedingung, die diesen Plan einschränkt

Der Arbeitsauftrag verlangt eine **12-Task-Suite** (12 × 2 Agenten × 3
Versuche = 72 Runs für Teil E). Aktuell existieren **8 von 12 Tasks**
(`TASK_MANIFEST.json`, `schema_version 1.0.0`, `n=8`). Dieser Pilotplan
deckt daher nur die bestehenden 8 ab — er ist kein Ersatz für die
fehlenden 4, sondern eine bewusst kleinere Zwischenstufe. Vorschlag für die
Lücke selbst (separate Entscheidung, nicht Teil dieses Pilotplans):

- **Kandidaten für die 4 fehlenden Tasks** (Subsysteme, die httpx-01..08
  noch nicht abdecken, gleiches Muster: ein Zeilen-Bug, unsichtbar für die
  öffentliche Suite, mit Oracle/NOP/Wrongfix-Triple-Check):
  1. `Cookies`/`CookieJar`-Persistenz über Redirects/Sessions hinweg
  2. Timeout-Komposition über Retries/Redirect-Ketten (Gesamtbudget vs.
     Einzelversuch)
  3. Connection-Pool-/`limits`-Durchsetzung (`max_connections`,
     `max_keepalive_connections`)
  4. Response-Decoding/Charset-Erkennung bei fehlendem/falschem
     `Content-Type`
- Jeder dieser 4 bräuchte denselben Aufwand wie httpx-01..08: Mutation
  entwerfen, Contamination-Check, echte Oracle/NOP/Wrongfix-Harbor-Jobs.
  Nicht nebenbei erledigt — eigene Freigabe nötig.

## Pilot-Scope (Vorschlag)

Deckt die zwei strukturell unterschiedlichen Verifikationsmuster ab, die in
`TASK_VALIDATION.md` dokumentiert sind:

| Task                             | Muster                                                  | Warum als Pilot-Kandidat                                                              |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `httpx-01-deep-diagnosis`        | Standard: versteckter Bug, Hidden-Test-Assertion        | repräsentativ für 6 der 8 bestehenden Tasks                                           |
| `httpx-07-architecture-refactor` | Struktur-Check (Literal-Block-Zählung), kein Hidden-Bug | einziger Task mit komplett anderem Verifikationsansatz -- muss separat geprüft werden |

- Agenten: `pi` und `codex` (beide, das ist der Kernvergleich)
- Versuche: **1 pro Task/Agent** (nicht die volle Teil-E-Wiederholung
  k=3 -- der Pilot prüft die Pipeline, nicht statistische Power)
- **Gesamt: 4 reale Container-Läufe** (2 Tasks × 2 Agenten × 1 Versuch)

## Bekanntes Risiko für diesen Pilot

Netzwerk-Egress dieser Sandbox zu `nodejs.org` ist nachweislich instabil
(host-seitig verifiziert: ein 30-MB-Download bricht bei ~50 % ab; zwei von
drei realen Agent-Setup-Versuchen in dieser Sitzung sind daran gescheitert,
bevor der Agent überhaupt startete). Nicht task- oder agentenspezifisch --
`harbor run --max-retries 2 --retry-include NetworkConnectionError` fängt
das ab, sollte aber im Pilot-Report von echten Agent-Fehlern getrennt
ausgewiesen werden, damit es nicht fälschlich als Scoring-Signal
interpretiert wird.

## Danach (nicht Teil dieses Plans)

Bei grünem Pilot: `PILOT_REPORT.md` mit den 4 Ergebnissen, allen sieben
Scoring-Kategorien wo verfügbar, und einer expliziten Aussage, ob die
Pipeline für Teil E bereit ist. Codex-seitige Reward-Werte müssen dabei
außerhalb dieser interaktiven Sitzung gegengeprüft werden (siehe
`KNOWN_LIMITATIONS.md` #5) -- nicht durch mich in diesem Chat verifizierbar.

**Dieser Plan ist ein Vorschlag, keine Ausführungsfreigabe.** Die 4 Läufe
kosten reales API-Budget; Ausführung erst nach Bestätigung.
