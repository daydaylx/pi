# Task-Contract und Scope-Kontrolle (`.agent/task-contract.json`)

> Kompakter, maschinenlesbarer Arbeitsvertrag auch für direkte Aufgaben.
> Issue: [#106](https://github.com/daydaylx/pi/issues/106) — liefert dem
> [`/verify-gate`](verification-gate.md) (#102) die Grundlage für echtes
> Scope-Drift und Erkennung verlorener Anforderungen.

## Zweck

Vor dem Abschluss soll erkennbar sein, ob Dateien **außerhalb des beabsichtigten
Scopes** geändert wurden (Scope-Drift) und ob **Anforderungen offen oder gebrochen**
sind. Das Advisory-Gate (#102) kann ohne Task-Contract nur „alle geänderten Dateien"
melden; mit Contract liefert es echtes Drift-Urteil.

## Keine zweite Zustandsmaschine

Der Task-Contract **referenziert** die aktive `planId` (falls ein Plan
vorhanden), speichert aber **keine** Workflow-Übergänge. Er berührt
`extensions/plan-mode/state.ts` (CAS-locked, v1/v2-Migration) nicht. Für direkte
Aufgaben ohne Plan bleibt der Contract standalone.

## Datenmodell (`.agent/task-contract.json`)

```jsonc
{
  "goal": "Fix login redirect loop",
  "acceptanceCriteria": [
    { "criterion": "redirect loop resolved", "status": "pending" },
    { "criterion": "existing tests pass",    "status": "met" }
  ],
  "expectedScope": ["src/auth/**/*.ts"],
  "nonGoals": ["no UI redesign"],
  "verification": ["typecheck", "test"],
  "assumptions": ["root cause is in auth middleware"],
  "planId": "abc-123",
  "source": "plan"
}
```

| Feld | Typ | Hinweis |
|---|---|---|
| `goal` | string (Pflicht) | Kompaktes Ziel. |
| `acceptanceCriteria[]` | `{criterion, status}` | `status`: `pending` (default) / `met` / `broken`. |
| `expectedScope[]` | string[] | Pfade/Globs; wird gegen den Git-Diff geprüft. |
| `nonGoals[]` | string[] | Explizite Abgrenzungen. |
| `verification[]` | string[] | Namen der erwarteten Checks (Setup-Namen + #105-Profile). |
| `assumptions[]` | string[] | Nutzerannahmen – **getrennt** von bestätigten Vorgaben. |
| `planId` | string? | Referenz auf den aktiven Plan (optional, ohne Zustand). |
| `source` | `"direct"` \| `"plan"` | Herkunft des Contracts. |

## Scope-Matching

`expectedScope` unterstützt:
- exakte Pfade (`src/a.ts`),
- Verzeichnis-Prefix (`src/`),
- minimale Globs: `*` (ein Segment), `**` (segmentübergreifend), `?` (ein Zeichen).

Der Gate vergleicht die geänderten Working-Tree-Dateien gegen `expectedScope` und
liefert:
- **inScope** – geänderte Dateien im deklarierten Scope,
- **outOfScope** – geänderte Dateien **außerhalb** (Drift → Scope-Hinweis),
- **undeclared** – deklarierter Scope ohne Änderung (möglicherweise unvollständig).

## Validierung (fail-closed)

Unbekannte Schlüssel und falsche Typen werden als Diagnose gemeldet; fehlerhafte
Felder fallen auf sichere Defaults zurück. Der Contract bleibt nutzbar, damit
Ziel und Kriterien nicht durch einen Tippfehler verloren gehen.

## Nutzung mit dem Gate

Ist ein Task-Contract vorhanden, zeigt `/verify-gate` zusätzlich:
- den **Auftrag** (`goal`) im Bericht,
- **Scope-Drift** (out-of-Scope-Dateien) als Scope-Hinweis,
- **offene/broken Acceptance-Kriterien** als Restrisiken („verlorene
  Anforderungen").

Der Gate-Status (pass/fail/blocked) bleibt advisory – Drift blockiert nicht
automatisch (Hard-Enforcement ist ein Folge-Schritt).

## Lebenszyklus

- **Anlegen:** der Agent leitet den Contract kompakt aus dem Nutzerauftrag oder
  dem bestätigten Plan ab (Skill/Prompt-Aufgabe, nicht automatisches Code).
- **Speichern:** `saveTaskContract(cwd, contract)` → `.agent/task-contract.json`.
- **Archivieren/Verwerfen:** nach Abschluss `clearTaskContract(cwd)`. Die Datei
  ist flüchtig und wird nicht committet.
