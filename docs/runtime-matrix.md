# Runtime-Matrix

| Komponente          | Gepinnte Version / Wert               | Verifikation                                                         |
| ------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| Pi-Runtime          | `0.84.3`                              | installiertes globales Paket und `pi --version`                      |
| Pi-Dev-Abhängigkeit | `0.84.3`                              | exaktes lokales Manifest/Lock; `/setup-doctor` meldet die Abweichung |
| Node.js             | `22.23.2`                             | `node --version`                                                     |
| npm                 | `10.9.8`                              | `npm --version`                                                      |
| Aurora UI           | lokales TypeScript                    | Typecheck, Lifecycle- und responsive Render-Tests                    |
| Aurora-Theme        | lokales `aurora-night`                | Truecolor- und 256-Farb-Theme-Laden                                  |
| Planmodus           | lokales TypeScript                    | Modus-, Prompt- und Permission-Grant-Tests                           |
| LSP                 | lokales TypeScript                    | Fake-Server-Transport-, Dokument- und Tool-Suiten                    |
| pi-subagents        | siehe `settings.json` (`packages`)    | exakter Laufzeitpaket-Pin                                            |
| Betriebssystem      | Linux                                 | CI und lokale Verifikation                                           |
| Terminals           | schmales, normales und breites Layout | responsive UI-Harness                                                |

## Release-Gate

`npm run verify` muss ohne bekannte Fehlschläge bestehen. Die installierte Pi-Runtime und
die gepinnte Entwicklungsabhängigkeit stehen beide auf `0.84.3`. Weicht eine der beiden
künftig wieder ab, laufen Typen und Tests gegen eine andere API als die produktiv
ausgeführte — Abweichungen im Laufzeitverhalten sind dann möglich. `/setup-doctor` hält
eine solche Abweichung sichtbar; siehe `docs/RUNTIME_PATCHES.md` für das Vorgehen bei
einem Runtime-Upgrade.

**Pin-Bump bei `git:`-Packages (z. B. `pi-subagents`) reicht allein nicht.** Pi löst
`git:`-Einträge aus `settings.json`s `packages` gegen ein eigenes Cache-Verzeichnis auf
(`<agentDir>/git/<host>/<path>`, hier `/home/d/.pi/agent/git/github.com/daydaylx/pi-subagents`)
— getrennt vom Entwickler-Checkout, in dem der neue Commit entsteht und gepusht wird.
Existiert der Cache-Ordner bereits, installiert Pi beim Sessionstart nichts nach: ein
geänderter Pin in `settings.json` wird stillschweigend ignoriert, solange niemand explizit
synchronisiert. Nach jedem Pin-Bump zusätzlich ausführen:

```sh
pi update git:github.com/daydaylx/pi-subagents
```

(oder `pi update --extensions` für alle Git-Packages), danach in der laufenden Session
`/reload`. Ohne diesen Schritt bleibt der alte Cache-Stand aktiv und neue Slash-Commands
aus dem gepushten Commit fehlen — sie gehen dann als normaler Chat-Prompt statt als
Command-Aufruf raus.

LSP-Binärdateien sind Host-Voraussetzungen, keine verwalteten Abhängigkeiten. Fehlende
Binärdateien müssen einen strukturierten Soft-Fehler erzeugen und dürfen niemals eine
automatische Installation auslösen.

## Rollback

Aurora wird nur über `settings.json` aktiviert: die lokale Aurora-Extension,
Theme und Entfernung der früheren UI-Paketquellen. Die vorherigen Paket-/Extension-
Allowlists wiederherstellen, um zum früheren Cockpit zurückzukehren. Plan-Markdown,
Plan-Markdown, Authentifizierung und Sitzungen werden vom UI-Wechsel nicht migriert.
