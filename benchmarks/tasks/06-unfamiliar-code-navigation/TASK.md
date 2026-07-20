# Aufgabe 06 — Navigation in unbekanntem Code

## Ausgangszustand

Commit `7b886a3` (`harness/reset-task.sh 06-unfamiliar-code-navigation`).
Kein Patch. Kein Hinweis auf betroffene Dateien im Auftrag (bewusst — der
Agent muss selbst navigieren).

## Auftrag (wörtlich an den Agenten)

> Wenn ein Projekt sowohl `go.mod` als auch `package.json` im selben
> Verzeichnis hat: Welcher LSP-Server wird für eine `.go`-Datei gestartet,
> und in welchem Verzeichnis wird sein Workspace-Root verortet? Belege die
> Antwort mit Dateien und Zeilen. Ändere keinen Code, beantworte nur die
> Frage.

## Erlaubter Änderungsumfang

Keiner (Read-only-Aufgabe). Erwartete Werkzeuge: `grep`/`read`, optional
`lsp`-Tools. Keine Schreibzugriffe.

## Referenzantwort (vorab fixiert, vor dem ersten Lauf)

- `extensions/lsp/server-profiles.ts` Zeile 27–43
  (`EXTENSION_LANGUAGE_MAP`): `.go` → `{ profileId: "go", languageId: "go" }`
  (Zeile 36).
- `extensions/lsp/server-profiles.ts` Zeile 69–78 (`PROFILES.go`):
  `rootMarkers: ["go.mod", "go.sum", ".go"]` (Zeile 75), `enabled: false`
  (Zeile 72).
- `extensions/lsp/roots.ts`, Funktion `findWorkspaceRoot` (Zeile 25–49):
  läuft von der Datei aus **aufwärts** und nimmt den ersten Treffer aus den
  **Root-Markern des jeweiligen Profils** — nicht generisch "das nächste
  Projekt-Root". Für eine `.go`-Datei werden ausschließlich `go.mod`,
  `go.sum`, `.go` geprüft, `package.json` spielt für diesen Profilaufruf
  keine Rolle.
- Kernaussage: Das Go-Profil würde ohne expliziten Opt-in **gar keinen**
  Server starten, da `enabled: false` (Zeile 72) der Default ist (siehe auch
  Kommentar Zeile 7: "Go, Rust, C/C++, Java: default `enabled: false` /
  opt-in only").

Eine korrekte Antwort muss mindestens folgende drei Kernaussagen enthalten
und mit Datei+Zeile belegen: (1) welches Profil für `.go` zuständig ist und
welche Root-Marker es nutzt, (2) dass `findWorkspaceRoot` nur die Marker des
zutreffenden Profils prüft (nicht `package.json`), (3) dass das Profil
standardmäßig deaktiviert ist.

## Relevante Tests

Keine (reine Analyseaufgabe). Bewertung erfolgt gegen die oben fixierte
Referenzantwort.

## Verbotene Änderungen

Jede Datei-Änderung disqualifiziert den Lauf für dieses Aufgabenziel
(Navigation, nicht Implementierung).

## Abbruchbedingungen

- Agent versucht ungefragt einen Fix/eine Änderung vorzunehmen.
- Agent beantwortet ohne Beleg (keine Datei/Zeile genannt).

## Bewertungskriterien

- (a) Korrekte Kernaussage (Go-Profil, dessen Root-Marker, `enabled:false`-
  Hinweis) — Abgleich gegen die Referenzantwort oben.
- (b) Belegqualität: Datei+Zeile statt Vermutung.
- (c) Anzahl der Lese-Tool-Aufrufe bis zur Antwort — Nebenmetrik zur
  Navigationseffizienz, kein Ausschlusskriterium.
