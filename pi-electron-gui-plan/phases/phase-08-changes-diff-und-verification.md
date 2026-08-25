# Phase 08 – Changes, Diff und Verification

## Ziel

Änderungen und Verifikation verständlich darstellen, ohne deren fachlichen Zustand in der GUI neu zu berechnen.

## Aufgaben

1. bestehende Quelle für geänderte Dateien anbinden.
2. Dateiübersicht mit Status darstellen.
3. Diff-Ansicht mit Zeilen- und Größenbegrenzung umsetzen.
4. große und binäre Dateien kontrolliert behandeln.
5. vorhandene Verification starten und beobachten.
6. laufend, erfolgreich, fehlgeschlagen, abgebrochen und veraltet unterscheiden.
7. Fehlerdetails und betroffene Checks darstellen.
8. Änderung nach erfolgreicher Verification als stale sichtbar machen.
9. erneute Verification korrekt zuordnen.
10. keine automatische Commit- oder Push-Funktion ergänzen.

## Performance-Regeln

- große Diffs nicht vollständig ungefiltert rendern
- lange Listen virtualisieren oder begrenzen
- Diff-Berechnung nicht im Renderer-Hauptpfad blockieren
- Streaming und Composer bleiben während Verification bedienbar

## Erforderliche Tests

- keine Änderung
- eine Datei
- viele Dateien
- große Textdatei
- Binärdatei
- gelöschte und umbenannte Datei
- erfolgreiche Verification
- fehlgeschlagene Verification
- Abbruch
- Änderung nach Erfolg
- erneuter erfolgreicher Lauf
- verspätetes Ergebnis eines alten Laufs

## Abschlusskriterien

- [ ] Changes und Verification verwenden vorhandene fachliche Quellen.
- [ ] Die GUI implementiert keine zweite Verification-Entscheidung.
- [ ] Erfolgreich, fehlgeschlagen, abgebrochen und stale sind eindeutig unterscheidbar.
- [ ] Änderung nach erfolgreicher Verification macht das Ergebnis sichtbar veraltet.
- [ ] Verspätete Ergebnisse alter Läufe überschreiben keinen aktuellen Zustand.
- [ ] Große und binäre Diffs blockieren den Renderer nicht.
- [ ] Fehlermeldungen sind dem verursachenden Check zugeordnet.
- [ ] Es wurden keine automatischen Git-Schreibaktionen eingeführt.
- [ ] Verification-Regressionstests sind grün.

## Gate

`NO-GO`, wenn GUI und TUI für denselben Runtimezustand unterschiedliche Verification-Aussagen anzeigen.

