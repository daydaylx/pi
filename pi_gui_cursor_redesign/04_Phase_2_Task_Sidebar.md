# 04 – Phase 2: Task Sidebar

## Ziel

Technische Icon-Navigation durch eine arbeitsorientierte Task-Navigation ergänzen bzw. ersetzen.

## Zielstruktur

```text
+ Neue Aufgabe

ACTIVE
● GUI überarbeiten
● Tool Renderer

NEEDS INPUT
! API Entscheidung

REVIEW
○ Refactoring

COMPLETED
✓ Audit
✓ Tests
```

## Anforderungen

- ein Klick wechselt den aktiven Task
- aktueller Task ist klar markiert
- Status muss zusätzlich zur Farbe textuell/ikonisch erkennbar sein
- Sidebar ist einklappbar
- Sekundärnavigation für Verlauf, Agenten, Einstellungen darf erhalten bleiben
- keine tiefen Baumstrukturen

## Task-Zeile

Maximal:

```text
● GUI überarbeiten
  Working · 2m
```

## Abschlusskriterien

- Active / Needs Input / Review / Completed funktionieren
- Tasks wechseln ohne Zustandsverlust
- aktiver Task bleibt nach Refresh/Reload korrekt
- Sidebar ist mit Maus und Tastatur bedienbar
- einklappbarer Zustand funktioniert
- kein horizontaler Platzverlust im kompakten Zustand
- Build/Test erfolgreich
