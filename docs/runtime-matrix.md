# Runtime-Matrix

| Komponente          | Gepinnte Version / Wert                                          | Verifikation                                                         |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Pi-Runtime          | `0.80.7`                                                         | installiertes globales Paket und `pi --version`                      |
| Pi-Dev-Abhängigkeit | `0.80.6`                                                         | exaktes lokales Manifest/Lock; `/setup-doctor` meldet die Abweichung |
| Node.js             | `22.22.2`                                                        | `node --version`                                                     |
| npm                 | `10.9.7`                                                         | `npm --version`                                                      |
| Aurora UI           | lokales TypeScript                                               | Typecheck, Lifecycle- und responsive Render-Tests                    |
| Aurora-Theme        | lokales `aurora-night`                                           | Truecolor- und 256-Farb-Theme-Laden                                  |
| Plan-Workflow       | lokales TypeScript                                               | Lifecycle-, Sidecar- und `plan_progress`-Tests                       |
| LSP                 | lokales TypeScript                                               | Fake-Server-Transport-, Dokument- und Tool-Suiten                    |
| pi-subagents        | `daydaylx/pi-subagents@dd716cfc8c3a9b0ee35632752ac2b1736cd7de61` | exakter Laufzeitpaket-Pin                                            |
| Betriebssystem      | Linux                                                            | CI und lokale Verifikation                                           |
| Terminals           | schmales, normales und breites Layout                            | responsive UI-Harness                                                |

## Release-Gate

`npm run verify` muss ohne bekannte Fehlschläge bestehen. Die aktuell installierte Pi-
Runtime und die gepinnte Entwicklungsabhängigkeit unterscheiden sich noch um eine Patch-
Version; eine Angleichung erfordert eine ausdrücklich freigegebene Abhängigkeitsaktualisierung
und Lockfile-Auffrischung. Bis dahin hält `/setup-doctor` die Abweichung sichtbar.

LSP-Binärdateien sind Host-Voraussetzungen, keine verwalteten Abhängigkeiten. Fehlende
Binärdateien müssen einen strukturierten Soft-Fehler erzeugen und dürfen niemals eine
automatische Installation auslösen.

## Rollback

Aurora wird nur über `settings.json` aktiviert: die lokale Aurora-Extension,
Theme und Entfernung der früheren UI-Paketquellen. Die vorherigen Paket-/Extension-
Allowlists wiederherstellen, um zum früheren Cockpit zurückzukehren. Plan-Markdown,
Sidecars, Authentifizierung und Sitzungen werden vom UI-Wechsel nicht migriert.
