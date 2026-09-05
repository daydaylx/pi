# P2 – Subagenten-Nutzen

## Befund

Der Verifier-Aufruf im Benchmark verursachte selbst einen Contractfehler.
Subagenten erzeugen zusätzlichen Prompt-, Tool-, Kontext- und Zeitaufwand.

## Arbeitsauftrag

Bewerte jede aktuell verwendete Subagentenrolle nach realem Zusatznutzen.

### Für jede Rolle messen

- Auslösegrund
- zusätzlicher Input/Output
- Laufzeit
- Toolcalls
- welche neue Information kam tatsächlich zurück?
- wurde dadurch ein Fehler gefunden/verhindert?
- hätte Main Agent dieselbe Prüfung ohnehin durchgeführt?

### Speziell Verifier

Der Verifier sollte vor allem unabhängige Gegenprüfung liefern, nicht einfach
blind bereits gelaufene Tests wiederholen.

### Entscheidungsmöglichkeiten

- behalten wie bisher
- Trigger enger definieren
- Rolle vereinfachen
- Fallback verbessern
- seltene Rolle deaktivieren

### Abschlusskriterium

Jede standardmäßig eingesetzte Rolle hat einen dokumentierten, messbaren Zweck.
