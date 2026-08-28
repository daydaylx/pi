# Project State

## Aktuelle Arbeit

Pi Desktop-GUI nach Auftragspaket `pi_gui_arbeitsauftrag/` (Plan:
`.agent/plans/current-plan.md`). **Phasen 0–8 abgeschlossen — das
Auftragspaket ist vollständig abgearbeitet.** Phase 8 wurde durch die
ausdrückliche Nutzerentscheidung beendet: **Option B — `pi gui` wird
bevorzugte Oberfläche, `pi` (Aurora-TUI) bleibt Fallback**
(`docs/gui-baseline/phase-8-report.md`). Keine automatische TUI-Reduktion;
beide Oberflächen laufen gegen denselben Core.

## Umgesetzt (dieser Auftrag)

- Schritt 0 (beauftragte Commits): `351da66` Aurora-Kachel-Paket,
  `459733b` Alt-GUI-Plan entfernt + Auftragspaket + `.gitignore`.
- Phase 0: Baseline-Artefakte in `docs/gui-baseline/` (Architektur inkl.
  praktischem RPC-Test von `pi --mode rpc`, Shortcuts, Menü-/Command-
  Katalog, State-Owner, Tests-Inventar) plus `phase-0-report.md` (PASS).
- Phase 1: Kandidaten-Klone unter `git/github.com/`, Audit + Pflicht-
  Prototyp (`phase-1-gui-candidate-audit.md`, RPC end-to-end grün;
  stale-ctx-Fehler bei hartem Shutdown im aktiven Turn = Phase-3-Fix).
  `phase-1-report.md` (PASS).
- Phase 2: Neues Protokollmodul `extensions/frontend-protocol/` (v1.0.0):
  Command-Registry (23 Einträge inkl. aller Pflicht-IDs, Targets
  rpc/slash/local/bridge/tui mit dokumentierten Lücken), State-Schema
  (12 Pflichtfelder mit Core-Besitzern), Event-Mapping (9 Pflicht-
  ereignisse), Shortcut→Command-Mapping, Compatibility-Adapter. Kanäle/
  Schemata aus `aurora-ui/state.ts` in den neutralen Vertrag verschoben,
  Aurora behält Legacy-Aliase; alle sechs Publisher unverändert.
  Neue Contract-Section (runtime) mit ~196 Assertions. `phase-2-report.md`
  (PASS).
- Phase 3: `gui/` Minimal-GUI — main (index/pi-rpc-manager/ipc-handlers/
  preload.cjs), renderer (Chat, Streaming, kompakte Tool-Cards, Cancel,
  Banner, Statusleiste, Inspector-Panel), Session-Resume via Verzeichnis-
  liste + switch_session, Extension-UI-Dialoge (select/confirm/input)
  nativ gerendert; Security: contextIsolation+sandbox+IPC-Whitelist+CSP.
  `bin/pi-gui` Launcher + `bin/pi` Shim für wörtliches `pi gui`
  (`phase-3-report.md`, PASS).
- Phase 4: Shortcut-/Menü-Parität — Aktionstabelle mit Klick+Tasten-
  Triggern aus shortcuts.json (Spiegel des Protokolls); Picker für
  Modell/Denken, Command-Palette über get_commands, Slash-Flows für
  Permission/Rollenmodelle; Paritätssuite 4 PASS. workflow.open/set als
  sichtbare Bridge-Lücke dokumentiert (R13; Empfehlung: plan-mode ergänzt
  `/workflow-set` als Extension-Command in Phase 5) (`phase-4-report.md`,
  PASS).
- Phase 5: Kernzustände aus dem Core — neue Bridge-Extension
  `extensions/frontend-bridge/` (merged Bus-Zustände + Subagent-Events +
  letzte Nutzereingabe, throttled Custom-Entries `frontend-bridge/state`
  über `pi.appendEntry`, Epoch-Fallback für den RPC-Modus).
  Pflichtfix Testmatrix D: Graceful-Stop in `PiRpcManager.stop()`
  (Abort+Drain vor stdin-Ende) statt Runtime-Eingriff.
  `/workflow-set <mode>` als plan-mode-Extension-Command (Katalogeintrag,
  im Command Center bewusst ausgeblendet); Protokoll-Targets
  workflow.open→local, workflow.set→/workflow-set, permissions.set→
  /permission. Zustandsschema um task/subagents erweitert; Inspector +
  Status-Chips zeigen Workflow/Aufgabe/Verification/Changes/Subagents/
  Permissions/LSP aus Core-State. Neue Runtime-Section (Bridge-Transport,
  Coverage 100 %) + Divergenztest im Contract; E2E mit Bridge-Assertion
  PASS; xvfb-Smokes PASS (`phase-5-report.md`, PASS).
- Phase 6: UX bewusst neu gestaltet — 3-Spalten-Layout (Navigation |
  Conversation | Kontext), Chat als Hauptfläche, kompakte
  Aktivitätszeilen statt Tool-Card-Wand (reines Modul
  `gui/renderer/activity-summary.js`, unit-getestet), Zustände als
  klickbare Kontext-Zeilen mit Detail-Panels auf Abruf, responsive
  (Drawer ≤ 1080px, Initialen-Nav ≤ 760px). Alle Shortcuts unverändert
  (Parität grün). Smoke prüft jetzt zusätzlich die Aktivitätszeile.
  Unit 13/13, Parität 4/4, E2E PASS, xvfb-Smokes PASS
  (`phase-6-report.md`, PASS).
- Phase 7: Hardening — statisches Sicherheits-Gate `gui/test/security.mjs`
  (8 Assertions), Crash-Suite `gui/test/stability.mjs` (5 Assertions),
  globaler web-contents-created-Guard, Linux-Packaging via
  `scripts/package-gui.mjs` (selbsttragendes Verzeichnis + tar.gz,
  Smokes aus dem Paket PASS), Rollback-Doku. GUI-Tests gesamt 26/26
  (`phase-7-report.md`, PASS).
- Phase 8: Nutzungsentscheidung — Evaluationsbericht mit Evidenz
  (Bewertungsfragen-Tabelle, Optionen A–D); ausdrückliche
  Nutzerentscheidung für **Option B** (GUI bevorzugt, TUI Fallback).
  Kein Code-Umbau: Aurora bleibt vollständig erhalten und getestet
  (`phase-8-report.md`, ABGESCHLOSSEN).

## Letzte Verifikation

`project_check({ profile: "verify" })`: Exit 0, Pflichtabdeckung 1/1
(Snapshot 58db4a2152ee). Runtime-Suite 1331/1331, UI-Suite 124,
workflow-mode 381, LSP 182, diff 22, Patches 50, Audit sauber;
Prettier/Typecheck/Knip/Coverage grün (frontend-bridge 19/19).
Vollsuite 1656/1656. GUI-eigene Gates: Unit 8, Shortcut-Parität 5,
Security 8, Stabilität 5, Bridge-E2E PASS, xvfb-Smokes plain+tools PASS
(auch aus dem Linux-Paket). Live-TTY-Smoke weiterhin unbelegt (#137);
Reports/Evidenz in docs/gui-baseline/.

## Nächste Schritte

1. Beobachtungspunkte aus Entscheidung B im Alltag verfolgen: reale
   Nutzungshäufigkeit, RAM/Startzeit, Langzeit-Session-Stabilität; bei
   Widerlegung ist der Wechsel zu A verlustfrei möglich.
2. Manuelle Sichtprüfung an einem realen Desktop + Issue-Triage der
   Kandidaten nachholen (weiter offen).
3. Kein Commits ohne Auftrag; `settings.json` enthält eine fremde
   Änderung (Subagent-Modelle), die vor einem Commit zu trennen ist.
