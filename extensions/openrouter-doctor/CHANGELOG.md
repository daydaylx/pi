# Changelog

Alle nennenswerten Änderungen an dieser Extension werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/),
Versionierung nach [SemVer](https://semver.org/).

## [1.0.0] — initial

Kompatible Pi-Version zum Release: `@earendil-works/pi-coding-agent@0.84.3`.

### Hinzugefügt

- `/openrouter-doctor [<model-id>] [--deep] [--details]` — Quick Check
  (Catalog, Capabilities, Authentication, Inference) und optionaler Deep
  Check (Tool Calling, Reasoning, Strict Pi compatibility, Provider
  diagnosis mit begrenzter Provider-Isolation).
- Deterministische Fehlernormalisierung für Authentication, Permission,
  Model-not-found, No-endpoints, Rate-limit, Invalid-request, Gateway,
  Timeout und Netzwerkfehler.
- Drei-Werte-Statusmodell: HEALTHY / DEGRADED / BROKEN.
- TUI-Picker über die aktuell konfigurierten OpenRouter-Modelle.
- Kostenkontrolle: Timeout 10 s, max. 3 gleichzeitige Requests, max. 3
  Retries mit Backoff (nur für retrybare Fehler, `Retry-After`-Beachtung
  bei 429), Circuit Breaker nach 3 aufeinanderfolgenden Netzwerkfehlern
  (5 Minuten Cool-down), Provider-Isolation begrenzt auf 3 Provider.

### Bekannte Grenzen (siehe README "Grenzen")

- Router-Metadata (`X-OpenRouter-Metadata`) ist best-effort und zum
  Release-Zeitpunkt nicht live verifiziert.
- Keine automatischen Fixes (nahe Katalog-Kandidaten werden nur genannt).
- `/help openrouter-doctor` zeigt nur die kurze Katalog-Beschreibung, da ein
  längerer dedizierter Hilfetext eine Core-Änderung an
  `extensions/shared/command-catalog.ts`s `guide`-Enum erfordern würde.

### Migration

Keine — Erstversion.
