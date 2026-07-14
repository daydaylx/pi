# LSP-Integration für Pi

> Status: **v1 implementiert und aktiv (#93–#97 abgeschlossen); #98 (CI-Smoke mit echten Servern, ausführliche Doku/Troubleshooting) offen**  
> Epic: [#92 – Optionale LSP-Integration für Pi](https://github.com/daydaylx/pi/issues/92)  
> Zielpfad der Extension: `extensions/lsp/`

## 1. Entscheidung

Die LSP-Integration wird als **optionale, read-only, projektbezogene Pi-Extension** umgesetzt.

Sie darf das bestehende minimalistische Setup nicht in eine schwergewichtige IDE-Schicht verwandeln. Language Server werden deshalb nur bei Bedarf gestartet, pro Workspace wiederverwendet und nach Inaktivität beendet. Projektlokale LSP-Konfiguration wird ausschließlich in vertrauenswürdigen Projekten gelesen.

Die erste Version beschränkt sich auf fünf Funktionen:

1. Diagnosen
2. Definitionen
3. Referenzen
4. Hover-Informationen
5. Workspace-Symbole

Rename, Code Actions, Formatierung, Completion, Signature Help, Inlay Hints und Debug Adapter Protocol gehören ausdrücklich nicht zur ersten Version.

## 2. Verknüpfte Issues

| Reihenfolge | Issue                                           | Inhalt                                                | Abhängigkeit | Status                                |
| ----------: | ----------------------------------------------- | ----------------------------------------------------- | ------------ | ------------------------------------- |
|           0 | [#92](https://github.com/daydaylx/pi/issues/92) | Epic und Gesamtsteuerung                              | –            | v1 abgeschlossen (#93–#97), #98 offen |
|           1 | [#93](https://github.com/daydaylx/pi/issues/93) | Transport, Prozessverwaltung und Lifecycle            | –            | erledigt                              |
|           2 | [#94](https://github.com/daydaylx/pi/issues/94) | Konfiguration, Root-Erkennung und Server-Registry     | #93          | erledigt                              |
|           3 | [#95](https://github.com/daydaylx/pi/issues/95) | Dokument-Synchronisation und Diagnosen                | #93, #94     | erledigt                              |
|           4 | [#96](https://github.com/daydaylx/pi/issues/96) | Definitionen, Referenzen, Hover und Workspace-Symbole | #95          | erledigt                              |
|           5 | [#97](https://github.com/daydaylx/pi/issues/97) | Steuerung, Status, Trust-Gates und Permissions        | #94–#96      | erledigt                              |
|           6 | [#98](https://github.com/daydaylx/pi/issues/98) | Tests, CI-Smokes, Dokumentation und Migration         | alle         | offen                                 |

## 3. Ziel

Pi soll semantische Codeinformationen direkt aus etablierten Language Servern abrufen können. Dadurch soll der Agent bei größeren Projekten weniger auf unpräzise Textsuche angewiesen sein und zuverlässiger beantworten können:

- Wo ist ein Symbol definiert?
- Welche Stellen referenzieren ein Symbol?
- Welche Typ- oder Dokumentationsinformation liefert der Server?
- Welche Fehler und Warnungen erkennt die Sprache?
- Welche Symbole existieren im Workspace?

Die Integration soll transparent, kontrollierbar und fehlertolerant sein.

## 4. Nicht-Ziele

- Keine Komplett-IDE innerhalb von Pi.
- Keine verpflichtende Installation aller Language Server.
- Kein automatischer Download oder Update externer Server-Binaries.
- Keine Schreib- oder Refactoring-Funktionen in v1.
- Keine globale Aktivierung für jedes geöffnete Projekt.
- Keine unkontrollierten Build-Skripte, Proc-Macros oder Toolchain-Aufrufe.
- Keine Abhängigkeit der normalen Pull-Request-CI von echten Language Servern.
- Kein Umbau der bestehenden Plan-, Work-, Permission- oder Subagent-Architektur.
- Keine dominante neue TUI-Fläche.

## 5. Annahmen

- Das Repository bleibt zunächst Linux-first in der automatisierten Verifikation.
- TypeScript/JavaScript und Python sind die ersten vollständig unterstützten Profile.
- Weitere Server werden architektonisch berücksichtigt, aber schrittweise aktiviert.
- Pi-Extensions bleiben TypeScript-Quellen ohne zusätzliche Build-Pipeline.
- LSP ist standardmäßig aus oder im `auto`-Modus ohne sofortigen Prozessstart.
- Externe Language Server werden vom Nutzer oder Systempaketmanager installiert.

## 6. Architektur

### 6.1 Grundmodell

Die Extension verwaltet langlebige Serverinstanzen nach folgendem Schlüssel:

```text
(workspaceRoot, serverId)
```

Beispiele:

```text
(/home/david/projekte/pi, typescript)
(/home/david/projekte/service, pyright)
```

Für denselben Workspace und denselben Server darf nicht pro Tool-Aufruf ein neuer Prozess gestartet werden. Ein statelesses Spawn-pro-Request-Modell wäre langsam, ressourcenintensiv und würde Server-Caches unbrauchbar machen.

### 6.2 Datenfluss

```text
Pi Tool-Aufruf
    ↓
LSP Tool Adapter
    ↓
Config + Root Detector
    ↓
Server Registry
    ↓
LSP Client / Document Sync
    ↓
stdio + JSON-RPC
    ↓
Language Server
```

### 6.3 Kernkomponenten

Empfohlene Struktur:

```text
extensions/lsp/
├── index.ts
├── types.ts
├── config.ts
├── roots.ts
├── registry.ts
├── process.ts
├── transport.ts
├── client.ts
├── documents.ts
├── capabilities.ts
├── tools.ts
├── status.ts
└── server-profiles.ts
```

Verantwortlichkeiten:

| Datei                | Verantwortung                                                       |
| -------------------- | ------------------------------------------------------------------- |
| `index.ts`           | Extension-Einstieg, Flags, Commands, Lifecycle-Hooks                |
| `types.ts`           | interne Typen und normalisierte Ergebnisstrukturen                  |
| `config.ts`          | Defaults, Projektkonfiguration und Session-Overrides zusammenführen |
| `roots.ts`           | Workspace-Root anhand von Markern bestimmen                         |
| `registry.ts`        | Serverinstanzen pro Root und Server-ID verwalten                    |
| `process.ts`         | Spawn, Shutdown, Restart, Backoff und stderr                        |
| `transport.ts`       | LSP-Framing, JSON-RPC und Request-Korrelation                       |
| `client.ts`          | Initialize, Requests, Notifications und Capability-State            |
| `documents.ts`       | didOpen, didChange, didClose und Dokumentversionen                  |
| `capabilities.ts`    | serverseitige Feature-Unterstützung normalisieren                   |
| `tools.ts`           | Pi-Tools registrieren und Ergebnisse aufbereiten                    |
| `status.ts`          | knappe zentui-/Footer-Zustände                                      |
| `server-profiles.ts` | sprachspezifische Befehle, Marker und sichere Defaults              |

## 7. Tool-Schnittstellen

Die erste Version stellt genau diese Tools bereit:

```text
lsp_diagnostics(path, includeRelated?)
lsp_definition(path, line, character, preferLinks?)
lsp_references(path, line, character, includeDeclaration?, limit?)
lsp_hover(path, line, character, verbosity?)
lsp_workspace_symbols(query, limit?, server?)
```

### 7.1 Ausgabeprinzipien

- Pfade relativ zum Workspace ausgeben, wenn eindeutig.
- Zeilen und Zeichen in der Nutzeranzeige klar kennzeichnen.
- Große Ergebnismengen begrenzen.
- Keine Rohprotokoll-Dumps als normale Tool-Ausgabe.
- Bei mehreren Definitionen nichts stillschweigend auswählen.
- Nicht unterstützte Capabilities als verständlichen Soft-Fail melden.
- Ergebnisse an die aktuelle Dokumentversion binden.

### 7.2 Fehlerformat

Fehler müssen mindestens enthalten:

- Server-ID
- Workspace-Root
- angefragte Methode
- Fehlerklasse
- konkrete Ursache
- mögliche Behebung

Beispiel:

```text
LSP nicht verfügbar: pyright
Grund: `pyright-langserver` wurde nicht im PATH gefunden.
Projekt: /home/user/project
Behebung: Pyright installieren oder das Python-Profil in .pi/lsp.json deaktivieren.
```

## 8. Konfiguration

### 8.1 Priorität

Konfiguration wird in dieser Reihenfolge zusammengeführt:

1. sichere Extension-Defaults
2. globale Pi-Konfiguration, sofern vorgesehen
3. projektlokale `.pi/lsp.json`
4. Session-Flags und `/lsp`-Änderungen

Session-Einstellungen haben die höchste Priorität.

### 8.2 Vertrauensregel

`.pi/lsp.json` darf nur gelesen werden, wenn Pi das Projekt als vertrauenswürdig einstuft. In nicht vertrauenswürdigen Projekten gelten ausschließlich sichere globale Defaults und explizite Session-Entscheidungen.

### 8.3 Beispielkonfiguration

```json
{
  "enabled": true,
  "mode": "auto",
  "requestTimeoutMs": 10000,
  "idleShutdownMs": 600000,
  "workspaceSymbolLimit": 50,
  "languages": {
    "typescript": {
      "enabled": true,
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "rootMarkers": ["tsconfig.json", "jsconfig.json", "package.json"],
      "initializationOptions": {
        "disableAutomaticTypingAcquisition": true,
        "maxTsServerMemory": 1536
      }
    },
    "python": {
      "enabled": true,
      "command": "pyright-langserver",
      "args": ["--stdio"],
      "rootMarkers": [
        "pyrightconfig.json",
        "pyproject.toml",
        "requirements.txt"
      ]
    },
    "rust": {
      "enabled": false,
      "command": "rust-analyzer",
      "args": [],
      "rootMarkers": ["Cargo.toml", "rust-project.json"],
      "settings": {
        "rust-analyzer": {
          "cargo": {
            "buildScripts": {
              "enable": false
            }
          },
          "procMacro": {
            "enable": false
          }
        }
      }
    }
  }
}
```

### 8.4 Flags

Empfohlene Session-Flags:

```text
--lsp
--no-lsp
--lsp-mode=off|auto|force
--lsp-log=off|error|info|trace
--lsp-server=<id>
```

## 9. Serverprofile

| Priorität | Sprache               | Server                                      | Standard in v1  | Ressourcen/Risiko                                  |
| --------: | --------------------- | ------------------------------------------- | --------------- | -------------------------------------------------- |
|         1 | TypeScript/JavaScript | `typescript-language-server` + `typescript` | aktivierbar     | mittel                                             |
|         2 | Python                | `pyright-langserver`                        | aktivierbar     | niedrig bis mittel                                 |
|         3 | Go                    | `gopls`                                     | zunächst opt-in | mittel, kann Toolchain-Befehle ausführen           |
|         4 | Rust                  | `rust-analyzer`                             | deaktiviert     | höher, Build-Skripte/Proc-Macros beachten          |
|         5 | C/C++                 | `clangd`                                    | deaktiviert     | mittel bis hoch, benötigt gutes Compile-Setup      |
|         6 | Java                  | `eclipse.jdt.ls`                            | deaktiviert     | hoch, zusätzliche Java-Runtime und Workspace-Daten |

### 9.1 Sicherheitsdefaults

- TypeScript: automatische Typakquisition deaktivieren.
- Rust: Build-Skripte und Proc-Macros deaktivieren.
- Go: kein automatischer Start in untrusted Projekten.
- Java: kein automatischer Start und eigenes Data-Verzeichnis pro Workspace.
- C/C++: fehlende Compile-Daten klar melden, nicht mit scheinpräzisen Ergebnissen kaschieren.

## 10. Prozess- und Ressourcenmanagement

### 10.1 Lazy Start

Ein Server startet erst, wenn:

- LSP für die Session oder das Projekt aktiviert ist,
- eine passende Datei beziehungsweise Sprache erkannt wurde,
- ein LSP-Tool tatsächlich eine Anfrage stellt.

### 10.2 Idle Shutdown

Standardwert:

```text
10 Minuten ohne Anfrage
```

Der Timer darf bei aktiven Requests nicht auslösen.

### 10.3 Restart-Strategie

- erster unerwarteter Crash: ein automatischer Neustart
- weitere Crashes: exponentieller Backoff
- wiederholte Fehler: Status `degraded`
- manueller Neustart über `/lsp restart`
- keine Endlosschleife

### 10.4 Caching

- Diagnosen pro Dokumentversion speichern.
- Definitionen, Referenzen und Hover nicht über Dokumentversionen hinweg cachen.
- Workspace-Symbole kurzzeitig cachen, beispielsweise 30 Sekunden.
- Capability-Informationen für die Lebensdauer der Serverinstanz speichern.

## 11. Dokument-Synchronisation

Die Dokumentverwaltung ist ein kritischer Teil und darf nicht als Nebenfunktion behandelt werden.

Pflichtregeln:

- Vor `didChange` muss `didOpen` erfolgt sein.
- Versionen steigen monoton.
- Jede relevante Änderung invalidiert versionierte Ergebnisse.
- `didClose` entfernt lokalen Dokumentzustand.
- Externe Dateiänderungen müssen vor einer Anfrage erkannt oder neu eingelesen werden.
- URI- und Pfadnormalisierung muss Linux, macOS und Windows berücksichtigen, auch wenn CI zunächst Linux-first bleibt.

## 12. Bedienung und Status

### 12.1 Command

```text
/lsp status
/lsp on
/lsp off
/lsp restart
/lsp servers
/lsp log
```

### 12.2 Footer

Nur knappe Zustände:

```text
LSP: off
LSP: idle
LSP: 1 active
LSP: degraded
```

Die Anzeige darf nicht mit Workflow-, Permission- oder Subagent-Status konkurrieren.

## 13. Implementierungsphasen

### Phase 1 – Protokollfundament

Issue: [#93](https://github.com/daydaylx/pi/issues/93)

- stdio-Transport
- Content-Length-Framing
- JSON-RPC Request Registry
- Initialize/Shutdown
- Timeout/Cancellation
- Fake-LSP-Server

**Abschluss:** Ein deterministischer Testserver beantwortet Initialize und eine Beispielanfrage; nach Shutdown existiert kein Kindprozess.

### Phase 2 – Registry und Konfiguration

Issue: [#94](https://github.com/daydaylx/pi/issues/94)

- Root-Erkennung
- Serverprofile
- Konfigurationsmerge
- Lazy Start
- Idle Shutdown
- Capability-State

**Abschluss:** Derselbe Workspace verwendet dieselbe Serverinstanz; fehlende Binaries werden sauber als `degraded` behandelt.

### Phase 3 – Dokumente und Diagnosen

Issue: [#95](https://github.com/daydaylx/pi/issues/95)

- didOpen/didChange/didClose
- Versionierung
- publishDiagnostics
- Diagnose-Cache
- `lsp_diagnostics`

**Abschluss:** Dateiänderungen ersetzen alte Diagnosen zuverlässig.

### Phase 4 – Navigation und Symbolsuche

Issue: [#96](https://github.com/daydaylx/pi/issues/96)

- Definition
- Referenzen
- Hover
- Workspace-Symbole
- Limits und Soft-Fallbacks

**Abschluss:** Alle fünf v1-Tools sind stabil und liefern kompakte, agententaugliche Ergebnisse.

### Phase 5 – Governance und UX

Issue: [#97](https://github.com/daydaylx/pi/issues/97)

- `/lsp`
- Flags
- Status-Key
- Trust-Gates
- sichere Serverdefaults
- verständliche Fehlerhinweise

**Abschluss:** LSP ist sichtbar steuerbar, aber nicht dominant und nicht automatisch riskant.

### Phase 6 – Qualität und Einführung

Issue: [#98](https://github.com/daydaylx/pi/issues/98)

- Fake-Server-Tests in PR-CI
- echte Server-Smokes separat
- Dokumentation
- Troubleshooting
- Migration und Rollback

**Abschluss:** Reguläre CI bleibt schnell und reproduzierbar; reale Server können separat geprüft werden.

## 14. Aufwandsschätzung

Die Schätzung ist eine Planungsgröße, keine Zusage.

| Bereich                     |       Aufwand |
| --------------------------- | ------------: |
| Transport und Lifecycle     |          3 PT |
| Registry und Konfiguration  |          2 PT |
| Dokument-Sync und Diagnosen |          2 PT |
| Navigation und Symbolsuche  |          3 PT |
| UX, Trust und Permissions   |          2 PT |
| Fehlerhärtung               |          2 PT |
| Tests und CI                |          2 PT |
| Dokumentation und Migration |          1 PT |
| **Gesamt**                  | **ca. 17 PT** |

Ein schneller Prototyp wäre früher möglich, würde aber gerade bei Prozess-Lifecycle, Dokumentversionierung und Fehlerfällen technische Schulden erzeugen. Diese Abkürzung ist nicht empfohlen.

## 15. Tests und CI

### 15.1 Reguläre CI

Die bestehende Verifikation wird um deterministische Tests mit einem lokalen Fake-LSP-Server erweitert.

Pflichttests:

- Framing bei fragmentierten und kombinierten Nachrichten
- parallele Requests
- Request-Timeout
- Cancellation
- Server-Crash
- Restart-Backoff
- sauberer Shutdown
- didOpen vor didChange
- monotone Dokumentversionen
- Ersatz veralteter Diagnosen
- Capability nicht unterstützt
- fehlendes Binary
- falscher Workspace-Root
- untrusted Projektkonfiguration

### 15.2 Separater Smoke-Workflow

Ein eigener Workflow, beispielsweise `.github/workflows/lsp-smoke.yml`, darf echte Server installieren und testen.

Startumfang:

- TypeScript/JavaScript
- Python

Spätere Matrix:

- Go
- Rust
- C/C++
- Java

Der Smoke-Workflow wird manuell und optional zeitgesteuert ausgeführt. Er darf die normale PR-CI nicht blockieren.

## 16. Risiken

| Risiko                         | Wirkung                          | Gegenmaßnahme                                            |
| ------------------------------ | -------------------------------- | -------------------------------------------------------- |
| fehlende Server-Binaries       | Feature nicht nutzbar            | präzise Installationsmeldung, Status `degraded`          |
| falscher Workspace-Root        | falsche oder fehlende Ergebnisse | Marker konfigurierbar, Root im Status/Log anzeigen       |
| stale Ergebnisse               | Agent erhält falsche Semantik    | strikte Dokumentversionierung und Invalidation           |
| Server hängt                   | Pi-Session blockiert             | Timeout, Cancellation, Kill und Backoff                  |
| hoher RAM-/CPU-Verbrauch       | schlechte Nutzererfahrung        | Lazy Start, Idle Shutdown, Limits, konservative Defaults |
| Build-Skripte oder Proc-Macros | Sicherheitsrisiko                | Trust-Gate und standardmäßig deaktivieren                |
| CI-Flakiness                   | langsame Entwicklung             | Fake-Server in PR-CI, echte Server separat               |
| Scope wächst zu schnell        | instabile Architektur            | v1 strikt read-only halten                               |
| UI wird überladen              | schlechter Workflow              | nur Command und knapper Status                           |
| Cross-Platform-Fehler          | eingeschränkte Nutzbarkeit       | Pfadnormalisierung von Beginn an, spätere Smoke-Matrix   |

## 17. Migration und Rollback

### Migration

- Neue Extension in `settings.json` explizit aufnehmen.
- Status-Key `lsp` in die bestehende Statusstruktur integrieren.
- LSP standardmäßig nicht aktiv starten.
- Nutzer installieren nur die von ihnen benötigten Server.
- Projektkonfiguration ist optional.

### Rollback

Ein sicherer Rollback muss möglich sein durch:

1. Deaktivierung mit `--no-lsp` oder `/lsp off`
2. Entfernen des Extension-Eintrags aus `settings.json`
3. Entfernen des `lsp`-Status-Keys
4. Entfernen der LSP-spezifischen Dependencies

Bestehende Plan-, Work-, Permission- und Subagent-Funktionen dürfen dadurch nicht betroffen sein.

## 18. Direkt nutzbarer Arbeitsauftrag für einen Coding-Agenten

### Rolle

Du bist ein erfahrener TypeScript-/Node.js-Architektur- und Coding-Agent für Pi Coding Agent, Extension-Systeme, Language Server Protocol 3.17, JSON-RPC über stdio, Child-Process-Lifecycle, sichere Projektkonfiguration, Tool-Orchestrierung, TUI-Statusanzeigen und deterministische Tests.

### Ziel

Implementiere die in diesem Dokument geplante optionale LSP-Integration für das Repository `daydaylx/pi` schrittweise entlang der Issues #93 bis #98.

Die erste Version muss genau fünf read-only Funktionen bereitstellen:

1. Diagnosen
2. Definitionen
3. Referenzen
4. Hover-Informationen
5. Workspace-Symbole

Die Integration muss lazy, projektbezogen, fehlertolerant und in nicht vertrauenswürdigen Projekten konservativ sein.

### Nicht-Ziele

- Kein Rename.
- Keine Code Actions.
- Keine automatische Formatierung.
- Keine Completion oder Signature Help.
- Kein automatischer Download von Language Servern.
- Kein globaler Autostart aller Server.
- Keine neue Build-Pipeline für Extensions.
- Kein großer UI-Umbau.
- Keine Änderungen außerhalb des LSP-Scope, sofern sie nicht zwingend für Integration oder Tests erforderlich sind.

### Kontext

- Das Repository verwendet lokale TypeScript-Extensions.
- Erweiterungen werden explizit über die vorhandene Konfiguration geladen.
- Bestehende Statusbereiche für Workflow, Permissions und Subagenten dürfen nicht beschädigt werden.
- Die reguläre CI soll schnell und deterministisch bleiben.
- Echte Language Server gehören nicht als harte Abhängigkeit in jeden Pull Request.
- Projektlokale Konfiguration darf nur in vertrauenswürdigen Projekten gelesen werden.

### Vorgehen

1. Lies zuerst dieses Dokument, das Epic #92 und das aktuell zu bearbeitende Teil-Issue vollständig.
2. Analysiere die aktuellen Extension-, Status-, Test- und Konfigurationsmuster im Repository.
3. Implementiere ausschließlich den Scope des ausgewählten Issues.
4. Verwende eine klare Modultrennung zwischen Transport, Prozess, Client, Dokumenten, Registry, Konfiguration, Tools und Status.
5. Starte Language Server ausschließlich lazy.
6. Verwende eine Instanz pro `(workspaceRoot, serverId)`.
7. Implementiere Timeouts, Cancellation, sauberen Shutdown und begrenzten Restart-Backoff.
8. Binde Ergebnisse an aktuelle Dokumentversionen.
9. Nutze Capability-Erkennung und Soft-Fallbacks.
10. Ergänze für jede Fehlerklasse einen deterministischen Test.
11. Aktualisiere Dokumentation und Issue-Checklisten, wenn ein Arbeitspaket abgeschlossen ist.

### Änderungsregeln

- Keine stillen Änderungen an fremden oder nicht zum Issue gehörenden Dateien.
- Keine Versionsbereiche oder ungepinnten neuen Dependencies, sofern das Repository Pins verlangt.
- Keine Shell-Command-Strings aus Projektkonfiguration zusammensetzen; Kommando und Argumente getrennt ausführen.
- Keine projektlokale LSP-Konfiguration ohne Trust-Prüfung lesen.
- Keine Endlosschleifen bei Server-Restarts.
- Keine Tool-Ausgabe mit ungefilterten Protokoll-Dumps.
- Keine Write-Funktion unter dem Deckmantel eines read-only Tools.
- Bestehende Tests und vorhandenes Verhalten müssen erhalten bleiben.

### Verifikation

Vor Abschluss eines Issues müssen mindestens geprüft werden:

- Typecheck
- bestehende Tests
- neue LSP-spezifische Tests
- Prozessende ohne verwaiste Child-Prozesse
- Fehlerfall bei fehlendem Binary
- Fehlerfall bei Timeout oder Crash
- Trust-Verhalten für projektlokale Konfiguration
- keine unbeabsichtigte Aktivierung ohne LSP-Anfrage

Für Tool-Issues zusätzlich:

- korrekte Pfade und Positionsangaben
- Limits bei großen Ergebnismengen
- Soft-Fail bei fehlender Capability
- keine Ergebnisse aus veralteten Dokumentversionen

### Ausgabeformat

Liefere nach jedem Arbeitspaket:

1. kurze Zusammenfassung der Änderung
2. Liste geänderter Dateien
3. Architekturentscheidungen und Abweichungen vom Plan
4. ausgeführte Tests mit Ergebnis
5. bekannte Restrisiken
6. noch offene Punkte
7. Empfehlung, welches Issue als Nächstes bearbeitet werden sollte

### Abschlusskriterien

Die Gesamtintegration ist abgeschlossen, wenn:

- alle Issues #93 bis #98 geschlossen sind,
- alle fünf read-only Tools stabil funktionieren,
- Server ausschließlich lazy starten,
- Shutdown und Crash-Recovery keine Prozesse hinterlassen,
- Trust-Gates und sichere Defaults greifen,
- normale PR-CI deterministisch bleibt,
- echte Server über separate Smokes geprüft werden können,
- Dokumentation, Konfiguration, Migration und Rollback vollständig sind,
- bestehende Pi-Workflows nicht verschlechtert wurden.

Schwierigkeiten: 7/10 | Thinking: xhigh

## 19. Primäre technische Referenzen

- LSP 3.17: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
- Pi Extensions: https://pi.dev/docs/latest/extensions
- TypeScript Language Server: https://github.com/typescript-language-server/typescript-language-server
- Pyright: https://github.com/microsoft/pyright
- rust-analyzer: https://rust-analyzer.github.io/book/
- gopls: https://go.dev/gopls/
- clangd: https://clangd.llvm.org/
- Eclipse JDT LS: https://github.com/eclipse-jdtls/eclipse.jdt.ls
