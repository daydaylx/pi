# Aufgabe 08 — Lange Sitzung mit Compaction

## Ausgangszustand

Commit `7b886a3` (`harness/reset-task.sh 08-long-session-compaction`). Kein
Patch.

## Auftrag (mehrstufig, wörtlich an den Agenten, in dieser Reihenfolge über

mehrere Turns)

1. "Lies `extensions/lsp/server-profiles.ts` und `extensions/lsp/roots.ts`
   und fasse das Zusammenspiel in eigenen Worten zusammen."
2. "Füge ein neues, standardmäßig deaktiviertes Profil `zig` hinzu (Server
   `zls`, `rootMarkers: ["build.zig"]`, Sprachzuordnung `.zig` →
   `{ profileId: "zig", languageId: "zig" }`)."
3. "Ergänze einen Regressionstest analog zu den bestehenden Server-Profil-
   Tests in `tests/run.mjs` (siehe z. B. die Assertions zu `rust.enabled ===
false` in der Section 'LSP transport, process and lifecycle', Zeile
   ~4269)."
4. "Fasse am Ende zusammen, was in dieser Sitzung geändert wurde und ob noch
   etwas fehlt."

Diese vier Etappen sind bewusst in einer einzigen, langen Sitzung zu
bearbeiten (kein Neustart zwischen den Etappen), um die
`compaction`-Konfiguration aus `settings.json` (`reserveTokens: 32768`,
`keepRecentTokens: 12000`) realistisch auszulösen.

## Erlaubter Änderungsumfang

`extensions/lsp/server-profiles.ts`, `tests/run.mjs` (nur Ergänzung, keine
bestehende Assertion verändern).

## Erwartetes Ergebnis

Alle vier Etappen werden bearbeitet. Etappe 4 (Abschlusszusammenfassung,
potenziell nach einer Compaction) enthält weiterhin korrekt alle
vorherigen Anforderungen — insbesondere keine "vergessene" Etappe 3
(Regressionstest) oder ein falsch dargestellter Zwischenstand.

## Relevante Tests

Neuer Test schlägt fehl, wenn das `zig`-Profil fehlt oder falsch
konfiguriert ist (insbesondere `enabled: true` statt `false` — Sicherheits-
Konvention aller neuen Server-Profile, siehe Kommentar
`extensions/lsp/server-profiles.ts` Zeile 7: "Go, Rust, C/C++, Java: default
`enabled: false` / opt-in only").

## Verbotene Änderungen

- Aktivieren des `zig`-Profils per Default (`enabled: true`).
- Ändern bestehender Profile (`typescript`, `python`, `go`, `rust`, `c`,
  `java`).
- Bestehende Assertions in `tests/run.mjs` verändern.

## Abbruchbedingungen

- Nach einer Compaction fehlt eine der vier Etappen oder wird
  widersprüchlich zur ursprünglichen Vorgabe umgesetzt (z. B. `zig`-Profil
  wird in Etappe 4 als "aktiviert" beschrieben, obwohl es `enabled: false`
  sein muss).

## Bewertungskriterien

- (a) Alle vier Etappen erledigt.
- (b) **Verlorene Anforderungen nach Compaction** (Kernmetrik dieser
  Aufgabe) — Vergleich Auftragstext vs. finales Diff/Antwort, siehe
  `SCORING.md` Messgröße 11.
- (c) Anzahl Compactions im Session-Log (`custom`-Einträge mit
  entsprechendem `customType`, oder expliziter `/compact`-Aufruf).
- (d) Tokenverbrauch im Verhältnis zu Aufgabe 04 (Vergleichsgröße für
  Overhead durch eine lange Sitzung mit mehreren Etappen gegenüber einer
  kürzeren Multi-Datei-Aufgabe).
