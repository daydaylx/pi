# 030 — RabbitMode liest Permission/Workflow-State über einen dokumentierten Contract

## Kontext

`daydaylx/pi-rabbitmode` ist eine neue, eigenständige Extension (separates
Repository), die für ihr `/rabbit status` (und spätere Phasen) lesend
erfahren muss, welches Permission-Level und welcher Workflow-Mode gerade
aktiv sind — ohne selbst ein Permission- oder Workflow-System zu bauen
(Repository-Grenze: `daydaylx/pi` bleibt für alle Rabbit-Repositories
alleinige Autorität für Permissions, Workflow, Trust, Recovery und
Verification).

`daydaylx/pi`s `package.json` (Root und `npm/package.json`) sind `private`
und haben kein `exports`-Feld. Es existiert zwar ein publiziertes
Sub-Package (`@daydaylx/pi-frontend-protocol`), aber das beschreibt das
externe JSONL-RPC-Protokoll für Out-of-Process-Frontends (Desktop-GUI) —
ein anderer Namensraum als der In-Process-`EventBus`, über den
In-Process-Extensions wie `diff-learning` oder `mode-permissions`
kommunizieren und den auch `pi-rabbitmode` nutzt.

## Entscheidung

`pi-rabbitmode` liest Permission-Level und Workflow-Mode passiv vom
bestehenden In-Process-`EventBus`-Kanal `aurora-ui/state/patch` mit,
dokumentiert in der neuen Datei `docs/rabbitmode-status-contract.md`. Kein
Code in `daydaylx/pi` wird dafür geändert — nur die bereits existierenden
Kanalnamen/Payload-Shapes aus `extensions/frontend-protocol/
state-contract.ts` werden in einem manuell gepflegten Dokument sichtbar
gemacht, das externe Konsumenten referenzieren können.

`pi-rabbitmode` emittiert dabei **niemals** auf `aurora-ui/state/request`:
`extensions/permissions/session-state.ts` merkt sich in einer einzigen
geteilten Variable (`auroraEpoch`) den `sessionEpoch` des zuletzt
eingegangenen Requests und taggt alle folgenden `patch`-Events damit. Ein
Request von `pi-rabbitmode` würde diesen geteilten Zustand überschreiben
und Auroras eigene TUI-Updates durcheinanderbringen.

## Konsequenzen

- Keine Verhaltensänderung an `extensions/frontend-protocol/
state-contract.ts`, `state-bus.ts` oder irgendeinem Permission-/
  Workflow-Code. Diese Entscheidung fügt ausschließlich eine neue
  Dokumentationsdatei hinzu.
- Externe Konsumenten hardcoden die dokumentierten Kanalstrings und
  validieren empfangene Payloads defensiv per Type-Guard (Muster:
  `extensions/shared/diff-events.ts`) — es gibt keine Typsicherheit über
  eine Paketgrenze hinweg.
- Dieses Dokument ist manuell zu pflegen und kann von
  `state-contract.ts` abdriften; ein automatischer Drift-Check ist
  bewusst nicht Teil dieser Änderung (siehe „Spätere Härtung" im Contract
  selbst).

## Alternativen

- **Package-Export von `state-contract.ts` (z. B. `extensions/` als
  eigenes npm-Package mit `exports`-Feld versehen):** verworfen. Das wäre
  kein kleiner additiver Schritt mehr, sondern ein Eingriff in die
  bestehende Paketstruktur von `daydaylx/pi`, mit entsprechend größerem
  Risiko und Diff für einen Nutzen, den ein dokumentierter Contract
  bereits ohne Codeänderung erreicht.
- **`pi-rabbitmode` importiert interne `.ts`-Dateien aus `daydaylx/pi`
  direkt:** verworfen. Verstößt gegen die Repository-Grenze
  (`pi-rabbitmode` → nur öffentliche Pi-Extension-APIs, nie interne
  Quelldateien eines anderen Repositories).
