# TEST-001 — CI und Tests sind nicht unabhängig vom Entwicklerrechner ausführbar

## Priorität und Ziel

- **Priorität:** P2, mittel, früh parallel bearbeiten
- **Bereich:** CI, Build, Tests, Portabilität
- **Ziel:** Ein sauberer Checkout muss die vorgesehenen Qualitätsgates ohne persönliche Pfade, versteckte Installationen oder manuelle Reparaturen ausführen können.

## Betroffene Bereiche

- `knip.json`
- `settings.json`
- `npm/package.json`
- `tests/run-all.mjs`, Coverage und Frontend-Contracts
- `benchmarks/real-duel`
- `scripts/install-user.mjs`
- `.github/workflows`

## Verbindliche Regeln

1. Aktive Extensions dürfen nicht wegen veralteter Knip-Entries als unbenutzt gelten.
2. Keine absoluten Entwicklerpfade in Tests oder Runnern.
3. Externe Testabhängigkeiten müssen deklariert, installiert und versioniert sein.
4. Benchmark-Infrastrukturtests werden nicht still ausgeschlossen; sie erhalten einen reproduzierbaren Setup- oder einen klaren verpflichtenden Integrationstest.
5. Der Installer darf keine Tests ausliefern, deren aufgerufene Source-Verzeichnisse fehlen.
6. CI muss den tatsächlichen Gate-Verlauf und den ersten Fehler sichtbar machen.

## Todos

- [ ] Knip-Entry-Liste aus der Extension-/Settings-Konfiguration ableiten oder synchronisieren.
- [ ] Absolute Pfade durch Repository-relative Fixtures und temporäre Verzeichnisse ersetzen.
- [ ] OpenBench-Abhängigkeit als deklarierte Testabhängigkeit oder reproduzierbare Fixture bereitstellen.
- [ ] Benchmark-Testeinstieg und Benchmark-Source im Installationsmodell konsistent machen.
- [ ] Runtime-, GUI-, Frontend-Contract- und Benchmark-Gates separat ausweisen.
- [ ] CI auf Node 22.23.2/npm 10.9.8 festlegen.
- [ ] Clean-checkout-Test in CI hinzufügen.
- [ ] Kein „grün durch Ausklammern“ zulassen.

## Pflicht-Regressionstests

- Knip erkennt die vier Second-Opinion-Dateien nicht mehr als unbenutzt.
- Python-Tests laufen ohne `/home/d/...`-Pfade.
- OpenBench-Tests laufen mit deklarierter Umgebung oder werden als expliziter Integrationstest geblockt.
- Installiertes Paket enthält alle für die ausgelieferten Tests benötigten Dateien.
- `npm run verify` erreicht alle vorgesehenen Verhaltensgates.

## Abnahmekriterien

- Aktuelle CI läuft über Knip hinaus.
- Ein sauberer Checkout benötigt keine lokale Entwicklerinstallation außerhalb des dokumentierten Setups.
- Alle Tests melden echte Fehler; keine problematischen Fälle sind nur deaktiviert.
- GUI- und Frontend-Vertragsprüfungen sind in der passenden CI-Stufe sichtbar.

## Abhängigkeiten

- Grundlage für die Regressionstests aller anderen Aufträge.
- BENCH-001 benötigt portable Sandbox-Fixtures.

## Risiken

- Strengere CI kann weitere bisher verdeckte Portabilitätsfehler sichtbar machen.
- Eine vollständige OpenBench-Integration benötigt möglicherweise eine eigene CI-Umgebung.

## Erforderlicher Abschlussnachweis

PR mit Clean-checkout-Log, CI-Workflow-Diff und Testbilanz ohne manuelle Env-Reparatur.
