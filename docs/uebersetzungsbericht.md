# Übersetzungsbericht: Pi-Agent-Setup auf Deutsch

**Ziel:** Alle sichtbaren englischen Texte der Benutzeroberfläche (Menüs, Dialoge,
Fehler-/Statusmeldungen, Tooltips, Hinweise, Platzhalter, Einstellungs-/Hilfeseiten)
und der Endnutzer-Dokumentation wurden ins Deutsche überführt.

**Nicht geändert:** Logik, APIs, Dateinamen, Variablen, Klassen, Bibliotheken,
sowie technische Bezeichner/Standardbegriffe (siehe Abschnitt 3).

**Verifikation:** `npm run verify` → `npm run typecheck` + `node ../tests/run.mjs`
→ **572 passed, 0 failed**.

**Umfang:** 30 Dateien geändert (474 insertions / 530 deletions), davon 1 reine
Nutzereinstellung (`settings.json`, nicht übersetzt, erhalten).

---

## 1. Tatsächlich vorgenommene Übersetzungen (Code)

### 1.1 Aurora-Footer (`extensions/aurora-ui/index.ts`)

| Vorher | Nachher |
|--------|---------|
| `no model` | `kein Modell` |
| `off` (Thinking-Modus) | `aus` |
| `ctx` | `Kontext` |
| `WORKFLOW` / `STEP` / `MODEL` / `THINK` / `CONTEXT` / `PERM` | `ARBEITSABLAUF` / `SCHRITT` / `MODELL` / `DENKEN` / `KONTEXT` / `BERECHTIGUNG` |
| `session ${name}` / `unnamed` | `Sitzung ${name}` / `unbenannt` |
| `Tool aktiv` / `Tools aktiv` | `Werkzeug aktiv` / `Werkzeuge aktiv` |

### 1.2 Workflow-Status (`extensions/shared/workflow-status.ts`)

| Vorher | Nachher |
|--------|---------|
| `Read only` | `Nur Lesen` |
| `Read + Bash Info Commands` | `Lesen + Bash-Info` |
| `Read + Write` | `Lesen + Schreiben` |
| `Full Access` | `Vollzugriff` |
| `⚠ FULL ACCESS` | `⚠ VOLLZUGRIFF` |
| `ARCH PLAN` | `ARCHITEKTURPLAN` |
| `WORK · PLAN STORED` | `ARBEIT · PLAN GESPEICHERT` |
| `ANALYZE` / `WORK` / `PAUSED` / `BLOCKED` / `READY` | `ANALYSE` / `ARBEIT` / `PAUSIERT` / `BLOCKIERT` / `BEREIT` |

### 1.3 Thinking-View (`extensions/thinking-view.ts`)

| Vorher | Nachher |
|--------|---------|
| `WAITING` / `THINKING` / `ANSWERING` | `WARTEN` / `DENKEN` / `ANTWORTEN` |
| `PREPARING TOOL` / `TOOL RUNNING` | `Werkzeug vorbereiten` / `Werkzeug läuft` |
| `FINISHED` / `NO VISIBLE THINKING` / `ERROR` | `FERTIG` / `Kein sichtbares Denken` / `FEHLER` |
| hidden label `Thinking` | `Denken` |

### 1.4 Ask-User (`extensions/ask-user.ts`)

| Vorher | Nachher |
|--------|---------|
| `Ask User` | `Nutzer fragen` |
| `Error:` | `Fehler:` |
| `Expected 2–4 options` | `2–4 Optionen erwartet` |
| `User cancelled the selection` | `Auswahl abgebrochen` |
| `User wrote:` / `User selected:` | `Eigene Eingabe:` / `Ausgewählt:` |
| `Your answer:` | `Deine Antwort:` |
| `Enter to submit • Esc to go back` | `Enter zum Bestätigen • Esc zum Zurückgehen` |
| `navigate` / `direct` / `cancel` / `Options:` / `Cancelled` / `(wrote)` | `navigieren` / `direkt` / `abbrechen` / `Optionen:` / `Abgebrochen` / `(eigene Eingabe)` |

### 1.5 Permission-Dialog (`extensions/shared/permission-dialog.ts`)

| Vorher | Nachher |
|--------|---------|
| `Permission Request` | `Berechtigungsanfrage` |
| `Command` / `Tool:` / `Context:` / `Risk:` | `Befehl` / `Werkzeug:` / `Kontext:` / `Risiko:` |
| `[a] ALLOW ONCE   [d] DENY` | `[a] Ja [d] Nein` |
| `Reason:` | `Begründung:` |
| `Custom UI overlay not supported in this context.` | `Benutzerdefiniertes TUI-Overlay wird in diesem Kontext nicht unterstützt.` |

### 1.6 Control-Center / Thinking-Menü

| Datei | Vorher → Nachher |
|-------|------------------|
| `shared/control-center-menu.ts` | `Thinking` → `Denken`; `Workspace-Datei` → `Arbeitsbereichs-Datei` |
| `shared/thinking-menu.ts` | `Minimal`→`Minimal`; `Low`→`Niedrig`; `Medium`→`Mittel`; `High`→`Hoch`; `XHigh`→`Sehr hoch`; `Thinking-Default`→`Denkstandard` |
| `shared/menu-ui.ts` | Input-Hinweis `navigate` → `navigieren` |
| `mode-permissions.ts` | `FULL ACCESS aktiv`→`VOLLZUGRIFF aktiv`; `Read-only LSP capability`→`LSP-Fähigkeit (nur lesend)`; `Thinking`→`Denken`; `Thinking-Modus wählen`→`Denkmodus wählen` |

### 1.7 LSP-Integration (`extensions/lsp/*`)

| Bereich | Vorher → Nachher (Auswahl) |
|---------|----------------------------|
| Tools-Labels | `LSP Diagnostics`→`LSP-Diagnosen`; `LSP Definition`→`LSP-Definition`; `LSP References`→`LSP-Referenzen`; `LSP Workspace Symbols`→`LSP-Arbeitsbereichs-Symbole`; `Workspace`→`Arbeitsbereich` |
| Status | `off`→`aus`; `idle`→`leerlauf`; `degraded`→`eingeschränkt`; `active`→`aktiv`; `1 active`→`1 aktiv` |
| Fehlermeldungen | `path '…' is outside the project`→`Pfad '…' liegt außerhalb des Projekts`; `Only files … are accessible`→`Nur Dateien innerhalb des aktuellen Projekts sind zugänglich.`; `no LSP profile is mapped`→`kein LSP-Profil zugeordnet`; `symlink escape detected`→`Symlink-Escape erkannt`; `no diagnostics received`→`Keine Diagnosen empfangen`; `Install the server binary …`→`Server-Binärdatei installieren …` |

### 1.8 Git-Header (`extensions/git-header.ts`)

| Vorher | Nachher |
|--------|---------|
| `Current branch:` / `Recent commits:` | `Aktueller Branch:` / `Letzte Commits:` |
| `staged` / `modified` / `untracked` / `deleted` | `vorgemerkt` / `geändert` / `neu` / `gelöscht` |
| `(clean)` / `HEAD detached at` | `(sauber)` / `HEAD losgelöst bei` |

### 1.9 Setup-Core / Plan-Modus

| Datei | Vorher → Nachher |
|-------|------------------|
| `setup-core/config.ts` | `unknown key`→`unbekannter Schlüssel`; `root value must be an object`→`Root-Wert muss ein Objekt sein`; `ui.theme must be aurora-night`→`ui.theme muss aurora-night sein`; `project config may not relax permissions`→`Projektkonfiguration darf Berechtigungen nicht lockern` |
| `plan-mode/index.ts` | `Start in detailed plan mode (permissions unchanged)`→`Im detaillierten Planungsmodus starten (Berechtigungen unverändert)` |
| `plan-mode/utils.ts` | `Path escapes working directory`→`Pfad verlässt das Arbeitsverzeichnis`; `Plan file not found`→`Plan-Datei nicht gefunden`; `Decision brief not found`→`Decision Brief nicht gefunden` |
| `plan-mode/state.ts` | `Workflow state escapes working directory`→`Workflow-Zustand verlässt das Arbeitsverzeichnis`; `Symbolic links are not allowed …`→`Symbolische Links sind in Workflow-Zustandspfaden nicht erlaubt` |

---

## 2. Übersetzte Dokumentation

| Datei | Status |
|-------|--------|
| `README.md` | Vollständig auf Deutsch (inkl. ASCII-Architekturdiagramm) |
| `docs/runtime-matrix.md` | Vollständig auf Deutsch |
| `docs/subagents.md` | Vollständig auf Deutsch |
| `skills/context-checkpoint/SKILL.md` | Frontmatter + Inhalt auf Deutsch |

---

## 3. Bewusst nicht übersetzte Begriffe (mit Begründung)

| Begriff | Begründung |
|---------|------------|
| `API`, `CLI`, `URL`, `HTTP`, `HTTPS`, `JSON`, `Markdown`, `Terminal`, `Docker`, `Linux`, `Windows`, `WebSocket` | Etablierte technische Standardbegriffe; im deutschen Fachkontext üblich und unmissverständlich. |
| `Git`, `GitHub` | Eigenname des Versionskontrollsystems / der Plattform. |
| `LSP` (Language Server Protocol) | Technischer Standard; in `extensions/lsp/*` als Verzeichnis- und Modulname sowie in Tool-Labels (`LSP-Diagnosen`) beibehalten. |
| `AURORA`, `AURORA NIGHT` | Marken-/Designname des Themes (`themes/aurora-night.json`); darf nicht verändert werden. |
| `YOLO` | Eingedeutschter Modusname; bewusst als Eigenname belassen (nicht „Vollkommen Losgelöst"). |
| `REVIEW` (Workflow-Status) | Bereits als Fachbegriff im Deutschen etabliert; nicht zu „Prüfung" geändert, um Verwechslung mit Test-Review zu vermeiden. |
| `PLAN` (Workflow-Status) | Eigene Domäne des Plan-Modus; als Begriff beibehalten (nicht „Vorhaben"). |
| `Fast` / `Primary` / `Deep` (Modellrollen) | Interne Rollen-IDs, die in Konfiguration und Tests verwendet werden; sichtbarer Text dazu ist „Modellrolle" (deutsch), die Rollennamen selbst bleiben als Technik-IDs erhalten. |
| `Tool` in Tool-Namen (`lsp_diagnostics`, `lsp_definition` …) | Tool-IDs/Commands, technisch. Anzeige-Label dazu sind deutsch (`LSP-Diagnosen` …). |
| `Ctrl`, `Shift`, `Tab`, `Enter`, `Esc`, `PgUp`, `PgDn`, `Home`, `End` | Tastenbezeichnungen; standardmäßig englisch belassen (international üblich). |
| `MINIMAL` (Thinking-Stufe) | Bewusst beibehalten, analog zu `Minimal`-Konvention; konsistent mit `thinking-menu.ts`. |
| `Bash`, `npm`, `sudo`, `PATH`, `SIGTERM`, `SIGKILL`, `ENOENT` | Befehls-/Systembezeichner; technisch. |
| `GPT`, `Claude`, `Gemini`, `GLM`, `Kimi` … | Modellnamen; Eigenname, nicht übersetzbar. |
| `TypeScript`, `JavaScript`, `Python`, `Go`, `Rust` | Sprach-/Frameworknamen; Eigenname. |

---

## 4. Technisch problematische / grenzwertige Stellen

1. **`PermissionRiskStatusValue` (Type in `workflow-status.ts`)**: Ursprünglich
   `"⚠ FULL ACCESS" | "⚠ YOLO"`. Nach Änderung des sichtbaren Strings auf
   `"⚠ VOLLZUGRIFF"` musste der Union-Type angepasst werden, sonst TS2322.
   → Type erweitert auf `"⚠ VOLLZUGRIFF" | "⚠ YOLO"`. Korrekt, da rein sichtbar.

2. **`tests/run.mjs` (572 Tests)**: Erwartete zuvor englische UI-Strings
   (`"WORK"`, `"ANALYZE"`, `"READY"`, `"⚠ FULL ACCESS"`, `"THINKING"`,
   `"ANSWERING"`, `"NO VISIBLE THINKING"`, `"Read + Write"`, LSP-Statuswörter,
   Permission-Dialog-Breite, Timeout-Meldung). Alle erwarteten Strings wurden
   auf die deutschen Werte angepasst, damit `npm test` grün bleibt. Reine
   Test-Fixtures, keine Produktionslogik.

3. **`ask-user.ts` Options-Label `[a] Ja [d] Nein`**: Die Tastenkürzel `a`/`d`
   sind Code-gebunden; nur das Label wurde übersetzt. Verhalten unverändert.

4. **`lsp/status.ts` `${n} active` → `${n} aktiv`**: Pluralbildung vereinfacht
   (im Deutschen bei Mengenangaben nicht zwingend nötig); bei `n=1` korrekt
   „1 aktiv". Bei größeren `n` ebenfalls akzeptabel (kein sichtbarer Pluralzwang).

5. **Mixed-Case Labels (`leerlauf`, `aus`, `eingeschränkt`, `aktiv`)**: LSP-Status
   bewusst kleingeschrieben, da sie als kompakte Fußzeilen-Werte erscheinen
   (anders als die großgeschriebenen Workflow-/Thinking-Status). Konsistent
   innerhalb der LSP-Anzeige.

6. **`README.md`-ASCII-Diagramm**: Modulbeschreibungen übersetzt (z. B.
   „effective config" → „effektive Konfiguration"); Struktur/Rahmen unverändert.

---

## 5. Konsistenzprüfung

- **Wortwahl einheitlich:** „Denken" (nicht „Nachdenken") für Thinking;
  „Arbeitsbereich" (nicht „Workspace") für Workspace; „Werkzeug" für Tool in
  sichtbaren Labels; „Berechtigung" für Permission.
- **Statusgroßschreibung:** Workflow- und Thinking-Status groß
  (`ARBEIT`, `DENKEN`, `BEREIT` …); LSP-Status klein (`aus`, `leerlauf` …) —
  beide Gruppen jeweils intern konsistent.
- **Keine Logikänderung:** Keine einzige Funktion, kein Parameter, kein
  Dateiname, keine API geändert. `git diff` enthält ausschließlich
  String-Literale und (in `status.ts`) Typ-Union-Erweiterung.
- **Tests grün:** 572/572 bestanden; `typecheck` mit `strict` fehlerfrei.
- **Nutzereinstellungen erhalten:** `settings.json` (letzte Changelog-Version,
  Provider/Modell) unverändert von meinen Übersetzungen.
- **Restliche Englisch-Treffer:** Nur noch in Kommentaren, technischen
  Bezeichnern, Log-Ausgaben für Entwickler und in den in Abschnitt 3 gelisteten
  bewusst ausgenommenen Begriffen.
