# RabbitMode Status Contract (read-only)

Dieser Contract beschreibt, wie eine externe, In-Process-Pi-Extension
(erste und aktuell einzige Konsumentin: [`daydaylx/pi-rabbitmode`](https://github.com/daydaylx/pi-rabbitmode))
lesend erfahren kann, welches Permission-Level und welcher Workflow-Mode
gerade aktiv sind — ohne ein eigenes Permission- oder Workflow-System zu
bauen und ohne den bestehenden Zustand zu verändern.

## Nicht zu verwechseln mit dem Frontend-Protokoll

`docs/frontend-api.md` / `@daydaylx/pi-frontend-protocol` beschreiben ein
anderes, ebenfalls existierendes Protokoll: das externe JSONL-RPC-Protokoll
für **Out-of-Process**-Frontends (z. B. die Desktop-GUI), mit eigenem
Namensraum (`state.snapshot`/`state.patch` über RPC-Methoden).

Dieser Contract hier beschreibt dagegen den **In-Process**-`EventBus`
(`pi.events` am `ExtensionAPI`, siehe
`npm/node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.d.ts`),
den jede im selben Prozess geladene Extension ohne Kanal-Allowlist
abonnieren kann — das ist der relevante Mechanismus für eine Extension wie
`pi-rabbitmode`, die (wie `diff-learning` oder `mode-permissions`) als
normale Pi-Extension im selben Prozess läuft, kein separates GUI-Frontend.

## Source of Truth

`extensions/frontend-protocol/state-contract.ts` (`FRONTEND_STATE_CHANNELS`,
aktuell `PROTOCOL_VERSION = "1.1.0"`). Dieses Dokument ist eine manuell
gepflegte Teilmenge davon — kein generierter oder automatisch geprüfter
Export. Bei Änderungen an `state-contract.ts`, die `permissions` oder
`workflow` betreffen, sollte dieses Dokument mitgepflegt werden; es gibt
aktuell keinen automatischen Drift-Check (siehe „Spätere Härtung" unten).

## Kanäle

| Kanal                      | Nutzbar für `pi-rabbitmode`?      | Hinweis                                                                  |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `aurora-ui/state/patch`    | **Ja — einziger genutzter Kanal** | Broadcast bei jeder Zustandsänderung. Passiv mitlesen, `type: "patch"`.  |
| `aurora-ui/state/request`  | **Nein — niemals emittieren**     | Siehe Warnung unten.                                                     |
| `aurora-ui/state/snapshot` | Nein                              | Antwort auf `request`; ohne selbst `request` zu senden nicht erreichbar. |

### Warum `request` tabu ist

`extensions/permissions/session-state.ts` (`subscribeAuroraProvider`) merkt
sich in einer einzigen geteilten Variable (`auroraEpoch`) den
`sessionEpoch` des zuletzt eingegangenen `request` und taggt **alle
folgenden** `patch`-Events mit diesem Wert. Ein `request` von
`pi-rabbitmode` mit einem eigenen `sessionEpoch` würde diesen geteilten
Zustand überschreiben und könnte dazu führen, dass Auroras eigene TUI ihre
nachfolgenden Permission-/Workflow-Patches nicht mehr korrekt zuordnet.
`pi-rabbitmode` liest deshalb ausschließlich passiv auf dem Broadcast-Kanal
`aurora-ui/state/patch` mit und emittiert dort selbst nie.

## Payload-Subset

Aus `FrontendUiPatchEvent` (`extensions/frontend-protocol/state-contract.ts`):

```ts
{
  type: "patch",
  sessionEpoch: string,
  source: string,
  patch: {
    permissions?: { level?: string; label?: string },
    workflow?: {
      phase?: "work" | "simple_plan" | "detailed_plan",
      label?: string,
      pending?: "work" | "simple_plan" | "detailed_plan",
      planReady?: { hash: string; mode: string; qualityOk: boolean } | null,
    },
    // weitere Felder (lsp, model, activity, changes, verification, task,
    // subagents) sind Teil desselben Payloads, aber nicht Teil dieses
    // Contracts — pi-rabbitmode liest sie in Phase 1-2 nicht.
  },
}
```

Owner laut `STATE_FIELD_OWNERS`/`FRONTEND_STATE_FIELDS`:
`permissions` → `extension:mode-permissions`,
`workflow` → `extension:plan-mode`. Kein Eintrag zeigt auf einen
Rabbit-Owner — `pi-rabbitmode` schreibt hier nie, es liest nur.

## Stabilitätshinweis

Es gibt keinen npm-Package-Export für diese Kanäle/Typen (`daydaylx/pi`s
`package.json` ist `private`, ohne `exports`-Feld). Konsumenten hardcoden
die dokumentierten Kanalstrings und validieren das empfangene Payload
defensiv per Type-Guard — genau wie es Extensions innerhalb dieses Repos
selbst tun (Muster: `extensions/shared/diff-events.ts`).

## Spätere Härtung (nicht Teil der aktuellen Änderung)

Ein Drift-Check-Test, der `FRONTEND_STATE_CHANNELS`/`PROTOCOL_VERSION` aus
`state-contract.ts` gegen die in diesem Dokument beschriebenen Werte
spiegelt, wäre eine sinnvolle spätere Ergänzung (z. B. in
`tests/shared/run-suite-registry.mjs`, Domain `"runtime"`), ist aber
bewusst nicht Teil dieser additiven, risikoarmen Dokumentationsänderung.
