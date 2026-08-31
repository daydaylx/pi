# Pi GUI – Cursor-orientiertes Redesign

## Zweck

Dieser Ordner ist ein vollständiges Arbeits- und Planpaket für die Überarbeitung der Pi-GUI.

**Referenz:** Cursor – insbesondere die task-/agentenorientierte Informationsarchitektur, klare Statuszustände und Review-Workflows.

**Wichtig:** Cursor ist eine Referenz, keine Vorlage zum 1:1-Kopieren.

## Zielbild

Pi soll sich nicht wie eine vergrößerte TUI oder ein Chatfenster mit Inspector anfühlen, sondern wie ein schlanker Agent Workspace:

**Projekt → Task → Activity → Changes → Verification → Review → Completion**

## Verbindliche Grundregeln

1. Der bestehende Pi-Core bleibt möglichst unangetastet.
2. Die GUI wird über bestehende Zustände und Events gelegt, nicht andersherum.
3. Keine IDE-Komplexität einführen.
4. Keine Funktion nur übernehmen, weil Cursor sie besitzt.
5. Jede Phase besitzt eigene Abschlusskriterien.
6. Nach jeder Phase: Build/Test + visueller Screenshot.
7. Nach Phase 3 und Phase 7 ist ein **hartes Gate** vorgesehen.
8. Ohne ausdrückliche Freigabe nach einem Gate nicht weiterarbeiten.
9. Technische Statusinformationen werden sekundär dargestellt.
10. Task und aktueller Arbeitsfortschritt sind immer der visuelle Mittelpunkt.

## Dokumente

- `00_Ziel_Nichtziel_Annahmen.md`
- `01_Cursor_Referenz_und_Designprinzipien.md`
- `02_Zielarchitektur_und_Statusmodell.md`
- `03_Phase_1_Informationsarchitektur.md`
- `04_Phase_2_Task_Sidebar.md`
- `05_Phase_3_Activity_Stream.md`
- `06_Phase_4_Context_Drawer.md`
- `07_Phase_5_Composer.md`
- `08_Phase_6_Changes_Review.md`
- `09_Phase_7_Verification.md`
- `10_Phase_8_Startscreen.md`
- `11_Phase_9_Visual_Redesign.md`
- `12_Phase_10_Agentenintegration.md`
- `13_Testplan_und_Abnahme.md`
- `14_Umsetzungsregeln_fuer_Agent.md`
- `15_Arbeitsauftrag.md`
- `16_Entscheidungslog_Vorlage.md`

## Empfohlene Reihenfolge

1. Informationsarchitektur
2. Task Sidebar
3. Activity Stream
4. **Gate 1**
5. Context Drawer
6. Composer
7. Changes & Review
8. Verification
9. **Gate 2**
10. Startscreen
11. Visual Redesign
12. Agentenintegration
13. Abschlussaudit

## Erfolgskriterium

Die GUI ist erfolgreich, wenn ein Nutzer innerhalb weniger Sekunden beantworten kann:

- Welche Aufgabe läuft?
- Was macht Pi gerade?
- Was wurde geändert?
- Braucht Pi meine Entscheidung?
- Sind die Änderungen geprüft?
- Ist die Aufgabe wirklich fertig?
