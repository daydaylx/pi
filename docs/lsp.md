# LSP-Integration (Nutzer-Doku)

> Optional, read-only, projektbezogene Language-Server-Integration.
> Epic: [#92](https://github.com/daydaylx/pi/issues/92).
> Architektur- und Implementierungshintergrund: [`LSP_INTEGRATION_PLAN.md`](LSP_INTEGRATION_PLAN.md).

Pi kann über das Language Server Protocol semantische Codeinformationen
einholen: Diagnosen, Definitionen, Referenzen, Hover-Informationen und
Workspace-Symbole. Die Integration ist **standardmäßig aktiv, startet aber
keinen Server**, bevor nicht ein `lsp_*`-Werkzeug tatsächlich aufgerufen wird
(Lazy-Start, Modus `auto`).

## Aktivierung und Steuerung

| Aktion | Befehl | Wirkung |
|---|---|---|
| Status anzeigen | `/lsp` oder `/lsp status` | Zeigt Zustand und alle laufenden Server. |
| Aktivieren | `/lsp on` | LSP für die Session aktivieren. |
| Deaktivieren | `/lsp off` | LSP deaktivieren und **alle Server sofort stoppen**. |
| Neustart | `/lsp restart [id]` | Server stoppen; sie werden beim nächsten Bedarf neu gestartet. Ohne `id` alle. |
| Server auflisten | `/lsp servers` | Alle aktiven Server mit Zustand und PID. |
| Log anzeigen | `/lsp log` | Kürzliche LSP-Logeinträge. |

Statuswerte in der Fußzeile (Aurora): `leerlauf` (aktiviert, kein Server
läuft), `N aktiv` (N Server bereit), `eingeschränkt` (ein Server ist
*degraded*), `aus` (deaktiviert oder Modus `off`).

## Werkzeuge (read-only)

- `lsp_diagnostics` – Compiler-/Linter-Diagnosen für eine Datei.
- `lsp_definition` – Sprung zur Definition.
- `lsp_references` – Referenzen auf ein Symbol.
- `lsp_hover` – Typ-/Dokumentationsinformation.
- `lsp_workspace_symbols` – Symbolsuche im Workspace.

Schreibende Operationen (Rename, Code Actions, Formatierung, Completion) sind
in dieser Version bewusst **nicht** enthalten.

## Projektvertrauen und Trust-Gates

- Projektlokale Konfiguration (`.pi/lsp.json`) wird **nur in vertrauenswürdigen
  Projekten** gelesen. In nicht vertrauenswürdigen Projekten gelten
  ausschließlich sichere globale Defaults und explizite Session-Entscheidungen.
- Kommando und Argumente werden strikt getrennt ausgeführt; es gibt **keine
  Shell-Konstruktion** aus Projektwerten (`args` ist ein begrenztes
  String-Array, max. 12 Einträge).
- Fehlende Binaries sind kein globaler Pi-Fehler – das jeweilige Profil
  degradiert kontrolliert (`missing_binary`).

## Konservative Defaults

- **TypeScript/JavaScript**: automatisch aktiv, aber *Automatic Type
  Acquisition* deaktiviert und `maxTsServerMemory` begrenzt.
- **Python**: automatisch aktiv, keine unsichere Ausführung.
- **Go, Rust, C/C++, Java**: standardmäßig **`enabled: false`** (opt-in),
  weil diese Server Toolchain-Kommandos ausführen oder ressourcenintensiv sind.
- **Rust** (falls aktiviert): Cargo-Build-Skripte und Proc-Macros bleiben
  aus Sicherheitsgründen deaktiviert.

## Server-Matrix

| Sprache | Profil-ID | Kommando | Default | Hinweis |
|---|---|---|---|---|
| TypeScript / JavaScript | `typescript` | `typescript-language-server --stdio` | aktiv | Benötigt `typescript-language-server` + `typescript` (global). |
| Python | `python` | `pyright-langserver --stdio` | aktiv | Benötigt `pyright` (z. B. `npm i -g pyright`). |
| Go | `go` | `gopls` | **opt-in** | Kann Toolchain-Kommandos ausführen; nicht in nicht vertrauten Projekten aktivieren. |
| Rust | `rust` | `rust-analyzer` | **opt-in** | Build-Skripte/Proc-Macros standardmäßig deaktiviert. |
| C / C++ | `c` | `clangd` | **opt-in** | Benötigt eine `compile_commands.json`; ohne diese sind die Ergebnisse schwach. |
| Java | `java` | `eclipse.jdt.ls` | **opt-in** | Benötigt Java-Runtime + JDT-LS; ressourcenintensiv. |

Echte Server werden **nicht** automatisch installiert. Smoke-Tests gegen echte
Server laufen im separaten Workflow `.github/workflows/lsp-smoke.yml` (manuell
oder wöchentlich), nicht im PR-Gate.

## Projektlokale Konfiguration: `.pi/lsp.json`

Nur in vertrauenswürdigen Projekten gelesen. Siehe kommentiertes Beispiel unter
[`lsp.example.json`](lsp.example.json).

```jsonc
{
  "enabled": true,
  "mode": "auto",                 // "off" | "auto" | "force"
  "requestTimeoutMs": 10000,      // 1000–120000
  "idleShutdownMs": 600000,       // 10000–3600000 (Server-Idle-Shutdown)
  "workspaceSymbolLimit": 50,     // 1–500
  "languages": {
    "typescript": { "enabled": true },
    "python":     { "enabled": true },
    "rust":       { "enabled": false }
  }
}
```

`languages.*` kann ein eingebaututes Profil überschreiben (`enabled`, `command`,
`args`, `rootMarkers`). Unbekannte Profil-IDs werden als vollständig eigenes
Profil behandelt.

## Troubleshooting

| Symptom | Ursache | Behebung |
|---|---|---|
| `Server-Binärdatei installieren ('…')` | Profil aktiv, Binary fehlt | Server global installieren oder Profil in `.pi/lsp.json` deaktivieren. |
| Status `aus`, trotz `.pi/lsp.json` | Projekt nicht vertrauenswürdig | Projekt vertrauen oder Werte global/über Session-Flag setzen. |
| Status `eingeschränkt` | Server gecrasht / nicht erholt | `/lsp restart` oder Binary-Version prüfen; `/lsp log` zeigt Details. |
| Diagnosen veraltet | externe Änderung nicht synchronisiert | Datei in Pi erneut öffnen/speichern oder `lsp_diagnostics` erneut aufrufen. |
| Symlink abgelehnt | Schutzregel | Stattdessen das echte Ziel prüfen. |
| Datei zu groß | Schutzregel | Große Dateien nicht via LSP prüfen. |

## Migration

LSP ist bereits Teil des Setups. Aktivierung reicht:

1. Setup so belassen (LSP ist per Default `enabled` mit Modus `auto`).
2. Bei Bedarf `.pi/lsp.json` im vertrauten Projekt ablegen (Beispiel siehe oben).
3. Server global installieren, die man nutzen möchte.

Ohne Aktivierung (kein `lsp_*`-Aufruf) entsteht kein Prozess und keine
Verhaltensänderung.

## Rollback

- **Pro Session deaktivieren:** `/lsp off`.
- **Projektbezogen deaktivieren:** in `.pi/lsp.json` `"enabled": false` oder
  `mode: "off"`.
- **Vollständig entfernen:** den Eintrag `+extensions/lsp/index.ts` aus
  `settings.json` streichen. Dadurch wird LSP vollständig abgeschaltet, ohne
  eine andere Extension zu berühren. Die LSP-Dependencies können zusätzlich
  entfernt werden, falls LSP dauerhaft ungenutzt bleibt.
