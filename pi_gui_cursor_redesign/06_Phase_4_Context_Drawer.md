# 06 – Phase 4: Context Drawer

## Ziel

Den bisherigen permanenten Inspector als sekundären, bei Bedarf geöffneten Drawer neu aufbauen.

## Inhalt

- Status
- Workflow
- Modell
- Thinking
- Context
- Agenten
- Changes
- Sessioninformationen

## Beispiel

```text
TASK DETAILS

Status
Working

Workflow
Work

Model
GPT-5.6 Terra

Thinking
High

Context
43 %

Agents
Investigator
Verifier

Files
8 changed
```

## Regeln

- Drawer standardmäßig geschlossen
- Escape schließt ihn
- kein Informationsverlust gegenüber altem Inspector
- keine redundante Darstellung mit Header/Composer
- Drawer darf den Hauptworkflow nicht blockieren

## Abschlusskriterien

- alle relevanten alten Inspectorinformationen erreichbar
- Drawer kann mit Maus und Tastatur geöffnet werden
- Escape funktioniert
- Fokusmanagement funktioniert
- Drawer ist responsive
- kein permanenter Platzverbrauch
- Build/Test erfolgreich
