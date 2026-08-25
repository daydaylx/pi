# Phase 09 – Subagenten, Kontext und GUI-Einstellungen

## Ziel

Sekundäre Arbeitsinformationen sichtbar machen, ohne die Hauptoberfläche in ein Dashboard zu verwandeln oder Runtime-Einstellungen zu duplizieren.

## Aufgaben

1. aktive und kürzlich relevante Subagenten darstellen.
2. Rolle, Status, Blockade und letzte relevante Aktion anzeigen.
3. Subagent-Tool-Ausgaben kompakt halten.
4. Kontextbelegung und Compaction-Status darstellen.
5. globale Runtime-Einstellungen über vorhandene Dienste bedienen.
6. GUI-eigene Einstellungen separat speichern:
   - Fenstergröße und Position
   - Panelbreiten
   - aktiver Drawer
   - Schriftgröße
   - reduzierte Animationen
7. bestehende Shortcuts im fokussierten GUI-Fenster anbinden.
8. für jede Shortcut-Aktion eine Mausbedienung anbieten.

## Nicht-Ziele

- kein permanentes Subagent-Dashboard
- keine CPU-, RAM-, Kosten- oder Telemetrie-Wand
- kein neues Keymap-System
- keine systemweiten Global Shortcuts
- keine Kopie von Modell-, Workflow- oder Permission-Einstellungen

## Erforderliche Tests

- kein aktiver Subagent
- ein aktiver Subagent
- mehrere Subagenten
- blockierter Subagent
- Subagent-Rückfrage
- Kontext vor und nach Compaction
- Neustart mit gespeicherten GUI-Einstellungen
- Runtime-Einstellung ändert sich in TUI und ist in GUI sichtbar
- Shortcuts bei fokussiertem Composer
- Mausalternative jeder Aktion

## Abschlusskriterien

- [ ] Subagenten werden aus der vorhandenen Quelle dargestellt.
- [ ] Blockaden und Nutzerentscheidungen haben Priorität vor normalem Status.
- [ ] Die Hauptansicht besitzt keine permanente Subagent-Seitenleiste.
- [ ] Kontext- und Compaction-Daten stimmen mit der Runtime überein.
- [ ] GUI-Einstellungen verwenden einen getrennten Namespace.
- [ ] Keine Runtime-Einstellung wird in GUI-State dupliziert.
- [ ] Bestehende kanonische Shortcuts funktionieren nur im fokussierten Fenster.
- [ ] Jede Shortcut-Funktion besitzt eine Mausbedienung.
- [ ] Texteingabe wird nicht unbeabsichtigt durch Shortcuts gestört.

## Gate

`NO-GO`, wenn GUI-Einstellungen fachlichen Runtime-State überschreiben oder duplizieren.

