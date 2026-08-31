# 07 – Phase 5: Composer

## Ziel

Composer von einer Chatbox zu einem Agent-Control-Point entwickeln.

## Zielansicht

```text
┌─────────────────────────────────────────────────────────────┐
│ Was soll Pi tun?                                           │
│                                                             │
│ Work ▾      Terra ▾      Thinking: High ▾         Senden  │
└─────────────────────────────────────────────────────────────┘
```

## Laufender Task

Placeholder:

```text
Anweisung an laufenden Task...
```

Aktionen:

- Stop
- neue Anweisung
- Senden

## Needs Input

Wenn Pi eine Entscheidung benötigt, muss diese deutlich priorisiert werden.

Beispiel:

```text
Pi benötigt eine Entscheidung

Welche Datenbank soll verwendet werden?

○ SQLite
○ PostgreSQL
○ Andere

[ Entscheidung senden ]
```

## Abschlusskriterien

- Work/Plan direkt erreichbar
- Modell direkt erreichbar
- Thinking direkt erreichbar
- keine separate redundante Statusleiste
- Enter/Shift+Enter Verhalten korrekt
- Stop funktioniert
- Needs-Input-Zustand ist klar
- bestehende relevante Shortcuts bleiben erhalten
- Build/Test erfolgreich
