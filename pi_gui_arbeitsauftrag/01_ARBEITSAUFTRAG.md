# Master-Arbeitsauftrag – Pi Desktop GUI

## Ziel

Erweitere `daydaylx/pi` um eine echte Desktop-GUI, die über `pi gui` gestartet werden kann.

Der bestehende Pi-Unterbau muss erhalten bleiben. Die GUI ist ein zusätzlicher Presentation Layer und darf keine zweite fachliche Agentenimplementierung erzeugen.

## Zielbild

```text
                        Pi Core / Runtime
                               │
             Commands / State / Events / Sessions
                               │
                  ┌────────────┴────────────┐
                  │                         │
              Aurora TUI               Desktop GUI
                  │                         │
                 pi                      pi gui
                                            │
                                      Electron/React
```

## Kernanforderungen

Die GUI muss langfristig folgende Fähigkeiten abbilden können:

- Chat mit Streaming
- strukturierte Tool-Darstellung
- Task-/Workflow-Status
- Changes/Diffs
- Verification
- Subagenten/Investigator
- Modell
- Thinking/Effort
- Context
- Permissions
- Sessions
- File Tree
- integriertes Terminal
- Projekt-/Workspace-Auswahl
- bestehende Menülogik
- bestehende Shortcuts soweit technisch sinnvoll

## Architekturprinzip

> Core owns behavior. Frontend owns presentation.

Der Core entscheidet:

- welcher Workflow aktiv ist,
- welches Modell aktiv ist,
- welches Thinking/Effort gilt,
- welche Permission gilt,
- wann Verification nötig/erfüllt/fehlgeschlagen ist,
- welcher Subagent aktiv ist,
- welche Session aktiv ist,
- welche Tools laufen,
- welche fachlichen Zustände gültig sind.

Die GUI entscheidet nur:

- wie diese Zustände angeordnet werden,
- wie sie visualisiert werden,
- welche Panels sichtbar sind,
- wie Tool-Aktivität komprimiert wird,
- wie Modal/Sidebar/Tab/Tooltip aussehen,
- welche Mausinteraktion zusätzlich angeboten wird.

## Vorgehensweise

Arbeite strikt phasenweise.

### Phase 0
Baseline des bestehenden Pi erfassen.

### Phase 1
Vorhandene GUI-Projekte gegen die Anforderungen auditieren und einen Kandidaten auswählen.

### Phase 2
Frontend-Protokoll und semantische Commands/States definieren.

### Phase 3
Minimal funktionierende GUI anbinden.

### Phase 4
Shortcut- und Menü-Parität herstellen.

### Phase 5
Pi-spezifische Kernzustände integrieren.

### Phase 6
GUI-UX gezielt neu gestalten.

### Phase 7
Hardening, Packaging, Regressionen und Sicherheit.

### Phase 8
Nutzungsentscheidung: parallel beibehalten, GUI bevorzugen oder Projekt stoppen.

## Stop-Gates

Nach jeder Phase:

1. Tests ausführen.
2. Abschlusskriterien abhaken.
3. Regressionen dokumentieren.
4. Änderungen zusammenfassen.
5. offenen technischen Schuldenstand nennen.
6. explizit stoppen.
7. Freigabe des Nutzers abwarten.

## Verbot

Der Agent darf keine Phase automatisch "mitnehmen", auch wenn sie klein erscheint.

Der Agent darf keine Freigabe simulieren oder voraussetzen.

## Erwartete Arbeitsweise

- kleine, überprüfbare Änderungen,
- keine Big-Bang-Migration,
- keine Core-Rewrites ohne zwingenden Grund,
- vorhandene Pi-Schnittstellen bevorzugen,
- zuerst messen, dann umbauen,
- fachlichen State aus dem UI herauslösen statt doppeln,
- Rollback jederzeit ermöglichen.

## Erfolgskriterium Gesamtprojekt

Das Projekt gilt nur dann als erfolgreich, wenn:

1. `pi` weiterhin funktioniert,
2. `pi gui` zusätzlich funktioniert,
3. gleiche fachliche Aktionen in TUI und GUI zu gleichen Core-Zuständen führen,
4. zentrale Shortcuts/Commands in beiden Frontends konsistent bleiben,
5. keine zweite Workflow-/Verification-/Permission-Logik entsteht,
6. die GUI einen klaren UX-Gewinn gegenüber Aurora liefert,
7. der Nutzer nach realer Nutzung explizit entscheidet, ob die GUI dauerhaft beibehalten wird.
