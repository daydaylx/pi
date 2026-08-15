# Runtime-Matrix

| Komponente          | Gepinnte Version / Wert               | Verifikation                                                         |
| ------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| Pi-Runtime          | `0.84.2`                              | installiertes globales Paket und `pi --version`                      |
| Pi-Dev-Abhängigkeit | `0.84.2`                              | exaktes lokales Manifest/Lock; `/setup-doctor` meldet die Abweichung |
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
die gepinnte Entwicklungsabhängigkeit stehen beide auf `0.84.2`. Weicht eine der beiden
künftig wieder ab, laufen Typen und Tests gegen eine andere API als die produktiv
ausgeführte — Abweichungen im Laufzeitverhalten sind dann möglich. `/setup-doctor` hält
eine solche Abweichung sichtbar; siehe `docs/RUNTIME_PATCHES.md` für das Vorgehen bei
einem Runtime-Upgrade.

LSP-Binärdateien sind Host-Voraussetzungen, keine verwalteten Abhängigkeiten. Fehlende
Binärdateien müssen einen strukturierten Soft-Fehler erzeugen und dürfen niemals eine
automatische Installation auslösen.

## Rollback

Aurora wird nur über `settings.json` aktiviert: die lokale Aurora-Extension,
Theme und Entfernung der früheren UI-Paketquellen. Die vorherigen Paket-/Extension-
Allowlists wiederherstellen, um zum früheren Cockpit zurückzukehren. Plan-Markdown,
Plan-Markdown, Authentifizierung und Sitzungen werden vom UI-Wechsel nicht migriert.
