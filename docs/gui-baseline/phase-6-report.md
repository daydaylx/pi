# Phase 6 — GUI-UX bewusst neu gestalten

Status: **ABGESCHLOSSEN** (implementiert und verifiziert; manuelle
Sichtprüfung an einem realen Desktop steht weiter aus).

## Ziel (Dokument 11)

Weg vom CLI-Gefühl: Chat ist Hauptfläche, Tool-Aktivität sekundär,
wichtige Zustände sichtbar aber nicht dominant, keine Informationswand,
wenige permanente Flächen, Details auf Abruf, Keyboard-first und Maus
gleichwertig, responsive.

## Umsetzung

### Layout (3 Spalten)

- **Kopfleiste**: Pi · Projekt (cwd-Basename) · Workflow- und
  Permission-Chips · Status-Punkt/-Text · Modell · Denken · Aktionen
  (Modell, Denken, Befehle, Neu).
- **Navigation** (links, permanent): Chat, Änderungen, Agenten,
  Verifikation, Sitzungen. Jede Zeile öffnet ein fokussiertes
  Detail-Panel im Kontextbereich; `Chat` schließt es. Buttons sind per
  Maus und Tastatur (Tab+Enter) bedienbar.
- **Conversation** (Mitte, Hauptfläche): Chat-Verlauf, Banner, Composer.
- **Kontext** (rechts, permanent aber kompakt): Übersicht aus
  Core-State — Aufgabe, Workflow, Verifikation (mit Status-Pill),
  Änderungen, Agenten, Kontext, Modell, letzte Meldungen. Jede
  zustandsbehaftete Zeile öffnet das zugehörige Detail-Panel; Details
  gibt es nur auf Abruf.

Kein dauerhaftes Dashboard: genau zwei schmale permanente Randflächen,
eine Hauptfläche.

### Tool-UX: kompakte Aktivitätszeilen

- Werkzeugaufrufe zwischen zwei Nachrichten werden zu **einer**
  Aktivitätszeile verdichtet: `✓ 8 Reads · ● 1 Shell · ✗ 1 Edits`.
- Verdichtung liegt in `gui/renderer/activity-summary.js` (rein, ohne
  DOM/Pi, unit-getestet: Kategorien + Glyphen, deterministische
  Reihenfolge Reads · Suchen · Shell · Edits · Web · Tools).
- Die Einzelkarten existieren weiter, aber erst beim Aufklappen des
  `<details>`-Elements — Tool-Ausgaben dominieren den Chat nicht mehr.
- Der Smoke-Modus prüft jetzt zusätzlich, dass die Aktivitätszeile in
  einer echten Tool-Session gerendert wird.

### Responsive

- `> 1080px`: dreispaltiges Grid, Kontext permanent.
- `≤ 1080px`: Kontext wird zum rechtsseitigen Drawer; Super+I bzw.
  Navigation öffnet/schließt ihn (mit Overlay-Schatten).
- `≤ 760px`: Navigation reduziert auf Initialen (Tooltips bleiben),
  Projekt-/Denk-Label ausgeblendet, Chat bleibt voll nutzbar.

### Bedienbarkeit (Keyboard-first + Maus)

- Alle bestehenden Shortcuts unverändert (Paritätssuite grün):
  Shift+Tab Workflow, Super+M/D/Q/Y/S/R/T/, …, Super+I blendet den
  Kontextbereich ein/aus (breit: Spalte, schmal: Drawer).
- Jede zentrale Funktion ist sowohl per Maus (Buttons/Nav-Zeilen) als
  auch per Shortcut oder fokussierbaren Button erreichbar; nichts ist
  exklusiv auf einem Weg verfügbar.
- Neue Panels/Zeilen sind native `<button>`-Elemente (Fokus, Enter).

## Tests

- GUI-Unit **13/13** (inkl. 2 neuer Activity-Tests), Shortcut-Parität
  **4/4**, Format-Gate OK.
- Bridge-E2E gegen echtes Pi: PASS (Streaming, Tool, Abort,
  Bridge-State, BASELINE-OK).
- xvfb-GUI-Smokes: plain PASS, tools PASS (jetzt inkl. Assert auf die
  gerenderte Aktivitätszeile).
- Kanonisch `project_check({ profile: "verify" })`: **Exit 0, 1/1**
  (Snapshot 5b46565a8676); Runtime 1331, UI 124, workflow-mode 381,
  LSP 182, diff 22, Patches 50, Audit sauber.
- UX mit realen Pi-Sessions getestet: beide Smoke-Varianten und die E2E
  laufen gegen den echten gepatchten `pi`-Prozess mit echtem Modell.

## Abschlusskriterien (Dokument 11)

- [x] Chat ist visuell dominant (Hauptfläche, max-width-Bubbles,
      Tool-Zeilen kompakt)
- [x] Tool-Ausgaben dominieren nicht mehr (Aktivitätszeile, Karten auf
      Abruf)
- [x] zentrale Zustände sind ohne Commands erreichbar (Kontext-Übersicht + Panels, direkt aus frontend-bridge-State)
- [x] gleiche Aktionen weiterhin über Shortcut erreichbar (Parität
      unverändert grün)
- [x] Layout funktioniert auf kleinen und großen Fenstern (Responsive-
      Stufen 1080/760 px)
- [x] keine zentrale Funktion ist nur per Maus erreichbar
- [x] keine zentrale Funktion ist nur per Shortcut erreichbar
- [x] visuelle Zustände haben eindeutige Bedeutung (Punkt-Farben,
      Pills ok/fehlgeschlagen/Warnung, Glyphen ✓/✗/●)
- [x] kein unnötiges dauerhaftes Dashboard-Overload (zwei schmale
      Randflächen, Details auf Abruf)
- [x] UX wurde mit realen Pi-Sessions getestet (E2E + beide xvfb-Smokes)

## Bekannte Grenzen / offene Punkte

- Manuelle Sichtprüfung an einem realen Desktop (inkl. sehr kleiner
  Fenstergrößen und WM-Super-Key-Verhalten) steht aus.
- Sitzungs-Panel zeigt Titel/Zeit; Vorschau der letzten Nachrichten ist
  bewusst nicht gebaut („nicht überbauen“).
- `verification.run` bleibt dokumentierte Bridge-Lücke (siehe Phase 5).
