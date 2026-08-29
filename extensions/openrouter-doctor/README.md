# OpenRouter Doctor

Diagnostiziert OpenRouter-Modelle, die in dieser Pi-Konfiguration eingerichtet
sind, und erklärt verständlich auf Deutsch, warum ein Modell funktioniert,
eingeschränkt funktioniert oder scheitert. **Verändert nie** Modell, Provider,
API-Key oder `settings.json` — reine Diagnose.

## Nutzung

```
/openrouter-doctor                 # Picker über konfigurierte OpenRouter-Modelle, Quick Check
/openrouter-doctor <model-id>      # Direkt ein Modell prüfen, z. B. openai/gpt-oss-120b
/openrouter-doctor <model-id> --deep       # Deep Check
/openrouter-doctor <model-id> --details    # Technische Details im Report einblenden
```

`<model-id>` akzeptiert sowohl `openai/gpt-oss-120b` als auch
`openrouter/openai/gpt-oss-120b`.

## Quick Check (Standard)

1. Catalog — existiert die Modell-ID im aktuellen, live abgerufenen
   OpenRouter-Katalog?
2. Capabilities — welche Pi-relevanten Fähigkeiten meldet der Katalog
   (Tools, Tool Choice, Reasoning, Structured Outputs)?
3. Authentication — `GET /api/v1/key` (kostenlos, kein Inference-Request)
4. Inference — ein minimaler `POST /api/v1/chat/completions` ("Reply
   exactly with: OK", kleines `max_tokens`)

## Deep Check (`--deep`)

Zusätzlich zu Quick Check:

- **Tool Calling** — ein harmloses Dummy-Tool (`test_tool`) wird angeboten
  und die Antwort auf einen echten, parsebaren Tool Call geprüft.
- **Reasoning** — nur technische Kompatibilität des `reasoning`-Parameters,
  keine Bewertung der Reasoning-Qualität.
- **Strict Pi compatibility** — vergleicht normales Routing gegen
  `provider.require_parameters=true` mit denselben Pi-relevanten Parametern.
- **Provider diagnosis** — nur wenn Strict Routing fehlschlägt: freie
  Endpoint-Metadaten (`GET /api/v1/models/{author}/{slug}/endpoints`) plus
  isolierte Einzel-Requests (`provider.only`) gegen **maximal 3** Provider.

## Status

Nur drei Werte: **HEALTHY** (alles im geprüften Modus funktioniert),
**DEGRADED** (Modell funktioniert grundsätzlich, aber nicht uneingeschränkt
für das, was Pi tatsächlich braucht), **BROKEN** (Katalog/Auth/Basis-
Inference funktionieren nicht).

## Ausgeführte Requests & Kosten

| | Requests | Kosten |
|---|---|---|
| Quick Check | 1× `/models` (frei), 1× `/key` (frei), 1× minimaler `/chat/completions` | 1 kleiner Inference-Request |
| Deep Check zusätzlich | 1× Tools, 1× Reasoning, 1× Strict-Vergleich, ggf. 1× `/endpoints` (frei) + bis zu 3× Provider-Isolation | bis zu 6 kleine Inference-Requests |

Alle Inference-Requests nutzen ein kleines `max_tokens`-Limit und werden
**nicht wiederholt**; dadurch bleiben die Tabellenobergrenzen verbindlich. Es
werden nie mehr als 3 Requests gleichzeitig gestellt, jeder Request hat 10 s
Timeout. Nur kostenfreie Metadaten-Requests (`/models`, `/key`, `/endpoints`)
werden bei Timeout, Netzwerkfehlern oder 429/502/503/524/529 bis zu 3× mit
exponentiellem Backoff wiederholt. Ein serverseitiges `Retry-After` wird dabei
auf 10 s begrenzt und respektiert Abbruchsignale. Nach 3 aufeinanderfolgenden
Netzwerkfehlern öffnet ein Circuit Breaker für 5 Minuten und meldet "OpenRouter
scheint nicht verfügbar zu sein" statt weiter zu versuchen.

Der Doctor läuft **nie automatisch** (nicht beim Pi-Start, kein Polling) —
nur auf expliziten `/openrouter-doctor`-Aufruf.

## Datenschutz / API-Key-Sicherheit

Der API-Key wird ausschließlich über Pi's eigene Credential-Verwaltung
aufgelöst (`ctx.modelRegistry.getApiKeyAndHeaders`). Die Extension liest
niemals `auth.json` direkt, speichert nie einen Key in einer eigenen Datei
und gibt den Key nie aus — auch nicht im `--details`-Modus. Reports enthalten
nie rohe Stack Traces. Credentials werden ausschließlich an den offiziellen
HTTPS-Endpoint `https://openrouter.ai/api/v1` gesendet; abweichende Modell-
oder Registry-Endpunkte werden vor jedem authentifizierten Request abgelehnt.

Diese Version implementiert **keinen** separaten `OPENROUTER_DOCTOR_DEBUG`-
Modus und schreibt keine Logdatei nach `~/.pi/logs/`: In diesem Repository
existiert keine solche Logging-Infrastruktur (kein Logger-Modul, kein
`~/.pi/logs/`-Verzeichnis) und dieses Repo hat auch für andere Extensions
keine — siehe Repository-Analyse. `--details` ist der einzige technische
Detail-Modus und bleibt genauso key-frei wie die Standardansicht.

## Grenzen

- Ein erfolgreicher Check bedeutet: *das Modell hat zum Testzeitpunkt mit den
  getesteten Fähigkeiten funktioniert* — nicht, dass es dauerhaft zuverlässig
  funktioniert. OpenRouter-Routing und Provider-Verfügbarkeit ändern sich.
- Fehler werden deterministisch, regelbasiert erklärt (kein LLM) — eine
  falsche Regel ist wenigstens konsistent falsch, eine LLM-Interpretation
  könnte eine Ursache erfinden.
- Router-Metadata (`X-OpenRouter-Metadata`) wird best-effort ausgewertet,
  wenn vorhanden; die Diagnose hängt nicht davon ab und dieses Feature war
  zum Zeitpunkt der Implementierung nicht anhand von Live-Traffic
  verifizierbar.
- Provider-Isolation läuft nur bei Deep Check und nur wenn Strict Routing
  bereits fehlschlägt, begrenzt auf 3 Provider.
- Reasoning-*Qualität* wird nie bewertet, nur technische Parameter-
  Kompatibilität.
- Automatische Fixes gibt es in dieser Version nicht: nahe Katalog-
  Kandidaten werden nur informativ im Report genannt, nie automatisch
  übernommen.
- Nur diese Pi-Konfiguration wird geprüft, keine anderen Provider.

## Verhalten bei Ausfall/Timeout/Rate-Limit

- OpenRouter nicht erreichbar → klare deutsche Meldung, kein Absturz.
- Timeout (10 s) → als eigene Fehlerkategorie erklärt, kein hängender
  Request bleibt zurück.
- 429 → Meldung inkl. `Retry-After`, sofern vorhanden (maximal 10 s Wartezeit
  für kostenfreie Metadaten-Requests).
- Ein fehlschlagender Check blockiert die anderen Checks nicht — jeder Check
  läuft in seinem eigenen Fehler-Wrapper und liefert im Zweifel `unknown`
  statt den gesamten Lauf abzubrechen.

## Live-Test-Voraussetzungen

`tests/openrouter-doctor/live/manual-live-check.mjs` ist **nicht** Teil von
`npm test`/`npm run verify`. Manuell ausführen:

```
OPENROUTER_API_KEY=sk-or-... node tests/openrouter-doctor/live/manual-live-check.mjs
```

Voraussetzungen: gültiger, eigener OpenRouter-API-Key, Netzwerkzugriff,
ausreichend Guthaben für ein paar kleine Requests. Nutzt bewusst ein
konfiguriertes Free-Tier-Modell (`openai/gpt-oss-20b:free`) für Fall A und
eine erfundene Modell-ID für Fall B. Fall C (ein Modell mit echtem,
reproduzierbarem Providerproblem) ist nicht automatisiert, da kein
verlässliches Fixture dafür existiert — manuell mit einem passenden Modell
nachvollziehen, falls gerade eines bekannt ist.

## Troubleshooting

| Symptom | Wahrscheinliche Ursache |
|---|---|
| "Keine konfigurierten OpenRouter-Modelle gefunden" | Kein `openrouter/...`-Modell in `settings.json` → `enabledModels` |
| Sofortiges BROKEN mit "Authentifizierung" | `OPENROUTER_API_KEY` nicht gesetzt/ungültig, oder OpenRouter-OAuth fehlt |
| "OpenRouter scheint nicht verfügbar zu sein" | Circuit Breaker offen nach 3 Netzwerkfehlern — kurz warten (5 Minuten) |
| Deep Check dauert lange | Provider-Isolation läuft (bis zu 3 zusätzliche Requests, sequenziell) |
| `/help openrouter-doctor` zeigt nur einen kurzen Satz | Das feste `guide`-Vokabular für lange Hilfetexte ist Core-Code; ein längerer dedizierter Hilfetext würde eine Core-Änderung erfordern und wurde bewusst nicht gemacht |

## Nicht-Ziele

Kein neuer Agent, keine Änderung an Investigator/Debugger/Verifier, keine
Runtime-Patches, kein automatischer Modell-/Provider-Wechsel, keine stillen
`settings.json`-Änderungen, keine automatische API-Key-Änderung, keine
automatische Ausführung beim Pi-Start, kein dauerhaftes Polling, keine
allgemeine Provider-Abstraktion, kein Modellqualitäts-Benchmark.
