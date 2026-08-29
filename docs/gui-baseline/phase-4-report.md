# Phase 4 – Abschlussreport: Shortcut- und Menü-Parität

## Status

- Phase: 4
- Ergebnis: PASS (mit einer dokumentierten Ausnahme: workflow.open/set)
- Nächste Phase: 5 — BLOCKED

## Umgesetzt

- **Ein Command, mehrere Trigger:** Jede zentrale Aktion ist als Eintrag in
  einer Aktionstabelle (`actions` in `gui/renderer/renderer.js`) verdrahtet
  und wird sowohl per Tastenkombination als auch per Klick ausgelöst.
  Die Trigger-Tabelle kommt als Spiegel des Frontend-Protokolls aus
  `gui/shared/shortcuts.json` (geladen über IPC).
- **Shortcuts integriert** (TUI-Baseline aus Phase 0):
  - Shift+Tab → workflow.open _(sichtbare Lücke, siehe unten)_
  - Super+M → model.open · Super+, → model.cycle
  - Super+D → thinking.open · Super+T → thinking.cycle
  - Super+Q → app.commandCenter (Palette über get_commands)
  - Super+Y → yolo.toggle · Super+S → subagents.rolesModel
  - Super+R → session.resume (Verzeichnisliste + switch_session)
  - Super+Shift+Y → editor.yank (TUI-editornativ, bewusst ohne GUI-Pendant)
    Zusätzlich akzeptiert die GUI Ctrl+Alt+<Taste> als funktional gleichen
    Trigger — dokumentierte R5-Abweichung wegen WM-abhängiger Super-Tasten
    auf Linux.
- **Menüs neu gerendert** (funktional identische Struktur):
  - Modell-/Denktiefe-Auswahl als gefilterte Picker, gespeist von
    get_available_models / get_available_thinking_levels (menuDataOps des
    Phase-2-Vertrags), Ausführung via set_model / set_thinking_level.
  - Command-Palette über get_commands; nur invokierbare Quellen
    (extension/skill/prompt) aktiv, TUI-interne Einträge sichtbar deaktiviert.
  - Permission-Modus und Subagent-Rollenmodelle laufen als Slash-Flows;
    die dabei entstehenden Extension-Selector-Anfragen werden als native
    Dialoge gerendert und beantwortet (Extension UI Protocol).
  - Inspector-Panel als lokale Ansicht über den State-Strom: Session,
    Modell/Denken, Kontext (get_session_stats), Verifikationsstatus
    (setStatus-Requests), Sitzungs-Änderungen (abgeleitet aus edit/write-
    Tool-Ereignissen), Meldungsfeed; Workflow/Task/Subagenten mit
    expliziten Platzhaltern (Phase-5-Bridge).
  - Session-Resume-Dialog mit Pfadauswahl; Neue-Sitzung-Knopf.
- **Keine separate GUI-only Shortcut-Konfiguration:** Die Tabelle ist ein
  gespiegeltes Artefakt des Protokolls; eine Paritätssuite erzwingt die
  Übereinstimmung (`gui/test/shortcut-parity.mjs`, 4 PASS).
- **TUI unberührt:** bestehende Shortcut-Suite der TUI unverändert grün.

## Tests

- Parität: Protokoll-Mapping ↔ shortcuts.json ↔ Renderer-Verdrahtung
  (jede Zeile dreifach geprüft); nicht-portable Einträge tragen Gründe. PASS.
- Unit: 6 PASS (RPC-Bridge, UI-Antwortformen, Tool-Cards, Args).
- E2E + Smokes: wie Phase 3 erneut ausgeführt nach Formatierung — PASS.
- Kanonisch: `project_check({profile:"verify"})` Exit 0, 1/1.

## Abschlusskriterien (Dokument 09)

- [x] priorisierte Shortcuts funktionieren — **Ausnahme workflow.open/set:
      dokumentierte Bridge-Lücke**, Shortcut zeigt sichtbaren Hinweis (R13)
- [x] kein stiller Kollision mit Electron/OS (keine globalShortcut-
      Registrierung; Ctrl+Alt-Alternativen dokumentiert)
- [x] unvermeidbare Konflikte sind dokumentiert (Super-Risiko, Lücken)
- [x] Menüstruktur entspricht funktional der Pi-Struktur (Kataloggruppen)
- [x] Klick und Shortcut lösen dieselben Commands aus (eine Aktionstabelle)
- [x] keine doppelte Geschäftslogik (nur RPC-/Slash-Weg, kein lokales Regeln)
- [x] Keyboard-only Nutzung möglich (alle Flächen fokussierbar, Enter sendet)
- [x] Maus-Nutzung möglich (Buttons + klickbare Listenzeilen)
- [x] TUI-Shortcuts bleiben unverändert (Suite grün, Datei unberührt)
- [x] Regressionstest für Shortcut-Mapping vorhanden

## Nicht umgesetzt

- workflow.open/workflow.set funktional: braucht einen Core-seitigen
  Einstiegspunkt (z. B. plan-mode registriert `/workflow-set` als
  Extension-Command — dann wäre es via RPC prompt erreichbar). Empfehlung
  für Phase 5 vermerkt.
- verification.run / permission.set (Direktaufruf): gleiche Kategorie,
  Phase-5-Bridge.

## Regressionen

- keine (TUI-Suiten unverändert grün; Runtime 1307/1307)

## Risiken

- Ohne Phase-5-Bridge bleiben Workflow/Task/Subagenten-Zustände für die
  GUI unsichtbar; der Inspector kennzeichnet das explizit.
- Super-Key-Verhalten ist WM-spezifisch; reale Desktop-Umgebungen sind
  manuell zu prüfen (xvfb deckt Logik, nicht WM-Interaktion ab).

## Technische Schulden

- shortcuts.json ist manuell gepflegter Spiegel; ein Generator aus dem
  Protokollmodul wäre robuster (klein, Phase 5 mitzunehmen).
- Inspector-Refresh ist manuell/ereignisgesteuert, kein Polling.

## Geänderte Dateien

- geändert: `gui/renderer/renderer.js` (Aktionen, Dialoge, Inspektor),
  `gui/main/ipc-handlers.js`, `gui/main/preload.cjs`,
  `gui/shared/shortcuts.json`
- neu: `gui/test/{shortcut-parity,format-check}.mjs`

## Rollback

- Phase-4-Umfang liegt vollständig in gui/-Dateien; Rückkehr zum
  Phase-3-Stand durch Wiederherstellen dieser Dateien (git nicht nötig,
  da uncommitted — Kopie im Report-Verlauf).

## Empfehlung

- GO für Phase 5 (Kernzustände inkl. der dafür nötigen Bridge-Extension;
  dort auch workflow.set als Extension-Command ergänzen).

## Harte Sperre

```text
STATUS: PHASE 4 COMPLETE
NEXT: PHASE 5 BLOCKED
USER APPROVAL REQUIRED
```
