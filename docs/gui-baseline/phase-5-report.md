# Phase 5 — Pi-spezifische Kernzustände in der GUI

Status: **ABGESCHLOSSEN** (implementiert und verifiziert; manuelle
Sichtprüfung an einem realen Desktop steht weiter aus).

## Ziel (Dokument 10)

Die GUI soll nicht nur Chat können, sondern den tatsächlichen
Pi-Arbeitszustand verständlich darstellen — ohne einen Zustand aus
Chattext zu erraten, wenn der Core ihn strukturiert bereitstellen kann.

## Umsetzung

### 1. Bridge-Extension `extensions/frontend-bridge/`

- Läuft als gewöhnliche Extension **im Pi-Prozess** und abonniert die
  bestehenden Bus-Kanäle `aurora-ui/state/*` (request/patch/snapshot)
  sowie die Subagent-Events `subagent:async-started|async-complete|
  control-event` und `message_start` (letzte Nutzereingabe).
- Transport über die RPC-Grenze: gedrosselte (150 ms) Custom-Session-
  Entries `frontend-bridge/state` via `pi.appendEntry`. Diese streamen
  im RPC-Modus als `entry_appended`/`custom`-Ereignisse zur GUI und
  überleben zusätzlich Session-Neustarts.
- **Epoch-Fallback für RPC**: Aurora feuert den State-Request nur im
  TUI-Modus. Ohne ein anderes Frontend öffnet die Bridge nach 400 ms
  selbst eine Epoch (`frontend-bridge/v1`-Requester aus dem
  Compatibility-Layer), damit die Provider (plan-mode, setup-core,
  mode-permissions, diff-viewer, lsp) auch headless antworten. Ein
  fremder Request hat immer Vortritt; fremde Epochen werden ignoriert.
- Gemeldete Felder: `workflow`, `permissions`, `lsp`, `changes`,
  `verification`, `task` (Titel aus letzter Nutzereingabe bzw.
  Workflow-Label, Phase aus Activity/Workflow), `subagents`
  (queued/needs_attention/entfernt bei Abschluss).
- Keine Geschäftslogik: Merge läuft über denselben
  `mergeAuroraUiState`-Pfad wie Aurora (Divergenztest im
  Frontend-Protocol-Contract).

### 2. Pflichtfix: harter Shutdown im aktiven Turn (Testmatrix D)

- Ursache (Phase-1-Fund) präzisiert: RPC-Shutdown invalidiert die
  Extension-Kontexte nach `agent_settled`, wenn stdin mitten im Turn
  endet; nachgelagerte Handler-Zugriffe werfen stale-ctx-Fehler.
- Fix auf Bridge-Ebene ohne Runtime-Eingriff: `PiRpcManager.stop()`
  sendet bei laufendem Turn zuerst `abort`, draint ~700 ms bis
  `agent_settled`, und beendet erst dann stdin/SIGTERM/SIGKILL.
  Streaming-Status wird über `agent_start`/`agent_settled` getrackt.
- E2E bestätigt: Abort-Pfad endet sauber settled, Pi bleibt bedienbar,
  keine `extension_error`-Ereignisse mehr im Graceful-Pfad.

### 3. Workflow setzen über RPC (`/workflow-set`)

- `plan-mode` bekommt den Extension-Command `/workflow-set <mode>`
  (validiert gegen `WORKFLOW_MODES`, nutzt denselben `switchMode`-Pfad
  wie der Shift+Tab-Selector inkl. Trust-Grenze).
- Katalogeintrag in `extensions/shared/command-catalog.ts`; das Command
  Center blendet es bewusst aus (Workflow-Wechsel bleibt dort der
  Shift+Tab-Weg — bestehender Super+Q-Test bleibt grün).
- Frontend-Protokoll: `workflow.open` ist jetzt frontend-lokal
  (GUI-Picker über dem kanonischen Modus-Set), `workflow.set` zeigt auf
  `/workflow-set`, `permissions.set` auf `/permission <level>`. Damit
  sind die dokumentierten Bridge-Lücken für Workflow und Permissions
  geschlossen; einzig `verification.run` bleibt dokumentierte Lücke.

### 4. GUI-Konsumtion (`gui/`)

- IPC-Whitelist leitet `entry_appended`/`custom` weiter; der Renderer
  übernimmt `frontend-bridge/state` in den lokalen Kernzustand.
- Inspector zeigt jetzt aus Core-State: Workflow, Aufgabe, Verifikation
  (inkl. deklarierte Checks und Outcomes), Änderungen (Core-Zähler +
  Dateien), Subagenten, Berechtigungen, LSP. Modell/Denken/Kontext
  bleiben RPC-`get_state`/`get_session_stats`.
- Statusleiste: Workflow-Chip und Berechtigungs-Chip.
- Shift+Tab öffnet jetzt den Workflow-Picker; Auswahl sendet
  `/workflow-set <mode>`. `shortcuts.json`: `workflow.open` ist portabel.

### 5. Zustandsschema

`extensions/frontend-protocol/state-contract.ts` ergänzt `task`
(`title`/`phaseLabel`) und `subagents` (`FrontendSubagentBranch`) als
vertragliche Felder; `aurora-ui/state.ts` merged sie mit, Aurora bleibt
fachlich identisch (Aurora rendert sie heute nicht — Konsument, nicht
Quelle).

## Tests

- Neue Section **„frontend bridge core state transport“** (runtime):
  Epoch-Gating, Merge aller Bus-Felder, Task-Titel aus Nutzereingabe,
  Subagent-Lifecycle inkl. needs_attention, Fremd-Epoch-Isolation,
  Abschluss-Aufräumen. Coverage der Bridge: **19/19 Funktionen (100 %)**,
  Baseline neu geschrieben.
- Frontend-Protocol-Contract erweitert: `/workflow-set`- und
  Local-/Slash-Targets sowie **Divergenztest** (dieselbe Patch-Sequenz
  erzeugt in Aurora- und GUI-Pfad fachlich identische Felder).
- GUI-E2E gegen echtes Pi: zusätzlich Assertion auf einen
  `frontend-bridge/state`-Eintrag mit workflow-Feld und auf sauberes
  Settle nach Abort — **PASS** (`bridge=true`).
- xvfb-GUI-Smokes plain+tools: **SMOKE PASS**.
- GUI-Unit 6/6, Shortcut-Parität 4/4, Format-Gate OK.

## Verifikation

`project_check({ profile: "verify" })`: **Exit 0, Pflichtabdeckung 1/1**
(Snapshot 6630c6071b4e). Runtime 1331, UI 124, workflow-mode 381,
LSP 182, diff 22, Patches 50, Audit sauber; Prettier/Typecheck/Knip grün.
Vollsuite `tests/run.mjs`: **1656 passed, 0 failed**.

Einstellungen: `settings.json` aktiviert die Bridge
(`+extensions/frontend-bridge/index.ts`); `knip.json` führt sie als Entry.
Hinweis: `settings.json` enthält weiterhin eine nicht-committable fremde
Änderung (Subagent-Modellrouting) — beim Commit ausklammern bzw. trennen.

## Abschlusskriterien (Dokument 10)

- [x] Workflow kommt aus Core-State (Bus, plan-mode)
- [x] Task kommt aus Core-State (Titel: letzte Nutzereingabe/Workflow;
      Phase: Activity+Workflow — Projektion aus Core-Signalen, nicht aus
      Chattext)
- [x] Verification kommt aus Core-State (setup-core-Zusammenfassung)
- [x] Changes kommen aus Core-State (diff-viewer)
- [x] Subagents kommen aus Core-State (pi-subagents-Events)
- [x] Modell kommt aus Core-State (RPC get_state, bereits Phase 3)
- [x] Thinking kommt aus Core-State (RPC get_state, bereits Phase 3)
- [x] Permissions kommen aus Core-State (mode-permissions-Bus)
- [x] Kein Zustand wird aus UI-Text heuristisch rekonstruiert
- [x] GUI und Aurora zeigen fachlich denselben Zustand (gemeinsamer
      Merge-Pfad + Divergenztest)
- [x] Divergenztests existieren (Contract-Section, Schritt 11)

## Bekannte Grenzen / offene Punkte

- `verification.run` (direkter Anstoß) bleibt dokumentierte Bridge-Lücke
  (läuft heute nur agenteninvokiert über `project_check`).
- Activity-Feld der GUI kommt weiter aus RPC-Ereignissen
  (`agent_start`/`agent_settled`), nicht aus dem Bus — fachlich
  deckungsgleich, aber kein Bus-Transport.
- Subagent-Status kennt nur queued/needs_attention/entfernt (die
  Paket-Events liefern keine feineren Lifecycle-Zustände; Aurora bildet
  dieselben Events ab).
- Bridge-Entries bleiben in der Session-Datei (throttled 150 ms, kleine
  JSON-Objekte); bei sehr langen Sessions ein Beobachtungspunkt.
- Manuelle Sichtprüfung an einem realen Desktop (inkl. Fenster-Schließen
  während aktivem Turn) und Issue-Triage der Kandidaten stehen aus.
