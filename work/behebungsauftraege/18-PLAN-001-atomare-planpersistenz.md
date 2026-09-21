# PLAN-001 — Plan-Persistenz überschreibt direkt

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** Plan-Modus, Persistenz, Datenintegrität
- **Ziel:** Ein I/O-Fehler oder Prozessabbruch darf den letzten vollständigen Plan nicht zerstören.

## Betroffene Bereiche

- `extensions/plan-mode/plan-store.ts`
- `extensions/plan-mode/session.ts`
- Plan-Write, Restore und Rollback

## Verbindliche Regeln

1. Neue Inhalte zunächst vollständig in eine Tempdatei im selben Verzeichnis schreiben.
2. Tempdatei mit restriktiven Rechten anlegen.
3. Optional für Crash-Dauerhaftigkeit synchronisieren.
4. Erst nach erfolgreichem vollständigem Schreiben atomar ersetzen.
5. Gleichzeitige Writer derselben Session serialisieren.
6. Fremde Änderungen dürfen nicht blind überschrieben werden.
7. Hashprüfung und Dateiersetzung müssen als ein nachvollziehbarer Commit behandelt werden.

## Todos

- [ ] Direkten `writeFileSync(path, content)`-Pfad ersetzen.
- [ ] Tempdatei-Namens- und Cleanup-Strategie definieren.
- [ ] Atomaren Rename im selben Verzeichnis verwenden.
- [ ] Crash-/I/O-Fehler zwischen Schreiben und Ersetzen testen.
- [ ] Gleichzeitige Writer innerhalb einer Session testen.
- [ ] Rollback-Logik an atomaren Schreibpfad anpassen.
- [ ] Verhalten bei externem Editor und Fremdänderung erhalten.

## Pflicht-Regressionstests

- Schreibfehler vor vollständigem Temp-Schreiben.
- Prozessabbruch vor Rename.
- Vorheriger Plan bleibt vollständig erhalten.
- Erfolgreicher Write ersetzt den Plan genau einmal.
- Zwei Writer mit konkurrierenden Hashes.
- Rollback nach Agent-Fehler.

## Abnahmekriterien

- Kein Schreibfehler erzeugt einen leeren oder teilweise geschriebenen aktiven Plan.
- Der vorherige Plan bleibt nach fehlgeschlagenem Write lesbar.
- Atomarer Ersatz und Cleanup der Tempdatei sind getestet.
- Fremdänderungen werden weiterhin nicht überschrieben.

## Abhängigkeiten

- REC-002 und Plan-Session-State sollten für Restart-Tests gemeinsam geprüft werden.

## Risiken

- Plattformunterschiede bei Rename und Dateisynchronisierung.
- Prozessübergreifende Sperrung kann zusätzliche Lockdateien erfordern.

## Erforderlicher Abschlussnachweis

PR mit Fehler-Injektion, Restart-/Crash-Test und Nachweis des erhaltenen Vorherstands.
