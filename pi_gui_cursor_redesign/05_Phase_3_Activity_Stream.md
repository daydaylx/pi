# 05 – Phase 3: Activity Stream

## Ziel

Toolspam durch strukturierte, semantische Activity-Ereignisse ersetzen.

## Problem

Aktuell kann ein Agentenlauf optisch aus vielen einzelnen Toolaktionen bestehen:

```text
read
grep
read
bash
write
bash
```

Das ist technisch korrekt, aber für die normale Nutzung schlecht lesbar.

## Ziel

```text
● Repository analysiert                         ✓
  18 Dateien untersucht
  3 relevante Komponenten gefunden
  ▸ Details

● Änderungen vorgenommen                       ✓
  4 Dateien geändert · +132 / -48
  ▸ Änderungen ansehen

● Verifikation                                 ●
  Tests 18/18
  Build läuft...
  ▸ Details
```

## Renderer-Typen

Minimal:

- reasoning
- analysis
- search
- file_read
- file_change
- command
- agent
- verification
- warning
- error
- result

## Regeln

- Rohdaten bleiben zugänglich
- Fehler dürfen niemals wegaggregiert werden
- ähnliche Toolcalls werden gruppiert
- laufende Aktivität bekommt klaren Status
- abgeschlossene Aktivität wird kompakter
- Result/Antwort bleibt visuell von technischer Aktivität getrennt

## Abschlusskriterien

- normaler Agentenlauf ist ohne Toolspam verständlich
- Details lassen sich aufklappen
- Fehler und Warnungen bleiben prominent
- laufende Aktion ist eindeutig
- lange Tasks bleiben performant und scrollbar
- Activity State bleibt nach Taskwechsel erhalten
- Build/Test erfolgreich
- realer Pi-Task wurde einmal komplett durchlaufen
- Screenshot/Screenrecording erstellt

## HARTES GATE 1

Nach Phase 3 STOP.

Vor weiterer Arbeit muss geprüft werden:

1. Ist die neue Informationshierarchie tatsächlich besser?
2. Ist Toolspam deutlich reduziert?
3. Ist der Task-Lifecycle verständlich?
4. Sind keine wichtigen Debuginformationen verloren gegangen?
5. Funktioniert das UI bei einem realen längeren Task?

Ohne ausdrückliche Freigabe nicht mit Phase 4 fortfahren.
