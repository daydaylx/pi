# GUI-002 — Child-Exit während Abort-Drain lässt `stop()` fehlschlagen

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** GUI, Prozesslebenszyklus, Robustheit
- **Ziel:** Stop, Fensterschluss und Projektwechsel müssen auch dann erfolgreich aufräumen, wenn das Child während des Drain-Fensters beendet wird.

## Betroffene Bereiche

- `gui/main/pi-rpc-manager.js`
- `gui/main/ipc-handlers.js`
- Fensterschluss- und Projektwechselpfade

## Verbindliche Regeln

1. Child-Referenz vor jedem `await` lokal sichern.
2. `stop()` ist idempotent und liefert bei bereits beendetem Child Erfolg.
3. Gleichzeitige Stop-Aufrufe beobachten dieselbe Abschluss-Promise.
4. Alte Child-Events dürfen den Zustand eines neuen Childs nicht löschen.
5. Drain-Timer werden beim Exit zuverlässig entfernt.

## Todos

- [ ] Stop-State und Child-Generation definieren.
- [ ] Gemeinsame Stop-/Cleanup-Promise einführen.
- [ ] Ungeschützten Zugriff auf `this.child` nach `await` entfernen.
- [ ] Exit, Abort, Timeout und SIGKILL gemeinsam modellieren.
- [ ] Tests mit schnellem Child-Exit während Abort-Drain ergänzen.
- [ ] Fensterschluss-Rejection-Handling prüfen.

## Pflicht-Regressionstests

- Child beendet sich nach Abort-Bestätigung, aber vor Ablauf des Drain-Timers.
- Zweiter Stop-Aufruf während laufendem Stop.
- Stop nach bereits beendetem Child.
- Neues Child startet während verspätetem Exit-Event des alten Childs.

## Abnahmekriterien

- Der Auditfall wirft keinen `null.once`-Fehler.
- Stop-/Cleanup-Promise erfüllt sich deterministisch.
- Kein alter Exit-Handler beschädigt einen neuen Prozesszustand.

## Abhängigkeiten

- GUI-001 ist für die Bridge nicht zwingend, sollte aber im selben GUI-Lifecycle-Test geprüft werden.

## Risiken

- Falsche Generationserkennung kann echte Exit-Events ignorieren.

## Erforderlicher Abschlussnachweis

PR mit Prozess-State-Diagramm oder Testmatrix und reproduziertem Abort-Drain-Test.
