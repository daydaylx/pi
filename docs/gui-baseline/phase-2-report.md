# Phase 2 – Abschlussreport: Frontend-Protokoll

## Status

- Phase: 2
- Ergebnis: PASS
- Nächste Phase: 3 — BLOCKED

## Umgesetzt

- Neues, präsentationsfreies Protokollmodul `extensions/frontend-protocol/`
  (Version 1.0.0), gegliedert entlang der Zielarchitektur:
  - `state-contract.ts`: Kanäle (stabil: `aurora-ui/state/*`), UI-State-
    Schemata (neutral benannt), das Pflichtfeldschema mit **zwölf Feldern
    inkl. Core-Besitzer und Transport** (session/workflow/task/activity/
    changes/verification/subagents/model/thinking/permissions/context/lsp).
  - `commands.ts`: semantische Command-Registry (23 Einträge) mit allen
    zwölf Pflicht-IDs aus Dokument 07; Targets klassifiziert in `rpc`
    (sofort ausführbar), `slash` (Extension-Command via prompt),
    `local` (Frontend rendert aus Core-Daten, menuDataOps geliefert),
    `bridge` (dokumentierte Lücke inkl. Grund + Phase, R13) und `tui`
    (bewusst editornativ).
  - `events.ts`: die neun Pflichtereignisse mit Quellen-Mapping auf echte
    RPC-Ops bzw. Bus-Kanäle; Ableitungen (tool.failed,
    verification.changed, session.changed) explizit markiert.
  - `shortcut-mapping.ts`: alle Baseline-Shortcuts → Command-IDs
    (Shift+Tab→workflow.open, Super+M→model.open, …); Portabilität je
    Eintrag explizit.
  - `compatibility.ts`: Adapter Bus-Payload ↔ versionierte
    Protokollereignisse plus `protocolStateRequest()` für Snapshot-Anfragen.
  - `index.ts`: Barrel mit PROTOCOL_VERSION.
- **Besitzumschichtung ohne Provider-Änderung**: Kanäle und Schemata wanderten
  aus `extensions/aurora-ui/state.ts` in den neutralen Vertrag; Aurora
  behält ihre Legacy-Namen als Aliase (`AURORA_UI_CHANNELS =
FRONTEND_STATE_CHANNELS`, Typ-Aliase). Alle sechs Publisher
  (setup-core, diff-viewer, permissions, lsp, plan-mode ×2) laufen
  unverändert weiter — Aurora ist damit strukturell nur noch Konsument.
- Contract-Tests: neue Section „Frontend protocol contract v1“
  (`tests/suites/runtime/frontend-protocol.mjs`), registriert in
  `run-suite-registry.mjs` (Domain runtime) und `tests/suites/runtime.mjs`.
  Geprüft: Semver-Version; alle Pflicht-Commands vorhanden; Target-Gültigkeit
  (Bridge-Lücken mit Grund+Phase, Slash-/RPC-Ziele gegen dokumentierte
  Ops-Allowlist); zwölf Pflichtfelder mit erlaubten Besitzern (kein
  Renderer-Besitzer); Kanalidentität Aurora↔Vertrag; alle neun
  Pflichtereignisse geerdet; Shortcut-Baseline-Paare stabil; Adapter-
  Roundtrips verlustfrei; Legacy-Oberfläche von aurora-ui/state intakt.
- Architekturtest (Dokument 07): erfüllt — der Vertrag referenziert nur
  Runtime-RPC und den Core-seitigen Bus; ein drittes Frontend könnte
  denselben Vertrag konsumieren, ohne Aurora zu berühren.
- knip.json um den neuen Entry-Punkt ergänzt.

## Nicht umgesetzt

- Die drei `bridge`-Lücken (workflow.open/set, permission.set,
  verification.run) sind bewusst offen — sie sind Phase-3-Arbeit und im
  Registry-Eintrag jeweils mit Grund und Phase dokumentiert.
- Kein eigener JSON-Schema-Dump; die TS-Typen sind der Vertrag
  (Schema-Export kann bei Bedarf in Phase 3 nachgezogen werden).
- Kein Commit der Phase-2-Artefakte (nicht beauftragt).

## Tests

- Engste Suite zuerst: `PI_TEST_SUITE=runtime node tests/run.mjs`
  → PASS 1307/0 (inkl. neuer Section).
- Kanonisch: `project_check({ profile: "verify" })` → Exit 0,
  Pflichtabdeckung 1/1 (format, typecheck, knip, coverage, patches,
  audit alles grün).
- Regressionen: Aurora-Funktionen unverändert gemessen (alle Suiten wie
  in Phase 1; UI-Suite 124, workflow-mode 381 unverändert grün).

## Abschlusskriterien (Dokument 07)

- [x] Commands dokumentiert und typisiert
- [x] State dokumentiert und typisiert (12 Felder + Besitzer + Transport)
- [x] Events dokumentiert und typisiert
- [x] Shortcut-Mapping dokumentiert (semantische Ziele, keine UI-Komponenten)
- [x] keine fachliche Logik ins Frontend verschoben (Registry enthält nur
      Verweise; Adapter transformieren Formen, niemals Entscheidungen)
- [x] Aurora funktioniert weiterhin (Suiten grün, Legacy-Aliase getestet)
- [x] `pi` funktioniert weiterhin (Runtime unberührt)
- [x] State-Schema hat klar definierte Besitzer (OWNER-Set, getestet)
- [x] Protokoll ist versionierbar (PROTOCOL_VERSION, stabile Kanalnamen)
- [x] Tests für zentrale Contract-Fälle vorhanden

## Regressionen

- keine (Suitenzahlen: runtime 1307, ui 124, workflow-mode 381, lsp 182,
  diff 22 — alles PASS)

## Risiken

- `bridge`-Lücken müssen in Phase 3 geschlossen werden, bevor die GUI diese
  Aktionen anbietet (R12/R13: keine Phantom-Flächen, sichtbare Deaktivierung).
- RPC `prompt` mit `/extension-command` ist laut Runtime-Doku zulässig, aber
  im praktischen Prototyp noch nicht einzeln belegt (nur get_state/prompt/
  abort liefen real) — Phase 3 deckt das im E2E ab.
- Der Kanalname `aurora-ui/state/*` ist historisch bedingt; eine spätere
  Umbenennung wäre ein breaking change der Transportebene (Version 2).

## Technische Schulden

- Phase-1-/Phase-2-Dateien liegen uncommitted (kein Auftrag).
- `settings.json` trägt weiterhin die fremde Änderung.
- diff-viewer-Coverage 75 % über Floor (Advisory, unverändert).

## Geänderte Dateien

- neu: `extensions/frontend-protocol/{index,state-contract,commands,events,
shortcut-mapping,compatibility}.ts`,
  `tests/suites/runtime/frontend-protocol.mjs`
- geändert: `extensions/aurora-ui/state.ts` (Schemata → Aliase),
  `tests/shared/run-suite-registry.mjs`, `tests/suites/runtime.mjs`,
  `knip.json`
- neu (Doku): dieses Report-File

## Rollback

- `git checkout -- extensions/aurora-ui/state.ts tests/shared/run-suite-
registry.mjs tests/suites/runtime.mjs knip.json` und
  `rm -r extensions/frontend-protocol tests/suites/runtime/frontend-
protocol.mjs`. Runtime, Settings und Sessions bleiben unberührt.

## Empfehlung

- GO für Phase 3 (Minimal-GUI auf Basis pi-desktop), Voraussetzungen:
  vollständiger Clone/Fork des Favoriten, Issue-Triage nachholen, Klärung
  des `pi gui`-Startpfads (Wrapper vs. Runtime-Erweiterung) als erster
  Schritt der Phase.

## Harte Sperre

```text
STATUS: PHASE 2 COMPLETE
NEXT: PHASE 3 BLOCKED
USER APPROVAL REQUIRED
```
