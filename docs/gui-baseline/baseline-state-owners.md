# Baseline State-Owners — Core-owned vs. Frontend-owned (Phase 0)

## Wichtigster Befund

Es existiert bereits ein **Event-Bus-State-Protokoll** zwischen fachlichen
Extensions und der Aurora-Präsentation:

- Kanäle (`extensions/aurora-ui/state.ts`, `AURORA_UI_CHANNELS`):
  - `aurora-ui/state/request` (Präsentation fragt, Extensions antworten
    mit Snapshot für die aktuelle `sessionEpoch`)
  - `aurora-ui/state/patch` (inkrementelle Fachzustands-Updates)
  - `aurora-ui/state/snapshot` (vollständige Sichten je Provider)
- Schema: `AuroraUiState` mit `workflow`, `permissions`, `lsp`, `model`
  (id + thinking), `activity`, `changes`, `verification`.

**Publisher (Fachzustands-Besitzer):**

| Feld               | Besitzer-Extension                    | Ort                                                                                                           |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| verification       | setup-core                            | `extensions/setup-core/index.ts` (`publishAuroraVerification`)                                                |
| changes            | diff-viewer                           | `extensions/diff-viewer/index.ts`                                                                             |
| permissions        | permissions                           | `extensions/permissions/session-state.ts`                                                                     |
| lsp                | lsp                                   | `extensions/lsp/index.ts`                                                                                     |
| workflow/task      | plan-mode                             | `extensions/plan-mode/presentation.ts`, `events.ts`                                                           |
| activity/subagents | aurora-ui selbst aus Core-Ereignissen | `index.ts` (`subagent:async-started/complete/control-event`, Tool-Events), Projektion in `task-projection.ts` |

Nicht im Mirror-Schema (Stand Baseline): Subagent-Listenzustand (läuft über
separate Events), Context-/Tokenfüllstand, Task-Titel (wird in
`task-projection.ts` aus Core-Signalen projiziert).

Diese Struktur ist die natürliche Basis für das Phase-2-Frontendprotokoll:
Die GUI hängt sich an denselben Bus bzw. dessen RPC-Projektion — Aurora ist
damit **nicht** die Datenquelle, sondern nur ein weiterer Konsument.

## Core-owned (Runtime + Extensions)

- Workflow/Planmodus (`work | simple_plan | detailed_plan`) → plan-mode
- Verification (Status, required/recommended IDs, Outcomes, Staleness) →
  setup-core; Staleness-Definition genau einmal (`task-projection.ts`,
  `verificationIsStale`)
- Permission-Level / Trust → mode-permissions, permissions
- Modell + Thinking-Level → Runtime-State (RPC `get_state`: `model`,
  `thinkingLevel`)
- Session (ID, Epoch, Message-Counts, Compaction) → Runtime-State
- Changes/Diffs → diff-viewer aus Edit-/Write-Verlauf
- LSP-Status → lsp-Extension
- Tool-Lifecycle, Streaming, Abort → Runtime-Agent
- Subagent-Lifecycle → pi-subagents (gepinntes Paket)

## Frontend-owned (Aurora heute; GUI später analog)

- Dashboard-Modus-Darstellung (auto|compact|expanded|hidden als
  Präsentationspräferenz, persistiert via `/dashboard` — Einstellung,
  nicht Zustandsquelle)
- Footer-Priorisierung und Größenklassen (`extensions/shared/layout.ts`:
  compact <52 Spalten, standard, comfortable ≥90×28, wide ≥120×30)
- Kachel-/Pill-Darstellung, Zeilenbudgets, Receipt-Komprimierung
  (`tool-renderers.ts`, `tile.ts`, `receipts.ts`)
- Inspector-Anordnung, Startbildschirm-Gestaltung

## Verbotene Doppelwahrheiten (R2) — heutige Absicherung

- Verification-Verdict wird „nur aus echten, upstream-entschiedenen
  Signalen“ gebildet (`task-projection.ts`-Kommentar); nie im Renderer
  neu berechnet.
- Phase und Verifikationsurteil teilen genau eine Staleness-Definition.
- Der Editor ist Pis eigener Editor (`docs/decisions/013`) — kein eigenes
  Eingabemodell im Frontend.

Für die GUI gilt dasselbe Muster: Sie konsumiert die Kanäle und darf
lediglich Darstellungsableitungen (z. B. eingeklappt/expandiert) lokal
halten.
