# LSP-001 — Versionslose Diagnostics bleiben scheinbar aktuell

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** LSP, Agent, State
- **Ziel:** Nach einer Dateimutaton dürfen alte, versionslose Diagnostics nicht als Diagnose des neuen Inhalts zurückgegeben werden.

## Betroffene Bereiche

- `extensions/lsp/documents.ts`
- `openOrSync`, `didChange`, `waitForDiagnostics`
- LSP-Tests

## Verbindliche Regeln

1. Der lokale Sync-Stand ist eine eigene Generation, unabhängig von der Serverversion.
2. Bei `didChange` werden alte Cache-Einträge entwertet.
3. Eine versionslose Antwort vor der neuen Publikation erfüllt keine spätere `minVersion`.
4. Verzögerte Antworten dürfen nicht automatisch der neuesten Version zugeschrieben werden.
5. Unsicherheit wird als ausstehend oder Timeout sichtbar gemacht.

## Todos

- [ ] Lokale Dokumentgeneration einführen.
- [ ] Diagnostics-Cache an diese Generation binden.
- [ ] Versionslose Antworten nur der wartenden Generation zuordnen, wenn dies sicher möglich ist.
- [ ] Alte Einträge bei Änderung und Restart löschen.
- [ ] Tests für verzögerte und versionslose Publikationen ergänzen.
- [ ] Pull-Diagnostics als mögliche Erweiterung dokumentieren.

## Pflicht-Regressionstests

- Version 1 mit leerer Diagnose, danach syntaktischer Fehler in Version 2.
- `waitForDiagnostics(..., 2, ...)` darf nicht sofort die alte leere Diagnose liefern.
- Neue versionslose Antwort nach Version 2 wird akzeptiert.
- Verzögerte Antwort von Version 1 wird verworfen.

## Abnahmekriterien

- Der reproduzierte V1→V2-Fall liefert kein veraltetes `diagnostics=[]`.
- Tests decken versionierte und versionslose Server ab.
- Timeouts bleiben erkennbar und werden nicht als „keine Fehler“ geglättet.

## Abhängigkeiten

- Keine fachliche Abhängigkeit; benötigt jedoch einen kontrollierten LSP-Test-Peer.

## Risiken

- Zu strenge Regeln können Server ohne Versionierung häufiger in Timeout bringen.

## Erforderlicher Abschlussnachweis

PR mit Cache-/Generationsmodell und Testausgabe des versionslosen V1→V2-Falls.
