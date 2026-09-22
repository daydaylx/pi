# BENCH-001 — Netzwerk-Allowlist wird nicht technisch erzwungen

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** Benchmark, Security, Vergleichbarkeit
- **Ziel:** Benchmark-Läufe dürfen nur über den attestierten erlaubten Netzwerkpfad kommunizieren; Plan→Work und Work-only müssen denselben Executor nutzen.

## Betroffene Bereiche

- `benchmarks/real-duel/scripts/sandbox_exec.py`
- `benchmarks/real-duel/scripts/pi-duel`
- Plan→Work- und Work-only-Runner

## Verbindliche Regeln

1. Proxy-Umgebungsvariablen gelten nicht als Netzwerk-Sandbox.
2. Direkte TCP-, UDP- und DNS-Pfade müssen technisch blockiert oder nachweisbar kontrolliert werden.
3. Alle Kandidatenstarts laufen über denselben Sandbox-Executor.
4. Ein fehlgeschlagener Sandbox-Preflight darf keinen Lauf als isoliert markieren.
5. Provider-Auth und DNS-Verhalten werden als Teil des Profils dokumentiert.

## Todos

- [ ] Gemeinsames Ausführungsobjekt für Work-only und Plan→Work definieren.
- [ ] Egress-Mechanismus mit hartem Proxy-/Netzwerkpfad implementieren.
- [ ] Preflight-Attestierung vor dem Kandidatenstart speichern.
- [ ] Direkte Socket-, UDP-, DNS- und Proxy-Unset-Tests ergänzen.
- [ ] Fehlende Werkzeuge wie `slirp4netns` im CI explizit erkennen.
- [ ] Telemetrie und effektive Sandbox-Parameter im Ergebnis speichern.

## Pflicht-Regressionstests

- Programm ignoriert Proxy und öffnet direkten Socket.
- Proxy-Variablen werden entfernt oder überschrieben.
- DNS-Auflösung außerhalb des erlaubten Pfads.
- Plan→Work und Work-only verwenden denselben Executor.
- Sandbox-Preflight-Fehler führt zu `unknown`/nicht auswertbar.

## Abnahmekriterien

- Kein Lauf wird als allowlist-konform markiert, wenn direkte Egress-Kontrolle nicht attestiert ist.
- Plan→Work umgeht den Sandbox-Wrapper nicht mehr.
- Effektive Netzwerkbedingungen sind reproduzierbar dokumentiert.

## Abhängigkeiten

- TEST-001 für portable Sandbox-Fixtures.
- BENCH-003 für die Auswertung unbekannter Preflights.

## Risiken

- SDKs, Provider-Auth und DNS können in einer strengeren Sandbox ausfallen.
- Linux-spezifische Isolation ist nicht automatisch auf macOS/Windows übertragbar.

## Erforderlicher Abschlussnachweis

PR mit erfolgreichem Sandbox-Preflight, adversarialen Egress-Tests und Plan→Work-Ausführung.
