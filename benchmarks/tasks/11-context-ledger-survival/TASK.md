# Aufgabe 11 — Context-Ledger-Survival

## Ausgangszustand

Commit `7b886a3` (`harness/reset-task.sh 11-context-ledger-survival`). Kein
Patch. Die Session läuft mit aktiver `plan-mode`-Ledger-Automatik
(`docs/CONTEXT_LEDGER.md`).

## Auftrag (mehrstufig, wörtlich an den Agenten, in dieser Reihenfolge über

mehrere Turns, bewusst in EINER langen Sitzung — kein Neustart zwischen den
Etappen)

1. Decision-Intake: "Wir legen fest: neue LSP-Server-Profile sind
   **standardmäßig deaktiviert** (`enabled: false`). Bestätige diese
   Entscheidung und halte als **Nicht-Ziel** fest, dass bestehende Profile
   (`typescript`, `python`, `go`, `rust`, `c`, `java`) in dieser Aufgabe **nicht**
   verändert werden." (führt zu einem Decision Brief → Ledger-Checkpoint)
2. "Architektur-Detail: Das neue Profil `zig` verwendet den Server `zls` mit
   `rootMarkers: ["build.zig"]`. Halte das als Architekturentscheidung fest."
3. "Setze das um: füge in `extensions/lsp/server-profiles.ts` das Profil `zig`
   hinzu (`enabled: false`, Server `zls`, `rootMarkers: ["build.zig"]`,
   Sprachzuordnung `.zig` → `{ profileId: "zig", languageId: "zig" }`) und
   ergänze einen Regressionstest in `tests/run.mjs` analog zu den bestehenden
   Server-Profil-Tests." (lange Umsetzung, löst realistisch Compaction aus)
4. "Fasse am Ende zusammen: (a) welche Entscheidung wir getroffen haben, (b)
   welches Nicht-Ziel gilt, (c) welche Architekturentscheidung für `zig` gilt und
   (d) welche Todos noch offen sind."

## Erlaubter Änderungsumfang

`extensions/lsp/server-profiles.ts`, `tests/run.mjs` (nur Ergänzung),
`docs/CONTEXT_LEDGER.md` (automatisch durch plan-mode).

## Erwartetes Ergebnis

Alle vier Etappen werden bearbeitet. Etappe 4 (nach potenzieller Compaction)
gibt **korrekt und ohne Widerspruch** die bestätigte Entscheidung, das
Nicht-Ziel und die Architekturentscheidung wieder — insbesondere wird das
`zig`-Profil weiterhin als `enabled: false` beschrieben und die bestehenden
Profile bleiben unverändert. `docs/CONTEXT_LEDGER.md` enthält die Entscheidung,
das Nicht-Ziel und die Architekturentscheidung.

## Abbruchbedingungen

- Nach einer Compaction fehlt oder widerspricht eine der drei dauerhaften
  Fakten (Entscheidung, Nicht-Ziel, Architekturentscheidung), oder das
  `zig`-Profil wird fälschlich als aktiviert beschrieben.
- Der Agent behauptet in Etappe 4 Fakten, die weder im Ledger noch im
  Decision Brief noch im Plan belegt sind (Halluzination).

## Bewertungskriterien

- (a) Alle vier Etappen erledigt.
- (b) **Entscheidungs-Persistenz nach Compaction** — Messgröße 13: bestätigte
  Entscheidung, Nicht-Ziel und Architekturentscheidung sind im finalen Turn und
  in `docs/CONTEXT_LEDGER.md` unverändert vorhanden.
- (c) **Projektstatus-Korrektheit** — Messgröße 14: berichtete offene vs.
  erledigte Todos stimmen mit Plan/Progress überein.
- (d) **Halluzinationsrate** — Messgröße 15: Anzahl unbelegter Behauptungen im
  Abschluss-Turn.
- (e) Anzahl Compactions im Session-Log (Vergleichsgröße zu Aufgabe 08).

## A/B-Vergleich

Denselben Auftrag einmal mit aktiver Ledger-Automatik und einmal mit
deaktivierter Automatik ausführen (siehe `RUNBOOK.md`). Erwartung: Messgröße 13
steigt, Messgröße 15 sinkt, bei neutralem Tokenverbrauch (Messgröße 7), weil die
Automatik keinen zusätzlichen Modell-Turn erzeugt.
