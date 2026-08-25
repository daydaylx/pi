# Phase 11 – Parität, Stabilisierung und Release Gate

## Ziel

Nachweisen, dass die GUI kein zweiter Harness geworden ist und unter realistischen Bedingungen stabil arbeitet.

## Aufgaben

1. gesamte Test- und Paritätsmatrix ausführen.
2. TUI und GUI mit denselben Projekten, Sessions und Einstellungen vergleichen.
3. lange Sessions, große Diffs und viele Tool-Events testen.
4. wiederholte Projekt- und Sessionwechsel auf Listener-Leaks prüfen.
5. Absturz- und Wiederanlaufszenarien testen.
6. Security-Regressionen prüfen.
7. Barrierearme Bedienung, Fokusführung und Tastaturbedienung prüfen.
8. bekannte Risiken nach P0 bis P3 klassifizieren.
9. Dokumentation gegen den endgültigen Code abgleichen.
10. Releaseentscheidung treffen.

## Verbindliche Paritätsbereiche

- Modelle und Auth
- Einstellungen
- Sessions und Compaction
- Workflow und Thinking
- Tools und Extensions
- Permissions und Trust
- Changes und Verification
- Subagenten
- Fehler- und Abbruchverhalten

## Erforderliche Tests

- vollständige Matrix aus `03-test-und-paritaetsmatrix.md`
- wiederholte Sessionwechsel
- Neustart nach kontrolliertem Schließen
- Neustart nach Prozessabsturz
- Renderer-Crash ohne Sessionkorruption
- sehr lange Streaming-Ausgabe
- Event-Sturm
- große Session
- große Diff-Menge
- Installation auf sauberer Linux-Umgebung

## Abschlusskriterien

- [ ] Alle vorherigen Phasen sind abgeschlossen.
- [ ] Die vollständige Paritätsmatrix ist mit Nachweisen abgearbeitet.
- [ ] TUI und GUI zeigen für denselben Runtimezustand keine fachlichen Widersprüche.
- [ ] Es existieren keine verdoppelten Listener oder wachsenden Timerbestände nach Wechseln.
- [ ] Sessiondateien bleiben bei Abbruch und Absturz konsistent.
- [ ] Renderer-Crash gewährt keine zusätzlichen Rechte und korrumpiert keine Session.
- [ ] Lange Sessions, Diffs und Event-Stürme bleiben bedienbar.
- [ ] Keine offenen P0- oder P1-Fehler.
- [ ] P2-Risiken sind dokumentiert und bewusst akzeptiert oder behoben.
- [ ] Installations- und Smoke-Test auf sauberer Linux-Umgebung ist grün.
- [ ] Dokumentation beschreibt den tatsächlichen Codezustand.
- [ ] Gesamtabschluss aus `04-gesamtabschluss.md` ist erfüllt.

## Releaseentscheidung

- `GO`: alle Kriterien erfüllt
- `GO MIT DOKUMENTIERTEM RESTRISIKO`: nur dokumentierte P2/P3-Punkte
- `NO-GO`: jedes offene P0/P1, Sessionkorruption, Sicherheitslücke oder Runtime-Divergenz

