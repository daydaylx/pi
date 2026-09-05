Analysiere die aktuelle GUI von Pi vollständig hinsichtlich UI, UX, Informationsarchitektur, Interaktionsdesign und visueller Qualität.

Ziel ist NICHT nur ein kosmetisches Redesign.

Du sollst zuerst systematisch Schwächen erkennen, Ursachen analysieren, unnötige Komplexität identifizieren und anschließend konkrete Verbesserungen entwickeln und umsetzen.

Die GUI soll sich wie ein ausgereiftes Arbeitswerkzeug für einen Coding-Agenten anfühlen und nicht wie eine Sammlung einzelner Panels und Funktionen.

Wichtig:

- bestehende Agenten-/Harness-Logik nicht unnötig verändern
- keine Features nur für bessere Optik hinzufügen
- keine Architektur unnötig aufblasen
- bestehende funktionierende Bedienkonzepte möglichst erhalten
- UX-Verbesserungen müssen reale Probleme lösen
- vorhandene Funktionen dürfen durch das Redesign nicht verloren gehen
- Code und tatsächliches Verhalten sind wichtiger als bestehende Dokumentation
- nicht einfach Cursor, Claude Code oder Codex kopieren
- diese Produkte dürfen als Referenz für gelöste UX-Probleme dienen

==================================================
1. ZIELBILD
==================================================

Die Pi-GUI soll am Ende:

- ruhig
- modern
- professionell
- übersichtlich
- informationsreich, aber nicht überladen
- schnell erfassbar
- konsistent
- responsiv
- für lange Agentenläufe geeignet

sein.

Der Nutzer soll jederzeit schnell erkennen können:

1. Was macht der Agent gerade?
2. Welcher Workflow ist aktiv?
3. Welches Modell arbeitet?
4. Was hat der Agent zuletzt gemacht?
5. Gibt es aktive Tools/Subagenten?
6. Wartet der Agent auf mich?
7. Gibt es einen Fehler?
8. Wie weit ist die Aufgabe ungefähr fortgeschritten?
9. Welche Änderungen wurden vorgenommen?
10. Was kann ich jetzt tun?

Die GUI soll besonders für längere Coding-Aufgaben optimiert sein, nicht primär für kurze Chat-Unterhaltungen.

==================================================
2. NICHT-ZIELE
==================================================

Nicht Bestandteil dieser Aufgabe:

- Harness grundsätzlich neu bauen
- Agentenarchitektur ersetzen
- Workflow-System neu erfinden
- Provider-/Modelllogik umbauen
- unnötige Backendänderungen
- neue Features ohne nachweisbaren UX-Nutzen
- Animationen um ihrer selbst willen
- möglichst viele Informationen gleichzeitig anzeigen
- Design nur anhand von Screenshots optimieren

==================================================
3. PHASE 1 – BESTANDSAUFNAHME
==================================================

Analysiere zuerst die reale GUI-Implementierung.

Untersuche mindestens:

- Hauptfenster
- Navigation
- Sidebar
- Header
- Chat-/Conversation-Bereich
- Prompt-/Input-Bereich
- Tool-Darstellung
- Thinking-Darstellung
- Statusanzeigen
- Workflow-Anzeige
- Modellanzeige
- Context-Anzeige
- Subagenten
- Plan-Modus
- Work-Modus
- Verifier
- Fehler
- Warnungen
- Notifications
- Einstellungen
- Modals
- Dropdowns
- Kontextmenüs
- Resize-Verhalten
- Scroll-Verhalten
- Streaming
- Keyboard-Navigation
- Fokusmanagement
- Loading States
- Empty States
- Error States

Zusätzlich untersuchen:

- Component-Hierarchie
- State-Management
- Design Tokens
- Themes
- Layout-System
- Responsive Breakpoints
- wiederverwendbare Komponenten
- doppelte Komponenten
- hart codierte Styles
- Magic Numbers
- übergroße Komponenten
- UI-Logik, die eigentlich Core-/Backendlogik dupliziert

==================================================
4. UI/UX-AUDIT
==================================================

Bewerte die GUI systematisch in folgenden Kategorien.

--------------------------------------------------
A. Informationshierarchie
--------------------------------------------------

Prüfen:

- Was fällt zuerst ins Auge?
- Ist das auch wirklich die wichtigste Information?
- Welche Informationen konkurrieren unnötig?
- Welche Informationen sind redundant?
- Welche Informationen sind versteckt, obwohl sie wichtig wären?
- Welche Informationen sind dauerhaft sichtbar, obwohl sie selten gebraucht werden?

Priorität sollte ungefähr sein:

PRIORITÄT 1
- Agentenaktivität
- aktuelle Antwort
- Eingabe
- Blocker / User Interaction

PRIORITÄT 2
- Tools
- Subagenten
- Workflow
- Plan/Work Status

PRIORITÄT 3
- Modell
- Kontext
- Projektinformationen

PRIORITÄT 4
- technische Detailinformationen
- Logs
- sekundäre Metadaten

--------------------------------------------------
B. Visuelle Hierarchie
--------------------------------------------------

Prüfen:

- Typografie
- Schriftgrößen
- Font Weight
- Abstände
- Gruppierung
- Borders
- Backgrounds
- Farben
- Kontrast
- Icons
- Badges
- Cards
- Separatoren

Suche insbesondere nach:

- zu vielen Boxen
- Box-in-Box-Layouts
- unnötigen Rahmen
- zu vielen Akzentfarben
- konkurrierenden Statusfarben
- übermäßigem Einsatz von Badges
- inkonsistentem Padding
- inkonsistenten Abständen
- zu viel leerem Raum
- zu dichter Informationsdarstellung

==================================================
5. INTERAKTIONS-AUDIT
==================================================

Analysiere jeden wichtigen User Flow.

Mindestens:

1. neue Aufgabe starten
2. Aufgabe fortsetzen
3. Workflow wechseln
4. Modell wechseln
5. Thinking-Level ändern
6. Agent arbeitet
7. Agent nutzt Tools
8. mehrere Tools laufen
9. Subagent startet
10. Subagent beendet Arbeit
11. Agent fragt Nutzer
12. Permission Request
13. Agent erzeugt Fehler
14. Tool erzeugt Fehler
15. Aufgabe wird abgeschlossen
16. Aufgabe wird abgebrochen
17. Nutzer startet neue Aufgabe

Für jeden Flow dokumentieren:

- Schritte
- Klicks
- notwendige Aufmerksamkeit
- unnötige Aktionen
- unklare Zustände
- fehlendes Feedback
- mögliche Fehlbedienungen
- Verbesserung

==================================================
6. AGENTENAKTIVITÄT
==================================================

Dies ist einer der wichtigsten Bereiche.

Untersuche genau, wie dargestellt werden:

- IDLE
- DENKT NACH
- ARBEITET
- ANTWORTET
- WARTET

Der Nutzer darf niemals rätseln müssen:

- arbeitet Pi noch?
- ist Pi hängen geblieben?
- wartet Pi auf ein Tool?
- wartet Pi auf mich?
- läuft ein Subagent?
- wird gerade nur eine Antwort gestreamt?

Prüfe:

- Position
- Sichtbarkeit
- Animation
- Zeitangabe
- Aktivitäts-Historie
- Statuswechsel
- mehrere parallele Aktivitäten

Statusdarstellung soll dauerhaft sichtbar, aber nicht dominant sein.

==================================================
7. TOOL-DARSTELLUNG
==================================================

Ein Coding-Agent verwendet viele Tools.

Die UI darf deshalb nicht hauptsächlich aus Tool-Logs bestehen.

Analysiere:

- wie stark Toolcalls visuell dominieren
- wie Command-Ausgaben angezeigt werden
- wie File Reads dargestellt werden
- wie Edits dargestellt werden
- wie Search dargestellt wird
- wie Fehler dargestellt werden

Entwickle eine klare Informationshierarchie:

Tool startet
→ kompakte Darstellung

Tool läuft
→ Status sichtbar

Tool erfolgreich
→ komprimierbare Zusammenfassung

Details
→ bei Bedarf aufklappbar

Logs sollten verfügbar, aber nicht permanent dominant sein.

==================================================
8. SUBAGENTEN
==================================================

Die GUI soll eine wirklich brauchbare Subagenten-Darstellung besitzen.

Analysiere den aktuellen Stand.

Ziel:

Der Nutzer soll sehen können:

- welcher Subagent läuft
- Rolle
- Modell
- Auftrag
- Status
- Dauer
- aktuelle Aktivität
- verwendete Tools
- Ergebnis
- Fehler

Wichtig:

Nicht einfach nur kleine Status-Badges anzeigen.

Prüfe, ob ein eigenes Subagenten-Panel sinnvoll ist.

Als Referenz darf die Transparenz von Claude Code dienen:

Subagent auswählen
→ kompletten Run ansehen
→ Toolcalls
→ Thinking-/Aktivitätszustand
→ Ergebnis

Dabei weiterhin klare Trennung zwischen:

Main Agent

und

Subagents

==================================================
9. CONVERSATION / TIMELINE
==================================================

Analysiere, ob ein klassischer Chat-Feed überhaupt die optimale Darstellung ist.

Coding-Agenten produzieren:

- Text
- Thinking
- Tools
- Files
- Commands
- Diffs
- Subagents
- Verification
- Fehler

Prüfe daher eine strukturierte Timeline.

Beispiel:

USER
Aufgabe

AGENT
Analysiert Projekt

TOOL
Dateien gelesen

AGENT
Ändert Implementation

FILES
3 Dateien geändert

VERIFIER
Tests erfolgreich

AGENT
Finale Zusammenfassung

Prüfe, ob diese Struktur gegenüber einem normalen Chat-Feed Vorteile bietet.

==================================================
10. INPUT / COMPOSER
==================================================

Analysiere den Prompt-Bereich.

Prüfen:

- Höhe
- Fokus
- Multiline
- Keyboard Handling
- Submit
- Stop
- Attachments
- Workflow
- Modell
- Thinking Level
- Context
- Command Mode

Der Composer sollte das zentrale Interaktionselement sein.

Vermeide jedoch:

- 10 Buttons direkt am Eingabefeld
- mehrere Dropdown-Zeilen
- permanente technische Optionen

Häufig verwendete Funktionen sichtbar.

Selten verwendete Funktionen sekundär.

==================================================
11. SIDEBAR / NAVIGATION
==================================================

Prüfe, ob die aktuelle Navigation tatsächlich sinnvoll strukturiert ist.

Mögliche Hauptbereiche könnten sein:

- Sessions
- Projekt
- Agenten
- Changes
- Verlauf

Aber NICHT automatisch übernehmen.

Ermittle anhand der tatsächlichen Features, welche Informationsarchitektur sinnvoll ist.

Prüfe insbesondere:

- Navigationstiefe
- Doppelfunktionen
- versteckte Funktionen
- unnötige Seitenwechsel
- verlorenen Kontext beim Wechsel

==================================================
12. CHANGES / CODE ÄNDERUNGEN
==================================================

Für einen Coding-Agenten ist dies zentral.

Analysiere:

- Darstellung geänderter Dateien
- Diffs
- neue Dateien
- gelöschte Dateien
- uncommitted changes
- Verifier-Ergebnisse

Prüfe, ob ein dauerhaft erreichbares:

CHANGES

Panel sinnvoll ist.

Es sollte möglich sein, während des Runs schnell zu erkennen:

Modified 5

+142
-37

und Details auf Wunsch zu öffnen.

==================================================
13. PLAN / WORKFLOW
==================================================

Analysiere UX und Darstellung des Plan-Modus.

Prüfe:

- aktueller Plan
- Planfortschritt
- abgeschlossene Schritte
- aktueller Schritt
- Änderungen am Plan
- Übergang Plan → Work
- Verification

Der Nutzer sollte nicht in Chat-Nachrichten suchen müssen, um den aktuellen Plan zu verstehen.

Falls sinnvoll:

eigenes Plan-Panel oder Task-Panel entwickeln.

Aber nur, wenn es einen klaren Mehrwert bietet.

==================================================
14. CONTEXT
==================================================

Prüfe Darstellung des Kontextverbrauchs.

Nicht nur:

42 %

sondern überlegen, welche Information wirklich hilfreich ist.

Beispielsweise:

Context
42 %

oder bei kritischem Bereich:

Context
82 %
Compaction soon

Warnungen nur dann anzeigen, wenn tatsächlich relevant.

Keine permanente Alarmwirkung.

==================================================
15. RESPONSIVE DESIGN
==================================================

Teste mindestens:

- 1280×720
- 1366×768
- 1440×900
- 1920×1080
- 2560×1440

Zusätzlich:

- maximiert
- kleines Fenster
- sehr schmales Fenster
- sehr breites Fenster

Prüfe:

- Overflows
- horizontales Scrollen
- abgeschnittene Inhalte
- Modals
- Sidebar
- Composer
- Timeline
- Panels
- lange Dateinamen
- lange Modellnamen
- lange Prompts

==================================================
16. KEYBOARD UX
==================================================

Da Pi stark aus einer CLI-/Power-User-Welt kommt, darf die GUI nicht vollständig mauszentriert werden.

Prüfe:

- Tab Navigation
- Focus Order
- Escape
- Enter
- Shift+Enter
- Shortcut-System
- Command Palette
- Focus Input
- Stop Agent
- Workflow Wechsel
- Modellwechsel

Bestehende sinnvolle Shortcuts erhalten.

Neue Shortcuts nur dort, wo sie echten Nutzen bringen.

==================================================
17. ACCESSIBILITY
==================================================

Mindestens prüfen:

- Farbkontrast
- Fokusindikatoren
- Keyboard Navigation
- Icon-only Buttons
- Tooltip-Unterstützung
- Screenreader Labels
- Dialog-Fokus
- reduzierte Animationen

Nicht versuchen, eine vollständige Accessibility-Zertifizierung daraus zu machen.

Aber offensichtliche Fehler beheben.

==================================================
18. DESIGN SYSTEM
==================================================

Prüfe, ob ein konsistentes Designsystem existiert.

Falls nicht, konsolidiere:

Design Tokens:

- background
- surface
- surfaceRaised
- border
- borderMuted
- textPrimary
- textSecondary
- textMuted
- accent
- accentSecondary
- success
- warning
- error

Spacing:

4
8
12
16
24
32

Border Radius

Typografie

Button Variants

Input Variants

Cards

Panels

Tool States

Agent States

Keine unkontrollierten komponentenspezifischen Styles.

==================================================
19. FARBWELT
==================================================

Die GUI soll visuell zur überarbeiteten warmen Aurora-TUI passen.

Richtung:

- dunkles neutrales Anthrazit
- warme Schwarztöne
- Espresso
- Burgundy
- Terracotta
- Copper
- Amber
- Beige
- warmes Off-White

Vermeiden:

- Neon
- grelles Orange
- starkes Cyberpunk-Cyan
- zu viel Violett
- RGB-Gaming-Look
- zu viele Statusfarben

Die GUI und TUI sollen zur gleichen Produktfamilie gehören.

Nicht zwingend pixelgleich.

==================================================
20. MICRO-INTERACTIONS
==================================================

Animationen nur dort verwenden, wo sie Status kommunizieren.

Sinnvoll:

- laufender Agent
- Tool Running
- Streaming
- Panel Transition
- Progress

Nicht sinnvoll:

- dauernd pulsierende Buttons
- Glow Effekte
- springende Cards
- unnötige Hover-Animationen

Animationen:

subtil
ruhig
kurz
funktional

==================================================
21. VERGLEICH MIT ANDEREN TOOLS
==================================================

Vergleiche gezielt UX-Lösungen aktueller Coding-Agenten und IDEs.

Mindestens betrachten:

- Cursor
- Claude Code
- Codex
- VS Code
- JetBrains
- moderne Agent GUIs

Nicht fragen:

„Wie sieht Cursor aus?"

Sondern:

„Welches konkrete UX-Problem löst Cursor hier besser?"

Beispiele:

- Diff Navigation
- Tool Activity
- Context
- Task Progress
- Plan
- Command Palette
- Sidebar
- Composer
- Agent State

Nur Lösungen übernehmen, deren Nutzen klar ist.

==================================================
22. PROBLEMKATALOG
==================================================

Erstelle vor der Implementierung einen strukturierten Befund.

Format:

ID
Bereich
Problem
Auswirkung
Ursache
Priorität
Lösung
Komplexität

Priorität:

P0
funktionaler UX-Fehler

P1
stark störend

P2
deutliche Verbesserung

P3
Polish

Komplexität:

S
M
L
XL

==================================================
23. NUTZEN / KOMPLEXITÄT
==================================================

Bewerte jede größere vorgeschlagene Änderung.

Beispiel:

Subagent Detail Panel

Nutzen:
hoch

Komplexität:
mittel

Empfehlung:
umsetzen

Oder:

komplettes Docking-System wie VS Code

Nutzen:
mittel

Komplexität:
sehr hoch

Empfehlung:
nicht umsetzen

Vermeide Architektur- und UI-Overengineering.

==================================================
24. UMSETZUNGSPLAN
==================================================

Nach dem Audit einen priorisierten Plan erstellen.

Bevorzugte Reihenfolge:

Phase 1
P0 Rendering-/UX-Fehler

Phase 2
Informationshierarchie

Phase 3
Conversation/Timeline

Phase 4
Tool-Darstellung

Phase 5
Subagent UX

Phase 6
Plan/Workflow UX

Phase 7
Composer

Phase 8
Navigation

Phase 9
Design System

Phase 10
Responsive / Keyboard / Accessibility

Phase 11
Polish

==================================================
25. IMPLEMENTIERUNG
==================================================

Nach der Analyse direkt mit der Umsetzung beginnen.

Dabei kleine, nachvollziehbare Änderungen bevorzugen.

Nach größeren Änderungen:

- Build
- Typecheck
- relevante Tests
- UI prüfen

Keine riesige Redesign-Änderung ohne Zwischenverifikation.

Bestehende Architektur nur umbauen, wenn sie die UI-Verbesserungen tatsächlich behindert.

==================================================
26. TESTS
==================================================

Mindestens testen:

Start
Idle
User Prompt
Thinking
Tool
mehrere Tools
Streaming
Subagent
Plan
Work
Verifier
User Question
Permission
Error
Stop
Completed

Zusätzlich:

Resize
Scroll
Keyboard
lange Sessions
lange Paths
lange Dateinamen
lange Modellnamen
viele Toolcalls

Wenn sinnvoll:

Component Tests
Visual Regression Tests
E2E Tests

ergänzen.

Aber keine unverhältnismäßige Testinfrastruktur bauen.

==================================================
27. ABSCHLUSSKRITERIEN
==================================================

Die Arbeit gilt erst als abgeschlossen, wenn:

[ ] alle P0-Probleme behoben sind
[ ] wesentliche P1-Probleme behoben sind
[ ] Informationshierarchie klar ist
[ ] Agentenstatus jederzeit verständlich ist
[ ] Toolcalls die Oberfläche nicht dominieren
[ ] Subagenten nachvollziehbar sind
[ ] Planstatus leicht erreichbar ist
[ ] Composer sauber funktioniert
[ ] Navigation konsistent ist
[ ] Responsive Layout stabil ist
[ ] Keyboard-Nutzung funktioniert
[ ] Farb- und Designsystem konsistent ist
[ ] GUI und TUI visuell zur gleichen Produktfamilie gehören
[ ] keine unnötige Architekturkomplexität hinzugekommen ist
[ ] bestehende Kernfunktionen weiterhin funktionieren
[ ] Build und Tests erfolgreich sind

==================================================
28. ABSCHLUSSBERICHT
==================================================

Am Ende liefern:

1. Executive Summary

2. Gefundene Probleme
   - P0
   - P1
   - P2
   - P3

3. Wichtigste UX-Schwächen vorher

4. Umgesetzte Änderungen

5. Veränderte Informationsarchitektur

6. Design-System-Änderungen

7. Änderungen bei:
   - Agent Status
   - Tools
   - Subagents
   - Plan
   - Composer
   - Navigation
   - Changes

8. Tests

9. Screenshots:
   - vorher
   - nachher

10. Bekannte Restprobleme

11. Nicht umgesetzte Ideen inklusive Begründung

12. Empfohlene nächste Schritte

==================================================
29. WICHTIGE ARBEITSREGEL
==================================================

Behandle die aktuelle GUI nicht als Design, das lediglich etwas hübscher gemacht werden muss.

Hinterfrage:

- Struktur
- Prioritäten
- Interaktionen
- Informationsdichte
- Navigation
- Zustände
- Feedback
- Redundanzen

Wenn ein bestehendes UI-Konzept schlecht ist, soll es nicht nur neu gestylt werden.

Ändere es.

Wenn ein bestehendes Konzept gut funktioniert, behalte es und verbessere nur die Ausführung.

Ziel ist eine spürbar bessere tägliche Arbeit mit Pi und keine reine optische Modernisierung.
