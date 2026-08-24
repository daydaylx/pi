# 018 — Subagenten-Delegationen sind ohne Bestätigung erlaubt

## Kontext

Das `subagent`-Tool fiel in `decideTool()`
(`extensions/permissions/tool-policy.ts`) unter die `unknownTools`-Regel und
erhielt auf `project-write` und `confirm-all` ein „ask“ — jede Delegation
öffnete den Bestätigungsdialog, obwohl Subagenten zum definierten
Arbeitsablauf gehören (Entscheidung 011) und ihre Starts zusätzlich fachlich
gegatet sind: harte Trust-Grenze in `guards.ts`, Planmodus-Guard (Entscheidung
012), Verifier-Vertragsprüfung (Entscheidungen 015 und 017). Auf Wunsch des
Nutzers sollen Delegationen ohne Erlaubnisfrage durchlaufen.

## Entscheidung

`decideTool()` behandelt `subagent` hinter der `readonly`-Prüfung als bekannte
Fähigkeit: `allow` auf `project-write`, `confirm-all` und `yolo`. `readonly`
blockiert weiterhin, weil Kind-Läufe eigene Pi-Prozesse mit eigener Sitzung
sind und nicht beweisbar read-only arbeiten — eine Freigabe unter `readonly`
wäre ein Umgehungsweg für die Complete-Lock-Grenze.

## Konsequenzen

- Der Bestätigungsdialog entfällt für alle drei Rollen (`investigator`,
  `debugger`, `verifier`) und die Management-Aktionen des Subagenten-Tools.
- Unverändert vorgelagert und wirksam: die harte Trust-Grenze in
  `extensions/permissions/guards.ts`, der Planmodus-Guard (nur die
  artefaktfreie Investigator-SINGLE-Delegation darf passieren, Entscheidung
  012) und die Verifier-Vertragsprüfung (`verifier-policy.ts`, Entscheidungen
  015/017).
- Wirklich unbekannte Tools bleiben auf der konfigurierten
  `unknownTools`-Stufe; `setup.json` und sein Schema ändern sich nicht.
- Tests: `tests/workflow-mode/permissions.test.mjs` („subagent delegations
  are allowed without confirmation outside readonly“).

## Alternativen

- `unknownTools: "allow"` in `setup.json`: verworfen, weil `decideTool()`
  auch bei Setup-Allow weiterhin einzeln bestätigt und die Einstellung
  zusätzlich alle fremden Tools geöffnet hätte.
- Freigabe auch unter `readonly`: verworfen, weil die Complete-Lock-Grenze
  sonst über Kind-Prozesse umgehbar wäre.
