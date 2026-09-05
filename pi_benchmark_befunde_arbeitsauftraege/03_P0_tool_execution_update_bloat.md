# P0 – `tool_execution_update`-Bloat

## Befund

Pi erzeugte in Real-Duel #002 ein Transkript von 251 MB.

Davon:
- 967 `tool_execution_update`-Events
- ca. 236 MB allein aus diesen Events
- gzip immer noch ca. 71 MB

Quelle: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign.md

## Risiko

- massive lokale Storage-Kosten.
- langsame Telemetrie-/Session-Verarbeitung.
- erschwerte Debugbarkeit.
- potenziell unnötiger Kontext-/IPC-/GUI-Overhead.
- Benchmarkartefakte lassen sich nicht mehr normal archivieren.

## Arbeitsauftrag

Analysiere den kompletten Lebenszyklus von `tool_execution_update` und reduziere
Redundanz, ohne Live-Fortschritt oder Debugbarkeit zu verlieren.

### Analyse

Für jedes Update prüfen:
- Payload-Größe
- enthält es Delta oder kompletten bisherigen Output?
- Quelle/Tool
- Frequenz
- Serialisierung
- Persistierung
- Weitergabe an GUI
- Weitergabe an Modell/Session
- Telemetrie

Erzeuge eine Größenanalyse:
- Top 20 größte Events
- Top Tools nach kumulierter Update-Größe
- Anzahl identischer/nahezu identischer Payloads
- kumulatives Wachstum pro Toolcall

### Wahrscheinliche Optimierungsrichtungen

Nur nach Beleg umsetzen:
- Delta statt Full Snapshot
- Coalescing
- Rate-Limit/Throttle
- Max-Payload für Zwischenstände
- finaler vollständiger Output ausschließlich in `tool_execution_end`
- Persistierung nur relevanter Zwischenstände
- GUI darf weiterhin Live-Status erhalten

### Wichtige Regel

Nicht einfach Updates abschalten. Die Aktivitätsanzeige muss erhalten bleiben.

### Tests

- lang laufender Shell-Befehl
- Tool mit sehr großem Output
- viele kleine Updates
- identische Updates
- GUI-Livefortschritt
- finales Toolergebnis vollständig
- Session-Wiederherstellung

### Messziel

Den gleichen bzw. nahezu gleichen Run erneut ausführen und vergleichen:
- Transcript-Größe
- Eventanzahl
- maximale Eventgröße
- Laufzeit
- Speicher
- GUI-Verhalten

### Abschlusskriterien

- keine quadratisch/akkumulativ anwachsenden Full-Snapshot-Updates.
- finaler Tooloutput vollständig.
- Live-Status bleibt nutzbar.
- Größenreduktion wird mit Vorher/Nachher-Zahlen dokumentiert.
