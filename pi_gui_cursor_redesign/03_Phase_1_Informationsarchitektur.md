# 03 – Phase 1: Informationsarchitektur

## Ziel

Redundanzen entfernen und den Task zum klaren visuellen Mittelpunkt machen.

## Aufgaben

- permanenten Inspector aus dem Hauptlayout entfernen
- doppelte Work-Anzeige beseitigen
- mehrfache Modellanzeige beseitigen
- Context-/Tokeninformationen aus der Primäransicht entfernen
- Header auf wenige Kerninformationen reduzieren
- aktuellen Task prominent benennen
- bestehende Funktionen zunächst nur umpositionieren, nicht löschen

## Ziel-Header

Beispiel:

```text
Pi / pi / GUI überarbeiten                   Work    GPT-5.6 Terra ●
```

## Nicht tun

- noch kein umfassendes Styling
- noch keine neue Agentenarchitektur
- keine zusätzlichen Features
- keine tiefen Core-Änderungen

## Abschlusskriterien

- Modell erscheint maximal einmal permanent
- Workflow erscheint maximal einmal permanent
- Inspector ist für normale Nutzung nicht permanent sichtbar
- aktueller Task ist eindeutig erkennbar
- alle bisherigen Inspectorinformationen bleiben erreichbar oder werden für spätere Drawer-Migration sauber vorbereitet
- kein Funktionsverlust
- Build erfolgreich
- Basis-Interaktion funktioniert
- Screenshot erstellt

## Gate

Kein hartes Gate, aber bei strukturellen Problemen nicht mit Phase 2 fortfahren.
