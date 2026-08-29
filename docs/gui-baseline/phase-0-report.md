# Phase 0 – Abschlussreport

## Status

- Phase: 0
- Ergebnis: PASS
- Nächste Phase: 1 — vom Nutzer vorab freigegeben („phase 0 und 1 starten“, „go“)

## Umgesetzt

- Vorbereitungs-Commits (beauftragt): `351da66` (Aurora-Kachel-Paket),
  `459733b` (Alt-Plan entfernt, Auftragspaket + .gitignore aufgenommen).
- `baseline-architecture.md`: Startpfad (`/home/d/.npm-global/bin/pi`,
  Runtime 0.84.3, Bundle-Loader), aktive Runtime-Patches, CLI-Oberfläche,
  praktischer RPC-Test, Extension-Layer, Session-Verzeichnisse.
- `baseline-shortcuts.md`: zentrale Shortcut-Tabelle aus
  `extensions/shared/shortcuts.ts`, keybindings.json, Shift+Tab-Workflow,
  Catalog-Shortcuts.
- `baseline-menus.md`: alle 9 Menügruppen, kompletter Command-Katalog,
  TUI-Darstellungsflächen.
- `baseline-state-owners.md`: bestehendes Event-Bus-Protokoll
  (`aurora-ui/state/{request,patch,snapshot}`) mit Publisher-Zuordnung;
  Core-owned vs. Frontend-owned; R2-Absicherungen.
- `baseline-tests.md`: Verify-Kette, Suiten-Inventar, manuelle Checklisten,
  dokumentierter Baseline-Smoke.

## Nicht umgesetzt

- Manuelle Sichtprüfung in einem echten Terminal (TUI-Seite) — ohne TTY
  nicht durchführbar; bleibt offener P0 (#137) und ist kein
  Phase-0-Versprechen des Auftragspakets an Codeänderungen gebrochen.
- Keine Produktivdatei wurde verändert (nur neue Artefakte unter
  `docs/gui-baseline/`).

## Tests

- Baseline-Smoke:
  - `pi --version` → 0.84.3
  - RPC `get_state` → success:true (Modell, Thinking, Session, Counts)
  - RPC unbekannter Command → strukturierte Fehlermeldung
- Code-Tests: nicht erforderlich (kein Code geändert); die letzte
  Vollverifikation des Arbeitsstands ist im Commit `351da66`
  nachvollziehbar (verify grün).

## Abschlusskriterien (Dokument 05)

- [x] `pi` startet unverändert (Version/Help/RPC geprüft)
- [x] vorhandene Tests sind erfasst
- [x] zentrale Shortcuts vollständig dokumentiert
- [x] zentrale Menüs vollständig dokumentiert
- [x] Core-owned State von Aurora-owned Rendering getrennt beschrieben
- [x] RPC-Fähigkeiten praktisch getestet (Roundtrip + Fehlerfall)
- [x] keine Produktivdatei unnötig verändert
- [x] Baseline-Report enthält bekannte Risiken

## Regressionen

- keine (kein Produktivcode berührt)

## Risiken

- GUI verbindet sich mit gepatchter Bundle-Runtime: Upgrade-Anfälligkeit
  der Anker bleibt Projekt risiko Nr. 1 (Upgrade-Gate etabliert).
- RPC leitet `extension_ui_request` durch: Antwortstrategie für die GUI
  fehlt noch (Phase 2).
- Live-TTY-Lücke: TUI-Seite der künftigen Paritätstests teils nur
  indirekt belegbar.
- Super-Shortcuts in Electron brauchen eine Terminalprotokoll-freie
  Lösung; Konfliktanalyse erst in Phase 4 sinnvoll.

## Technische Schulden

- `settings.json` trägt eine fremde, uncommittete Änderung (Subagent-
  Modelle) — bewusst unangetastet.
- `docs/CONTEXT_LEDGER.md` / `PROJECT_STATE.md` folgen als Checkpoint.
- Alt-Plan-Deletion ist committed; keine Reste im Baum.

## Geänderte Dateien

- neu: `docs/gui-baseline/baseline-architecture.md`,
  `baseline-shortcuts.md`, `baseline-menus.md`,
  `baseline-state-owners.md`, `baseline-tests.md`
- Commits: `351da66`, `459733b`

## Rollback

- Artefakte löschen (`rm -r docs/gui-baseline`);
  Commits via `git reset --hard 62b52f8` (verwirft beide Pakete) oder
  selektiv revertieren. Keine Runtime-/Produktivdatei angefasst.

## Empfehlung

- GO für Phase 1 (bereits durch den Nutzer freigegeben).

## Harte Sperre

Phase 1 läuft auf Grundlage der Nutzerfreigabe („phase 0 und 1 starten“ +
„go“). **Phase 2 ist ab diesem Report blockiert** und wartet auf
ausdrückliche Freigabe nach Vorlage des Phase-1-Audits.
