# Go-/No-Go-Kriterien

## Kandidatenauswahl

Ein vorhandenes GUI-Projekt darf nur als Basis verwendet werden, wenn:

- Pi-Unterbau nicht ersetzt werden muss,
- Verbindung zum echten Pi-Core möglich ist,
- Lizenz kompatibel ist,
- Electron/React/TypeScript-Architektur ausreichend wartbar ist,
- Tool-/Session-/Chat-Infrastruktur wiederverwendbar ist,
- keine erzwungene Übernahme fremder Agentenlogik nötig ist,
- bestehende Pi-Extensions weiterhin nutzbar bleiben können,
- Anpassungen nicht mehr Aufwand verursachen als ein kontrollierter Neuaufbau.

## No-Go für einen GUI-Kandidaten

Sofort ausscheiden, wenn mindestens einer der Punkte zutrifft:

1. Core muss auf dessen Datenmodell umgeschrieben werden.
2. vorhandene Pi-Extensions funktionieren grundsätzlich nicht mehr.
3. Modell-/Provider-Auswahl müsste doppelt gepflegt werden.
4. Sessions werden inkompatibel.
5. Permission-Logik müsste dupliziert werden.
6. Verification müsste im Frontend neu implementiert werden.
7. RPC/SDK-Schicht ist so eng gekoppelt, dass der eigene Pi praktisch ersetzt wird.
8. Lizenz verhindert den geplanten Einsatz.
9. Projekt ist technisch so instabil, dass Forken mehr Risiko als Nutzen bringt.

## Projektweite Abbruchkriterien

Das Gesamtprojekt muss pausiert und neu bewertet werden, wenn:

- `pi` wiederholt durch GUI-Arbeit regressiert,
- Core und GUI beginnen auseinanderzulaufen,
- für dieselbe Funktion zwei Regeln entstehen,
- State-Synchronisation unzuverlässig ist,
- Session-Verlust droht,
- GUI-Crash Core-Sessions beschädigt,
- Shortcuts nicht zuverlässig abgefangen/weitergeleitet werden können,
- GUI-Aufwand keinen klaren UX-Gewinn liefert.

## Go-Kriterien für den nächsten Schritt

Eine Phase ist nur "GO", wenn:

- Tests grün,
- Abschlusskriterien erfüllt,
- keine kritischen offenen Bugs,
- bekannte Einschränkungen dokumentiert,
- Rollback möglich,
- Nutzerfreigabe vorhanden.
