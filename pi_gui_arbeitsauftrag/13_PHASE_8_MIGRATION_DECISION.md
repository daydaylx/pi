# Phase 8 – Nutzungsentscheidung

## Ziel

Keine automatische Ablösung der TUI.

Erst nach realer Nutzung entscheiden.

## Optionen

### Option A – Beide behalten

```text
pi      -> Aurora
pi gui  -> Desktop GUI
```

Empfohlen, wenn beide unterschiedliche Stärken haben.

### Option B – GUI wird bevorzugte Oberfläche

`pi gui` wird häufiger genutzt, `pi` bleibt Fallback.

### Option C – GUI-Projekt stoppen

Wenn UX-Gewinn den Aufwand nicht rechtfertigt.

### Option D – Spätere TUI-Reduktion

Nur nach expliziter Entscheidung.

Aurora niemals automatisch entfernen.

## Bewertungsfragen

- Wird `pi gui` tatsächlich freiwillig häufiger geöffnet?
- Ist Chat lesbarer?
- Ist Tool-Aktivität weniger störend?
- Sind Shortcuts weiterhin vertraut?
- Sind Menüs schneller erreichbar?
- Ist Debugging schwieriger?
- Gibt es neue Fehlerquellen?
- Ist RAM/Startzeit akzeptabel?
- Funktionieren Sessions stabil?
- gibt es Core/Frontend-Divergenz?

## Abschlusskriterien

- [ ] reale Nutzung durchgeführt.
- [ ] Probleme dokumentiert.
- [ ] UX-Gewinn bewertet.
- [ ] Ressourcenverbrauch bewertet.
- [ ] Stabilität bewertet.
- [ ] Nutzer entscheidet ausdrücklich über A/B/C/D.

## Letztes Gate

Keine automatische Migration.

Nur die ausdrückliche Nutzerentscheidung beendet diese Phase.
