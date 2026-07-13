# Historischer Skill-Katalog für den menügeführten Skill-Launcher

> **Abgelöst durch Phase 4 — nicht umsetzen.** Dieser Katalog beschreibt den
> verworfenen Eigenbau `extensions/skill-mode` mit Shift+Tab-Menü,
> Ausführungsmodi und eigenen Permission-Profilen. Aktive Pi-Skills liegen als
> `skills/<name>/SKILL.md` vor und werden über `/skill:<name>` aufgerufen.
> Die Menü-, Modus- und Profilvorgaben dieses Dokuments dürfen nicht als
> aktuelle Spezifikation verwendet werden; der Inhalt bleibt nur als
> historische Ideensammlung erhalten.

Status: historisch / abgelöst
Zielsystem: Pi Coding Agent  
Primäre Nutzung: Shift+Tab → Skills → Skill auswählen  
Wichtig: Der Nutzer soll Skills über ein Menü starten können und nicht über Slash-Commands arbeiten müssen.

Ergänzende Referenz für Agenten-Dokumente-Skills:

```text
docs/skills/agent-docs-skill-reference.md
```

---

## Löschregel

Dieses Dokument ist eine temporäre Spezifikation für den Aufbau aller vorgesehenen Skills.

Wenn alle in diesem Dokument beschriebenen Skills technisch angelegt, im Skill-Launcher registriert, über das Menü auswählbar, mit Profilen abgesichert und manuell getestet wurden, soll dieses Dokument gelöscht werden.

Vor dem Löschen muss geprüft werden, ob die dauerhaft relevanten Informationen in den eigentlichen Skill-Dateien, Registry-Einträgen, Tests oder der finalen Entwicklerdokumentation enthalten sind.

---

## Grundprinzip

Skills sind keine dauerhaften Modi.

Ein Skill ist eine gezielte, einmalige Aktion mit eigenem Rechteprofil. Nach Abschluss kehrt Pi zum vorherigen Modus zurück.

```text
Modus = dauerhaftes Arbeitsverhalten
Skill = einmalige gezielte Aktion
Skill-Profil = Rechte und Grenzen des Skills
Skill-Launcher = Menü, das Skills sichtbar macht und startet
```

Gewünschter Ablauf:

```text
Shift+Tab
→ Skills
→ Kategorie auswählen
→ Skill auswählen
→ Skill-Details anzeigen
→ optionale Eingabe abfragen
→ Skill ausführen
→ Ergebnis ausgeben
→ zurück zum vorherigen Modus
```

---

## Globale UX-Regeln

1. Skills müssen über das Shift+Tab-Menü sichtbar auswählbar sein.
2. Der Nutzer soll keine Slash-Commands kennen oder eintippen müssen.
3. Jeder Skill zeigt vor Ausführung:
   - Name
   - Kategorie
   - Kurzbeschreibung
   - Profil
   - Schreibzugriff: erlaubt/gesperrt
4. Read-only Skills dürfen keine Änderungen vornehmen.
5. Preview-only Skills dürfen Inhalte nur als Vorschau erzeugen.
6. Write Skills dürfen nur nach expliziter Freigabe ausgeführt werden.
7. Nach Abschluss zeigt Pi:
   - Skill abgeschlossen
   - Keine Änderungen vorgenommen, falls read-only/preview-only
   - Zurück zu: vorheriger Modus
8. Skills dürfen den aktiven Modus nicht dauerhaft ersetzen.
9. Agenten-Dokumente-Skills müssen zusätzlich `docs/skills/agent-docs-skill-reference.md` einhalten.

---

## Skill-Profile

### read-only

Erlaubt:

- Dateien lesen
- Projektstruktur anzeigen
- Git-Status lesen
- Git-Log lesen
- Git-Diff lesen
- Git-Branches lesen
- Git-Remote lesen
- GitHub Issues lesen
- GitHub Pull Requests lesen
- Konfigurationsdateien lesen
- Package-Dateien lesen
- TODOs/FIXMEs suchen
- Ergebnisse beschreibend ausgeben

Nicht erlaubt:

- Dateien schreiben
- Dateien löschen
- Dateien verschieben
- Code ändern
- Code formatieren
- Commits erstellen
- Push ausführen
- Pull ausführen
- Merge ausführen
- Rebase ausführen
- Branch erstellen
- Branch löschen
- Issues erstellen, schließen oder bearbeiten
- PRs erstellen, schließen oder bearbeiten
- Dependencies installieren
- Permissions ändern
- Plan erstellen, außer der jeweilige Skill ist ausdrücklich als Setup-Analyse mit Wartepunkt definiert
- Umsetzungsempfehlung als Hauptausgabe geben, außer sie ist Teil des definierten Agenten-Setup-Ausgabeformats

### preview-only

Erlaubt:

- Dateien lesen
- Inhalte als Vorschau erzeugen
- geplante Dateinamen anzeigen
- geplante Dokumentinhalte anzeigen
- Unterschiede zwischen Bestand und Vorschau anzeigen

Nicht erlaubt:

- Dateien schreiben
- Dateien überschreiben
- Dateien löschen
- Änderungen anwenden
- Commits erstellen
- Push ausführen

### command-limited

Erlaubt:

- Nur explizit erlaubte Commands
- Tests, Lint oder Build nur mit Allowlist
- Ausgabe und Logs lesen

Nicht erlaubt:

- freie Shell-Ausführung
- Schreibende Commands ohne Freigabe
- destructive Commands
- Git-Schreibbefehle

### write

Erlaubt:

- gezielte Dateiänderungen nach Freigabe
- neue Dateien erstellen nach Freigabe
- bestehende Dateien aktualisieren nach Freigabe

Nicht erlaubt:

- automatische Pushes
- automatische Commits ohne Freigabe
- destructive Aktionen ohne explizite Freigabe
- Modus-/Permission-Umgehung

---

## Globale Ausgabe für normale read-only Skills

```text
Skill:
<Name>

Profil:
read-only

Anfrage:
<Nutzerauftrag oder Standardprüfung>

Gesammelte Informationen:

1. <Bereich>
- Gefunden:
- Nicht gefunden:
- Nicht prüfbar:

Quellen:
- <Datei, Command oder Tool>

Auffälligkeiten als Beobachtung:
- Nur beschreibende Beobachtungen.
- Keine To-dos.
- Kein Plan.
- Keine Umsetzungsempfehlung.

Status:
Informationssammlung abgeschlossen.
Keine Änderungen vorgenommen.
```

Ausnahme:

Die Agenten-Dokumente-Skills nutzen die speziellen Ausgabeformate aus `docs/skills/agent-docs-skill-reference.md`, weil diese bewusst Phase-1-Analyse, Phase-2-Setup und Review-Ausgaben definieren.

---

## Technische Mindeststruktur pro Skill

Jeder Skill soll als registrierbares Objekt oder äquivalente Struktur abbildbar sein:

```text
id
name
category
description
profile
inputMode
visibleInMenu
requiresConfirmation
allowedOperations
blockedOperations
allowedCommands
blockedCommands
outputSections
forbiddenSections
referenceDocs
finalStatus
handler oder entrypoint
```

`visibleInMenu: true` ist für alle hier beschriebenen Skills Standard.

---

# Skill-Kategorien und Skills

## Kategorie: Projekt

| id | Name | Profil | Input | Zweck |
|---|---|---|---|---|
| `project-overview` | Projektübersicht | read-only | optional | Sammelt Projektname, Paketmanager, Framework/Runtime, wichtige Ordner, Scripts, Konfiguration und Doku. |
| `file-structure-search` | Datei-/Struktur-Suche | read-only | required | Findet relevante Dateien, Ordner, Funktionen, Konfigurationen oder Agenten-Dateien zu einer Nutzeranfrage. |
| `dependency-config-check` | Dependency-/Config-Check | read-only | optional | Sammelt Paket-, Script-, Dependency- und Konfigurationsinformationen. |

Blockiert für alle Projekt-Skills:

- Dateiänderungen
- Dependency-Installation
- automatische Reorganisation
- Planerstellung als Hauptausgabe

---

## Kategorie: Git

| id | Name | Profil | Input | Zweck |
|---|---|---|---|---|
| `git-status` | Git-Status | read-only | optional | Sammelt aktuellen Branch, Status, lokale Änderungen, Branches, Remote, letzte Commits und Diff-Statistik. |
| `recent-changes` | Letzte Änderungen | read-only | optional | Macht sichtbar, was zuletzt geändert wurde, welche Dateien betroffen sind und welche Diff-Zusammenfassung existiert. |

Erlaubte Git-Kommandos für read-only Skills:

```text
git status --short --branch
git branch
git branch -a
git remote -v
git log --oneline -n 10
git diff --stat
git diff
git show
git ls-files
```

Blockierte Git-Kommandos für read-only Skills:

```text
git add
git commit
git push
git pull
git merge
git rebase
git checkout
git switch
git branch -d
git branch -D
git reset
git clean
git stash
git tag
git revert
git cherry-pick
```

---

## Kategorie: GitHub

| id | Name | Profil | Input | Zweck |
|---|---|---|---|---|
| `github-issues-prs-read` | Issues & PRs lesen | read-only | optional | Sammelt offene Issues, PRs, Labels, letzte Aktualisierung und Branch-Bezug, falls GitHub-Integration verfügbar ist. |

Blockiert:

- Issues erstellen, schließen oder bearbeiten
- Kommentare schreiben
- Labels ändern
- PRs ändern, mergen oder reviewen

---

## Kategorie: Code

| id | Name | Profil | Input | Zweck |
|---|---|---|---|---|
| `code-inspection` | Code-Inspection | read-only | required | Liest und beschreibt eine bestimmte Datei, Funktion, Komponente oder technische Stelle. |
| `todo-fixme-search` | TODO/FIXME-Suche | read-only | optional | Sammelt TODO-, FIXME-, HACK-, NOTE- oder ähnliche Marker im Projekt. |

Blockiert:

- Dateiänderungen
- Refactoring
- Formatierung
- Patch-Erzeugung
- apply_patch
- Dependency-Installation
- Planerstellung

---

## Kategorie: Dokumente

| id | Name | Profil | Input | Zweck |
|---|---|---|---|---|
| `document-diff` | Dokumenten-Diff | read-only | required | Vergleicht Dokumente, Prompt-Dateien, Agent-Dateien, Specs oder alte/neue Versionen. |
| `document-consistency-check` | Dokumenten-Konsistenzcheck | read-only | optional | Sucht in Projektdokumenten nach widersprüchlichen, veralteten oder doppelt gepflegten Regeln. |

Sinnvoll für:

- `AGENTS.md`
- `CLAUDE.md`
- `CODEX.md`
- `README.md`
- `docs/*.md`
- `agents/*.md`
- `prompts/*.md`
- Konzept-Dateien
- Arbeitsaufträge
- Plan-Dateien
- Projektregeln
- Modus-/Skill-Dokumentation

Blockiert:

- Dokumente ändern
- Dokumente zusammenführen
- neue Dokumente erstellen
- alte Dokumente löschen
- automatische Aktualisierung

---

## Kategorie: Agenten-Dokumente

Alle Skills in dieser Kategorie müssen zusätzlich diese Referenz einhalten:

```text
docs/skills/agent-docs-skill-reference.md
```

Diese Kategorie folgt ausdrücklich dem zweistufigen Modell:

```text
Phase 1 = read-only Analyse / Review
Phase 2 = Schreiben nur nach explizitem Go
```

| id | Name | Profil | Input | Zweck |
|---|---|---|---|---|
| `agent-docs-check` | Agent-Dokumente prüfen | read-only | optional | Prüft, ob ein Repository sauber für agentische Coding-Workflows vorbereitet ist. |
| `agent-docs-setup-preview` | Agent-Dokumente vorbereiten | preview-only | optional | Erzeugt nur eine Vorschau sinnvoller Agenten-Dokumente und Inhalte. |
| `agent-docs-setup` | Agent-Dokumente einrichten | write | required | Legt Agenten-Dokumente nach Analyse, Preview und explizitem Go an oder aktualisiert sie. |
| `agent-docs-review` | Agent-Dokumente reviewen | read-only | optional | Prüft ein vorhandenes Agenten-Setup streng gegen Code, Scripts, Doku, Claude-Code-Struktur und Overengineering. |

### `agent-docs-check`

Muss prüfen:

- Projektgrundlage
- bestehende Agenten-Dateien
- Claude-Code-Struktur
- Projektdokumentation
- Automatisierung und Qualität
- Risiken durch sensible Daten, Secrets, lokale Nutzerdaten, API-Keys, Deployment-Credentials und leicht veränderbare Produktentscheidungen

Muss als Ergebnis `# Agenten-Setup-Analyse` liefern und am Ende auf `Warte auf dein Go für Phase 2.` stoppen.

### `agent-docs-setup-preview`

Muss nur Vorschauen erzeugen.

Muss anhand des echten Projektkontexts entscheiden, welche Dateien sinnvoll sind. Keine Doku-Deko.

Mögliche Dateien:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/CODEMAP.md`
- `docs/AGENT_CONTEXT_PACKS.md`
- `docs/CURRENT_STATUS.md`
- `docs/VALIDATION_MATRIX.md`
- `docs/decisions/*.md`
- `docs/SECURITY_PRIVACY_CONTEXT.md`
- `docs/PRIVACY_CONTEXT.md`
- `docs/MANUAL_TEST_SCENARIOS.md`
- `docs/UI_CONTEXT.md`, nur bei UI-/App-Projekten
- `docs/DESIGN_CONTEXT.md`, nur bei UI-/App-Projekten
- `docs/DATA_MODEL.md`, nur bei Daten/Persistenz
- `docs/DEPLOYMENT_CONTEXT.md`, nur bei Deployment/Hosting
- `docs/MODEL_PROVIDER_CONTEXT.md`, nur bei KI-/LLM-/Provider-Projekten
- `.claude/rules/*.md`, `.claude/agents/*.md`, `.claude/commands/*.md`, nur bei größeren Projekten oder klar wiederkehrenden Spezialaufgaben

### `agent-docs-setup`

Darf erst nach:

1. read-only Analyse,
2. Preview,
3. explizitem `Go`,
4. Workmodus oder expliziter Schreibfreigabe

Dateien schreiben.

Muss echte Pfade und echte Commands nutzen. Darf keine Wunscharchitektur erzeugen.

### `agent-docs-review`

Muss strikt read-only arbeiten und das Agenten-Setup gegen folgende Kriterien prüfen:

- Vollständigkeit
- Korrektheit
- Claude-Code-Kompatibilität
- Agenten-Nutzen
- Widerspruchsfreiheit
- Sicherheit/Datenschutz
- keine Doku-Bürokratie

Muss `PASS`, `PASS MIT NACHARBEIT` oder `FAIL` ausgeben.

---

## Kategorie: Pi-System

| id | Name | Profil | Input | Zweck |
|---|---|---|---|---|
| `subagent-doctor` | Subagent-Doctor | read-only | optional | Sammelt Informationen über Subagenten-System, Extension-Dateien und Tool-Registrierung. |
| `tool-extension-check` | Tool-/Extension-Check | read-only | optional | Sammelt sichtbare Informationen über Tools, Extensions und Registrierungen im Pi-System. |

Blockiert:

- Subagenten-Dateien ändern
- Extension neu schreiben
- Konfiguration ändern
- Tools registrieren oder entfernen
- automatische Reparatur

---

## Kategorie: Checks

| id | Name | Profil | Input | Zweck |
|---|---|---|---|---|
| `test-build-check` | Test-/Build-Check | command-limited | optional | Führt definierte Test-, Lint- oder Build-Kommandos aus und zeigt Ergebnisse. |
| `release-deploy-check` | Release-/Deploy-Check | read-only | optional | Sammelt Informationen über Build-, Deploy-, CI/CD- und Release-Strukturen. |
| `security-surface-check` | Security-Surface-Check | read-only | optional | Sammelt sichtbare Sicherheitsflächen ohne Exploit-Anleitungen oder Änderungen. |

`test-build-check` ist nicht strikt read-only, weil Tests und Builds Cache-, Coverage-, Log- oder Build-Dateien erzeugen können.

Allowlist für `test-build-check`:

```text
npm test
npm run test
npm run build
npm run lint
pnpm test
pnpm build
pnpm lint
yarn test
yarn build
yarn lint
```

Blockiert:

- freie Shell-Kommandos
- install-Kommandos
- rm/delete
- git write commands
- deploy commands
- publish commands

---

## Empfohlene Umsetzungsreihenfolge

### Phase 1: Skill-Launcher und Registry

- Shift+Tab → Skills ergänzen
- Skill-Untermenü anzeigen
- Skill-Metadaten anzeigen
- Skill auswählen
- Rückkehr zum vorherigen Modus

### Phase 2: Skill-Profile und Guards

- read-only Guard
- preview-only Guard
- command-limited Guard
- write Guard mit Bestätigung
- zentrale Blockierung schreibender Operationen

### Phase 3: MVP-Skills

Zuerst umsetzen:

1. Projektübersicht
2. Datei-/Struktur-Suche
3. Git-Status
4. Letzte Änderungen
5. Code-Inspection
6. Subagent-Doctor

### Phase 4: Dokumenten- und Agenten-Dokumente

Danach umsetzen:

7. Dokumenten-Diff
8. Dokumenten-Konsistenzcheck
9. Agent-Dokumente prüfen
10. Agent-Dokumente vorbereiten
11. Agent-Dokumente reviewen

### Phase 5: Erweiterte Checks und Write-Skills

Später umsetzen:

12. Dependency-/Config-Check
13. Issues & PRs lesen
14. Tool-/Extension-Check
15. Test-/Build-Check
16. Release-/Deploy-Check
17. Security-Surface-Check
18. Agent-Dokumente einrichten

---

## Abschlusskriterien für dieses Dokument

Dieses Dokument darf gelöscht werden, wenn alle folgenden Punkte erfüllt sind:

1. Alle vorgesehenen Skills sind als Skill-Definitionen angelegt.
2. Alle Skills sind im Skill-Launcher sichtbar.
3. Alle Skills sind über Shift+Tab → Skills auswählbar.
4. Jeder Skill besitzt ein korrektes Profil.
5. Read-only Skills sind technisch gegen Schreibzugriffe abgesichert.
6. Preview-only Skills schreiben keine Dateien.
7. Command-limited Skills nutzen eine Allowlist.
8. Write Skills verlangen explizite Freigabe.
9. Alle Skills haben ein einheitliches Ausgabeformat oder ein bewusst definiertes Spezialformat.
10. Alle MVP-Skills wurden manuell getestet.
11. Bestehende Plan-/Work-Modi funktionieren weiterhin.
12. Bestehende Modell-/Thinking-/Permission-Menüs funktionieren weiterhin.
13. Die Agenten-Dokumente-Skills halten `docs/skills/agent-docs-skill-reference.md` ein.
14. Die dauerhaft relevanten Informationen wurden in finaler Projekt-/Entwicklerdokumentation oder direkt in Skill-Dateien übernommen.
15. Dieses Dokument wurde nach Abschluss entfernt.
