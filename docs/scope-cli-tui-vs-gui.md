# Scope: CLI/TUI und externe Frontends

Dieses Repository enthält die Pi-Core-Konfiguration und die Terminal-UI Aurora.
Eine Electron-Desktop-App ist nicht Bestandteil dieses Projekts. Externe
Frontends greifen über `bin/pi-frontend` auf die versionierte JSONL-API zu;
Details stehen in `docs/frontend-api.md` und `docs/architecture.md`.

## CLI/TUI

| Pfad | Inhalt |
| --- | --- |
| `bin/pi-frontend` | Einstiegspunkt für die Frontend-API |
| `extensions/aurora-ui/` | Terminal-UI Aurora |
| übrige `extensions/` | Core-Funktionen und gemeinsame State-Provider |
| `skills/`, `themes/`, `prompts/`, `schemas/` | Core-Konfiguration und Assets |
| `agents/` | Technisches Verifier-Profil (`verifier.md`) |
| `docs/decisions/`, `docs/subagents.md`, `docs/verify-profiles.md`, `docs/context-management.md`, `docs/runtime-matrix.md`, `docs/lsp.md` | Core-Referenzdokumentation |
| `tests/` | Core-, TUI- und Runtime-Tests |

## Gemeinsame Frontend-Schnittstellen

| Pfad | Inhalt |
| --- | --- |
| `extensions/frontend-protocol/` | Interner State-Bus-Vertrag und gemeinsame Zustandshelfer für Core-Extensions und Aurora |
| `extensions/frontend-bridge/` | Projiziert Core-State in Session-Einträge, die der Frontend-Server über die Runtime-API bereitstellt |
| `npm/packages/frontend-protocol/` | Separates, öffentliches JSONL-Wire-Protokoll (`@daydaylx/pi-frontend-protocol`) |
| `frontend-server/` | Adapter von Pi-RPC zur öffentlichen JSONL-API |

Die beiden Protokoll-Ebenen sind verschieden: Das interne State-Bus-Modul ist
keine Kopie des öffentlichen JSONL-Vertrags. Beide bleiben erforderlich; die
konkrete Desktop-Oberfläche liegt außerhalb dieses Repositories.
