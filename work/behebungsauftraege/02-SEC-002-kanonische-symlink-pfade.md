# SEC-002 — Sensible Ziele hinter internen Symlinks verlieren Schutz

## Priorität und Ziel

- **Priorität:** P1, hoch
- **Bereich:** Security, Pfade, Datei-Policy
- **Ziel:** Schutzregeln müssen sowohl den angeforderten Pfad als auch das tatsächlich erreichte kanonische Ziel berücksichtigen.

## Betroffene Bereiche

- `extensions/shared/permission-policy.ts`
- `extensions/permissions/workflow-policy.ts`
- native `read`, `write` und `edit`-Pfade

## Verbindliche Regeln

1. Lexikalische Pfadidentität und kanonische Zielidentität getrennt erfassen.
2. Für existierende Pfade das reale Ziel auflösen.
3. Für neue Dateien den kanonischen existierenden Elternpfad auflösen.
4. `.env`, Credentials, `.pi/verify.json` und andere geschützte Ziele über beide Identitäten klassifizieren.
5. Interne, legitime Symlinks wie normale `.bin`-Strukturen nicht pauschal blockieren.
6. Die Lücke zwischen Prüfung und Zugriff durch sichere Dateioperationen soweit möglich verkleinern; verbleibendes TOCTOU-Risiko dokumentieren.

## Todos

- [ ] Aktuelle Pfadauflösung und alle Schutzklassifizierungen kartieren.
- [ ] API für `lexicalPath`, `canonicalPath`, `scope` und `targetKind` definieren.
- [ ] Existierende und neu anzulegende Pfade getrennt behandeln.
- [ ] Datei-Policy und Workflow-Guard auf kanonische Ziele umstellen.
- [ ] Dateioperationen auf `lstat`/sichere Öffnungsoptionen prüfen.
- [ ] Schutz von Credentials und ausführbarer Projektkonfiguration zentralisieren.
- [ ] Tests mit internen, externen und dangling Symlinks ergänzen.

## Pflicht-Regressionstests

- Harmloser Alias auf `.env`: Lesen und Schreiben müssen blockiert oder bestätigt werden.
- Harmloser Alias auf `.pi/verify.json`: zusätzliche Schutzregel muss greifen.
- Interner Link auf normale Projektdatei: zulässiges Verhalten bleibt erhalten.
- Symlink außerhalb des Projektroots: Escape bleibt blockiert.
- Dangling Symlink und neuer Zielpfad.
- Prüfung über Native-Tool-Loop, nicht nur über eine isolierte Hilfsfunktion.

## Abnahmekriterien

- Der Alias `ordinary.txt → .env` wird als sensibel erkannt.
- Der Alias `config-alias.json → .pi/verify.json` kann keine Schutzfreigabe umgehen.
- Externe Symlink-Escapes bleiben blockiert.
- Normale interne Symlinks funktionieren weiterhin.
- Tests belegen sowohl Lese- als auch Schreibverhalten.

## Abhängigkeiten

- SEC-001/REC-001: gemeinsame Capability- und Guard-Entscheidung.
- Native Dateioperationen der externen Runtime müssen im Integrationstest einbezogen werden.

## Risiken

- Plattformunterschiede bei `realpath`, Junctions und Symlink-Rechten.
- Zu frühe Kanonisierung kann legitime relative Pfade falsch klassifizieren.

## Erforderlicher Abschlussnachweis

PR mit Pfadmodell, Testmatrix für Symlink-Fälle und dokumentierter Aussage zum verbleibenden TOCTOU-Risiko.
