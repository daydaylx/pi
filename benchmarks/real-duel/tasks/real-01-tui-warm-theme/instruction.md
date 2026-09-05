Überarbeite die CLI/TUI-Oberfläche des Pi-Setups grundlegend hinsichtlich Darstellung, Layout, Lesbarkeit und visueller Qualität.

Es gibt aktuell sichtbare Darstellungsfehler und Inkonsistenzen. Zusätzlich soll die bisher eher kühle Farbwelt durch ein hochwertiges warmes Farbsystem ersetzt werden.

Wichtig:
Nicht einfach einzelne CSS-/ANSI-Farben oder Abstände kosmetisch ändern. Zuerst die vorhandene TUI-Struktur, Rendering-Pfade und Layout-Berechnungen analysieren, systematisch Fehler finden und anschließend die Oberfläche als zusammenhängendes UI-System verbessern.

Die funktionale Agenten-/Workflow-Logik darf dabei nicht verändert werden.

==================================================
1. ZIELE
==================================================

Die überarbeitete TUI soll:

- sichtbar hochwertiger und ruhiger wirken
- eine warme statt kalte Farbwelt verwenden
- klare visuelle Hierarchien besitzen
- weniger nach zusammengebauten Einzelkomponenten wirken
- Status, Eingabe, Workflow und Agentenaktivität sofort verständlich darstellen
- bei verschiedenen Terminalgrößen stabil funktionieren
- keine abgeschnittenen, überlagerten oder verrutschten Elemente enthalten
- Informationen sinnvoll priorisieren
- weiterhin kompakt genug für produktive CLI-Arbeit bleiben

Die Verbesserung soll nicht nur den aktuellen Screenshot reparieren, sondern die zugrunde liegenden Ursachen im Layout- und Rendering-System beheben.

==================================================
2. NICHT-ZIELE
==================================================

Nicht Bestandteil dieser Aufgabe:

- Agentenlogik ändern
- Workflow-Semantik ändern
- Plan-/Work-Modus funktional umbauen
- Modelle oder Provider ändern
- Permission-System fachlich verändern
- GUI/Electron-Oberfläche bearbeiten
- neue Hintergrundprozesse einführen
- bestehende Shortcuts unnötig ändern
- Feature-Redesign außerhalb der TUI

Vorhandene Bedienkonzepte wie Shift+Tab, Super+M, Super+D, Super+Q, Super+S usw. müssen erhalten bleiben, solange kein technischer Fehler darin gefunden wird.

==================================================
3. AUSGANGSLAGE / SICHTBARE PROBLEME
==================================================

Der bereitgestellte Screenshot zeigt bereits mehrere Auffälligkeiten.

Diese sind jedoch nur Beispiele und dürfen NICHT als vollständige Fehlerliste behandelt werden.

Auffällig sind unter anderem:

1. Das zentrale Status-/Informationspanel wirkt geometrisch nicht sauber.
   - Hintergrundflächen und Rahmen scheinen teilweise nicht dieselben Grenzen zu verwenden.
   - Der Shortcut-Bereich wirkt rechts bzw. unten unsauber abgeschlossen.
   - Einzelne Hintergrundsegmente wirken wie überlagerte Blöcke.
   - Abstände zwischen Text, Badges und Rahmen sind inkonsistent.

2. Shortcut-Zeile:
   - wirkt zusammengedrückt
   - unterschiedliche Breiten und Padding
   - teilweise unruhige Gruppierung
   - einzelne Segmente wirken optisch abgeschnitten oder überlagert
   - Hierarchie zwischen Shortcut und Beschreibung ist schwach

3. Informationspanel:
   - Werte und Labels besitzen teilweise unklare visuelle Gewichtung
   - Modell, Workflow, Denken und Ordner sind nicht optimal strukturiert
   - sehr langer Ordnerpfad kann zukünftig Layoutprobleme verursachen
   - Panelbreite scheint relativ starr

4. Update-Hinweis:
   - nimmt sehr viel horizontale Aufmerksamkeit ein
   - steht visuell auf fast derselben Prioritätsstufe wie die eigentliche Arbeitsoberfläche
   - sollte deutlich sekundärer dargestellt werden

5. Extension-Warnung:
   - technisch sinnvoll, visuell aber sehr dominant
   - Error-/Warning-Ausgaben sollten klar erkennbar sein, ohne das gesamte Interface zu dominieren

6. „Work aktiv.":
   - wirkt isoliert
   - schwache Verbindung zum eigentlichen Aktivitätsstatus
   - Position und Zweck sollten überprüft werden

7. Eingabebereich:
   - Trennlinien wirken aktuell sehr dominant
   - Cursor/Input-Bereich besitzt wenig visuelle Struktur
   - starke horizontale Linien zerlegen die Oberfläche unnötig

8. untere Statusleiste:
   - grundsätzlich nützlich, aber visuell uneinheitlich
   - unterschiedliche Farben, Typografie und Abstände
   - Informationen konkurrieren miteinander
   - Pfad und Kontextanzeige sollten sekundärer sein als Workflow/Modell/Aktivität

9. Gesamtlayout:
   - sehr große ungenutzte Flächen
   - Komponenten wirken teilweise voneinander unabhängig
   - zentrale Card + obere Meldungen + Input + Bottom Bar ergeben noch keine konsistente Oberfläche

10. Farbwelt:
   - derzeit starke Blau-/Cyan-/Violett-Ausrichtung
   - soll komplett in eine warme, professionelle Farbwelt überführt werden

==================================================
4. PHASE A – CODE-FIRST UI-AUDIT
==================================================

Bevor Änderungen vorgenommen werden:

Analysiere alle für die TUI relevanten Dateien und dokumentiere:

- Render-Komponenten
- Layout-Komponenten
- Theme-/Color-System
- Style-Definitionen
- Border-/Box-Rendering
- Width-/Height-Berechnungen
- Text-Truncation
- Padding/Margin-Logik
- Terminal-Resize-Verhalten
- ANSI-/Unicode-Breitenberechnung
- Shortcut-Komponenten
- Statusbar
- Input-Bereich
- Activity Indicator
- Update-/Notification-Banner
- Extension-Warnings
- Subagent-Anzeigen
- Plan-/Work-Anzeigen
- Tool-Ausgaben
- Thinking-Anzeigen
- Streaming-Antworten

Insbesondere suchen nach:

- hart codierten Breiten
- hart codierten Positionen
- mehrfach implementierten Farbsystemen
- mehrfach implementierten Box-/Border-Systemen
- inkonsistentem Padding
- falscher String-Length-Berechnung bei ANSI/Unicode
- Komponenten, die Terminalbreite nicht berücksichtigen
- Rendering-Code, der direkt ANSI-Sequenzen statt zentraler Theme-Tokens verwendet
- Komponenten mit eigenem, abweichendem Responsive-Verhalten
- überlappenden Layern
- unnötigem Re-Rendering
- Resten alter UI-Versionen
- Dead Code
- doppelten Statusanzeigen
- Inkonsistenzen zwischen Idle / Denken / Arbeiten / Antworten / Warten

Erstelle danach zunächst einen kurzen Befund mit:

Problem
Ursache
betroffene Datei/Komponente
Auswirkung
Priorität
empfohlene Änderung

Priorität:
P0 = sichtbarer oder funktionaler Renderingfehler
P1 = deutliche UX-/Layout-Schwäche
P2 = Konsistenz/Polish
P3 = optional

==================================================
5. PHASE B – RESPONSIVE TUI TESTEN
==================================================

Teste die aktuelle Oberfläche systematisch bei mindestens:

- 80 Spalten
- 100 Spalten
- 120 Spalten
- 160 Spalten
- 200+ Spalten

sowie unterschiedlichen Terminalhöhen.

Zusätzlich testen:

- sehr langer Projektpfad
- sehr langer Modellname
- lange Tool-Namen
- mehrere Warnungen gleichzeitig
- Update-Hinweis vorhanden/nicht vorhanden
- aktiver Subagent
- Thinking aktiv
- Tool aktiv
- Streaming-Antwort
- Waiting-Zustand
- Plan-Modus
- Work-Modus
- hoher Kontextverbrauch
- 100 % Kontextanzeige
- Terminal-Resize während eines Agentenlaufs

Wenn automatisierte Snapshot-/Golden-Tests sinnvoll integrierbar sind, diese bevorzugen.

Nicht für jede Kleinigkeit ein komplexes Testing-Framework bauen.
Nutzen und Wartungsaufwand müssen sinnvoll bleiben.

==================================================
6. PHASE C – NEUES WARMES THEME
==================================================

Ersetze die aktuelle primär kalte Cyan-/Blau-/Violett-Farbwelt durch ein warmes Theme.

Gewünschte Richtung:

- dunkler neutral-warmer Hintergrund
- Anthrazit
- warmes Schwarz
- Espresso-/Brauntöne
- dunkles Burgundy
- Terracotta
- Copper
- Amber
- warmes Beige / Creme für Text

Nicht erwünscht:

- grelles Orange
- Neonrot
- aggressive Gelbtöne
- Retro-Terminal-Look
- „Cyberpunk Orange"
- zu viele gleichzeitig aktive Akzentfarben

Das Ergebnis soll modern, technisch und hochwertig aussehen.

Beispielhafte semantische Farbrichtung:

Primary Accent:
Amber / Copper

Secondary Accent:
Terracotta / gedämpftes Burgundy

Primary Text:
warmes Off-White

Secondary Text:
Beige-Grau

Muted:
warmes Grau

Success:
gedämpftes warmes Grün

Warning:
Amber/Ocker

Error:
gedämpftes Rot

Thinking:
Copper/Amber

Working:
Terracotta

Responding:
helleres warmes Creme/Amber

Waiting:
dezentes warmes Grau

Wichtig:
Keine Farben direkt nach Komponenten benennen.

Stattdessen semantische Theme-Tokens verwenden, beispielsweise:

background
surface
surfaceRaised
border
borderMuted
textPrimary
textSecondary
textMuted
accent
accentSecondary
statusThinking
statusWorking
statusResponding
statusWaiting
success
warning
error

Alle TUI-Komponenten sollen möglichst dieselben Tokens verwenden.

Kontrast und Lesbarkeit müssen wichtiger sein als ästhetische Feinheiten.

==================================================
7. PHASE D – VISUELLE HIERARCHIE ÜBERARBEITEN
==================================================

Die Oberfläche soll zukünftig ungefähr diese Priorisierung besitzen:

PRIORITÄT 1
Aktueller Agentenzustand
Eingabe
Antwort / Tool-Aktivität

PRIORITÄT 2
Workflow
Modell
Thinking-Level
Subagenten

PRIORITÄT 3
Projektpfad
Kontextverbrauch
Shortcuts

PRIORITÄT 4
Updateinformationen
Extensions
sekundäre Hinweise

Aktuell konkurrieren mehrere dieser Ebenen miteinander.

Das muss korrigiert werden.

==================================================
8. ZENTRALES INFO-PANEL
==================================================

Das aktuelle Panel mit:

PI · AURORA
WORKFLOW
MODELL
DENKEN
ORDNER
Shortcuts

grundsätzlich behalten, aber deutlich überarbeiten.

Ziele:

- saubere Box-Geometrie
- kein Überlaufen
- konsistentes Padding
- dynamische Breite
- Maximalbreite definieren
- lange Pfade sinnvoll kürzen
- Werte besser hervorheben
- Labels etwas zurücknehmen
- Shortcut-Sektion klar absetzen
- keine überlappenden Hintergründe
- keine unterschiedlichen Boxbreiten innerhalb derselben Card

Prüfe zusätzlich, ob permanent alle Informationen angezeigt werden müssen.

Bevorzugt:
weniger visuelle Elemente, aber keine Entfernung nützlicher Funktionen.

==================================================
9. SHORTCUT-DARSTELLUNG
==================================================

Die Shortcut-Anzeige neu strukturieren.

Aktuell wirken einzelne Tasten und Beschreibungen wie unabhängig aneinandergereihte Badges.

Ziel:

[Shift+Tab] Workflow
[Super+M] Modell
[Super+D] Denken
[Super+Q] Befehle
[Super+S] Rollen

aber:

- gleiche Höhe
- konsistentes Padding
- gleiche Baseline
- sauberer Abstand
- responsives Wrapping
- kein Abschneiden
- Shortcut stärker als Beschreibung
- Beschreibung sekundärer
- bei kleiner Terminalbreite mehrere Zeilen verwenden

Keine horizontale Überfüllung erzwingen.

==================================================
10. BOTTOM STATUS BAR
==================================================

Die Statusleiste überarbeiten.

Informationen weiterhin anzeigen:

Workflow
Modell
Thinking-Level
Projektpfad
Kontext

aber visuell klar gruppieren.

Bevorzugte Reihenfolge:

WORK | Modell | Denken HOCH | Projekt | Kontext

Dabei:

- primären Status stärker hervorheben
- sekundäre Daten abschwächen
- Trennzeichen vereinheitlichen
- Kontextwert nicht dominieren lassen
- lange Pfade kürzen
- keine unnötig unterschiedlichen Hintergrundfarben verwenden

Prüfen, ob Statusbar und zentrales Informationspanel aktuell unnötig dieselben Informationen doppelt darstellen.

Falls ja:
Doppelung bewusst reduzieren, ohne Informationsverlust.

==================================================
11. INPUT-BEREICH
==================================================

Den Prompt-/Input-Bereich deutlich hochwertiger gestalten.

Aktuell bestehen starke horizontale Linien und sehr wenig visuelle Struktur.

Ziel:

- klar erkennbarer Eingabebereich
- weniger dominante Separatoren
- Cursor gut sichtbar
- ausreichend, aber nicht übermäßiges Padding
- Fokuszustand erkennen
- optional sehr dezente Kennzeichnung des aktiven Modus
- keine unnötige Box-in-Box-Struktur

Der Eingabebereich soll der natürliche visuelle Fokus sein, wenn der Agent idle ist.

==================================================
12. AGENTENAKTIVITÄT
==================================================

Prüfe die gesamte Darstellung von:

DENKT NACH
ARBEITET
ANTWORTET
WARTET
IDLE

Die Statusanzeige soll:

- immer eindeutig sein
- nicht mehrfach an verschiedenen Stellen widersprüchlich erscheinen
- während langer Aktionen sichtbar bleiben
- nicht hektisch animieren
- keine falschen „hängend"-Zustände erzeugen
- Dauer sinnvoll darstellen, falls bereits unterstützt

Animationen nur subtil einsetzen.

==================================================
13. NOTIFICATIONS / UPDATE / WARNINGS
==================================================

Entwickle eine gemeinsame visuelle Sprache für:

INFO
SUCCESS
WARNING
ERROR
UPDATE

Aktuelle Hinweise wie:

Update Available
Extension issues

sollen nicht wie komplett eigene UI-Systeme aussehen.

Sie sollen:

- gleiche Abstandslogik verwenden
- semantische Farben verwenden
- klar unterscheidbar sein
- weniger vertikalen Raum verbrauchen
- bei mehreren Meldungen kontrolliert dargestellt werden
- lange Inhalte umbrechen
- Terminalbreite respektieren

==================================================
14. TOOL- UND AGENTENAUSGABEN
==================================================

Analysiere auch die eigentliche Nutzung während längerer Agentenläufe.

Besonders prüfen:

- Verhältnis zwischen Tool-Ausgaben und Agentenantwort
- visuelle Dominanz von Toolcalls
- verschachtelte Tools
- Subagenten-Ausgaben
- lange Logs
- Fehlerausgaben
- Diff-Anzeigen
- Command-Ausgaben
- Verifier-Ausgaben

Die Oberfläche darf während eines echten Runs nicht wieder in einen normalen, unstrukturierten Terminal-Log zerfallen.

Tool-Aktivität klar sichtbar machen, aber Details visuell sekundär halten.

==================================================
15. ARCHITEKTUR
==================================================

Bevorzugte Zielarchitektur:

Theme
  ↓
Primitive UI Components
  ↓
Layout Components
  ↓
Feature Components

Beispielsweise:

theme/
primitives/
  Box
  Badge
  Divider
  LabelValue
  Notification
  Status
layout/
features/

Nicht blind neue Abstraktionen erstellen.

Bestehende brauchbare Systeme weiterverwenden.

Neue Komponenten nur dort einführen, wo dadurch:

- Duplikation reduziert wird
- Renderingfehler verhindert werden
- Responsive-Verhalten vereinheitlicht wird
- Theme-Konsistenz entsteht

==================================================
16. TECHNISCHE QUALITÄTSREGELN
==================================================

Keine kosmetischen Hacks wie:

- zusätzliche Leerzeichen zur Ausrichtung
- manuelle ANSI-Längenannahmen
- komponentenspezifische Magic Numbers
- Sonderfälle nur für den Screenshot
- fixe Terminalbreiten
- versteckte Overflow-Crops zur Fehlerkaschierung

Breitenberechnung muss ANSI- und Unicode-sicher sein.

Layout muss deterministisch sein.

Bei unbekannter Breite lieber sauber umbrechen oder kürzen als Elemente überlappen lassen.

==================================================
17. REFERENZRICHTUNG
==================================================

Nicht versuchen, eine GUI in ein Terminal zu kopieren.

Orientierung:

- moderne Coding-Agent-CLI
- klare Informationshierarchie
- Cursor/Codex/Claude-Code-artige Ruhe und Struktur
- aber eigenständige Pi/Aurora-Identität

Weniger visuelles Rauschen.

Mehr Struktur durch:

- Abstand
- Gewichtung
- Typografie
- gezielte Farbe

und weniger durch:

- viele Rahmen
- viele Hintergrundblöcke
- viele Separatoren

==================================================
18. IMPLEMENTIERUNGSREIHENFOLGE
==================================================

Arbeite in dieser Reihenfolge:

1. bestehende Renderingarchitektur analysieren
2. reproduzierbare Renderingfehler dokumentieren
3. Layout-/Width-Ursachen beheben
4. Theme-System konsolidieren
5. warmes Theme einführen
6. zentrale UI-Primitives vereinheitlichen
7. Info-Panel überarbeiten
8. Shortcut-Darstellung reparieren
9. Input-Bereich verbessern
10. Statusbar verbessern
11. Notifications vereinheitlichen
12. Activity States überprüfen
13. Tool-/Subagent-Ausgaben überprüfen
14. Responsive Verhalten testen
15. Snapshot-/Regression-Tests ergänzen
16. Dead Code und alte Styles entfernen
17. abschließenden visuellen Audit durchführen

==================================================
19. VERIFIKATION
==================================================

Nach der Umsetzung mindestens durchführen:

- Typecheck
- Lint
- vorhandene Tests
- relevante TUI-Tests
- manuelle Starttests
- mehrere Terminalbreiten
- Terminal Resize
- Idle
- Thinking
- Tool Call
- Streaming
- Subagent
- Error
- Warning
- Update Banner
- Work-Modus
- Plan-Modus

Falls möglich zusätzlich automatisierte Screenshots/Snapshots der wichtigsten Zustände erzeugen.

Besonders in WezTerm prüfen, da dort die reale Nutzung stattfindet.

==================================================
20. ABSCHLUSSKRITERIEN
==================================================

Die Aufgabe ist erst abgeschlossen, wenn:

[ ] keine bekannten Überlagerungen mehr vorhanden sind
[ ] keine Boxen abgeschnitten werden
[ ] Shortcut-Bereich responsiv funktioniert
[ ] lange Pfade das Layout nicht zerstören
[ ] Resize stabil funktioniert
[ ] ANSI-/Unicode-Breiten korrekt behandelt werden
[ ] ein zentral definiertes warmes Theme verwendet wird
[ ] keine relevanten Komponenten alte Hardcoded-Cyan/Violett-Farben verwenden
[ ] Input visuell klar priorisiert ist
[ ] Bottom Bar konsistent aufgebaut ist
[ ] Notifications ein gemeinsames System verwenden
[ ] Aktivitätszustände eindeutig bleiben
[ ] Tool-Ausgaben die Oberfläche nicht dominieren
[ ] Plan und Work weiterhin korrekt funktionieren
[ ] bestehende Shortcuts erhalten bleiben
[ ] funktionale Agentenlogik unverändert bleibt
[ ] Tests erfolgreich sind
[ ] keine neuen offensichtlichen UI-Regressions entstanden sind

==================================================
21. ERWARTETER ABSCHLUSSBERICHT
==================================================

Am Ende liefern:

1. Gefundene UI-/Renderingprobleme
2. jeweilige Ursachen
3. vorgenommene Änderungen
4. neue Theme-Struktur
5. entfernte Altlasten/Duplikate
6. getestete Terminalgrößen
7. durchgeführte Tests
8. verbleibende bekannte Schwächen
9. Vorher-/Nachher-Screenshots der wichtigsten Zustände
10. Liste der geänderten Dateien
11. Einschätzung, welche weiteren UI-Verbesserungen sinnvoll wären

WICHTIG:
Nicht nur den bereitgestellten Screenshot pixelgenau „reparieren".

Der Screenshot ist der Auslöser für einen vollständigen TUI-Qualitätsaudit.

Suche aktiv nach weiteren Darstellungsfehlern und strukturellen Ursachen und behebe diese, soweit dies ohne unnötige Architekturkomplexität möglich ist.
