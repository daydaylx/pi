# Pi Skill-Katalog für den menügeführten Skill-Launcher

Status: Entwurf / Arbeitsgrundlage  
Zielsystem: Pi Coding Agent  
Primäre Nutzung: Shift+Tab → Skills → Skill auswählen  
Wichtig: Der Nutzer soll Skills über ein Menü starten können und nicht über Slash-Commands arbeiten müssen.

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

---

## Globale Ausgabe für read-only Skills

Read-only Skills sollen ein einheitliches Format nutzen:

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

2. <Bereich>
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

Verbotene Abschnitte in read-only Skills:

- Plan
- To-dos
- Roadmap
- Fix
- Umsetzung
- Empfehlung als Hauptausgabe
- Refactoring-Vorschlag

Erlaubte Formulierungen:

- Gefunden
- Nicht gefunden
- Nicht prüfbar
- Vorhanden
- Nicht vorhanden
- Auffällig
- Quelle
- Keine Änderungen vorgenommen

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
- Plan erstellen
- Umsetzungsempfehlung als Hauptausgabe geben

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
finalStatus
handler oder entrypoint
```

`visibleInMenu: true` ist für alle hier beschriebenen Skills Standard.

---

# Skill-Kategorien und Skills

## Kategorie: Projekt

### 1. Projektübersicht

```text
id: project-overview
name: Projektübersicht
category: Projekt
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Sammelt eine neutrale Übersicht über das aktuelle Projekt.

Sammelt:

- Projektname
- Paketmanager
- Framework/Runtime, soweit erkennbar
- wichtige Ordner
- wichtige Konfigurationsdateien
- vorhandene Scripts
- vorhandene Dokumentation
- vorhandene Agent-/Skill-/Extension-Dateien
- grobe Projektstruktur

Erlaubte Operationen:

- Datei- und Ordnerstruktur lesen
- package.json lesen
- README/Dokumentation lesen
- Konfigurationsdateien lesen

Blockierte Operationen:

- Dateiänderungen
- Installation von Dependencies
- Formatierung
- Planerstellung

Ausgabeabschnitte:

- Projekt
- Struktur
- Scripts
- Konfiguration
- Dokumentation
- Agent-/Skill-/Extension-Dateien
- Nicht gefunden
- Nicht prüfbar
- Status

---

### 2. Datei-/Struktur-Suche

```text
id: file-structure-search
name: Datei-/Struktur-Suche
category: Projekt
profile: read-only
inputMode: required
requiresConfirmation: false
```

Zweck:

Findet relevante Dateien, Ordner, Funktionen, Konfigurationen oder Agenten-Dateien zu einer Nutzeranfrage.

Beispielanfragen:

- Finde alles zu subagent.
- Finde alle Dateien zum Shift+Tab-Menü.
- Finde agent.md, agents/*.md und Extension-Dateien.

Sammelt:

- passende Dateien
- Trefferstellen
- Ordnerstruktur
- Dateitypen
- Suchbegriffe
- mögliche Entry-Points

Erlaubte Operationen:

- Dateisuche
- ripgrep/grep mit lesenden Suchmustern
- Dateien lesen

Blockierte Operationen:

- Dateiänderungen
- automatische Umbenennungen
- automatische Reorganisation

Ausgabeabschnitte:

- Anfrage
- Treffer
- Relevante Dateien
- Relevante Ordner
- Nicht gefunden
- Quellen
- Status

---

### 3. Dependency-/Config-Check

```text
id: dependency-config-check
name: Dependency-/Config-Check
category: Projekt
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Sammelt Paket-, Script- und Konfigurationsinformationen.

Sammelt:

- package.json
- lockfile
- Scripts
- Dependencies
- DevDependencies
- Node-/Runtime-Versionen, falls definiert
- TypeScript-Konfiguration
- Build-Tool-Konfiguration
- Lint-/Format-Konfiguration
- Extension-/Agent-Konfigurationen

Erlaubte Operationen:

- package.json lesen
- Lockfiles lesen
- Konfigurationsdateien lesen

Blockierte Operationen:

- Dependency-Installation
- Versionsupdates
- Paketmanager-Schreibbefehle
- automatische Config-Änderungen

Ausgabeabschnitte:

- Paketmanager
- Scripts
- Dependencies
- DevDependencies
- Runtime
- Konfiguration
- Nicht gefunden
- Status

---

## Kategorie: Git

### 4. Git-Status

```text
id: git-status
name: Git-Status
category: Git
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Sammelt den aktuellen Git-Zustand.

Sammelt:

- aktueller Branch
- Git-Status
- staged changes
- unstaged changes
- untracked files
- lokale Branches
- Remote-Branches
- Remote-URL
- Tracking-Branch
- ahead/behind-Status, falls verfügbar
- letzte Commits
- Diff-Statistik

Erlaubte Commands:

```text
git status --short --branch
git branch
git branch -a
git remote -v
git log --oneline -n 10
git diff --stat
```

Blockierte Commands:

```text
git add
git commit
git push
git pull
git merge
git rebase
git reset
git clean
git checkout
git switch
git branch -d
git branch -D
git stash
git tag
git revert
git cherry-pick
```

Ausgabeabschnitte:

- Branch
- Status
- Lokale Änderungen
- Branches
- Remote
- Letzte Commits
- Diff-Statistik
- Nicht prüfbar
- Status

---

### 5. Letzte Änderungen

```text
id: recent-changes
name: Letzte Änderungen
category: Git
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Macht sichtbar, was zuletzt geändert wurde.

Sammelt:

- letzte Commits
- geänderte Dateien
- Diff-Zusammenfassung
- aktuelle nicht committed Änderungen
- betroffene Module/Funktionen, soweit lesbar
- neue/gelöschte Dateien

Erlaubte Operationen:

- Git-Log lesen
- Git-Diff lesen
- betroffene Dateien lesen

Blockierte Operationen:

- Dateien ändern
- Änderungen rückgängig machen
- Commit/Pull/Push/Merge/Rebase
- Plan aus Änderungen erstellen

Ausgabeabschnitte:

- Letzte Commits
- Aktuelle lokale Änderungen
- Geänderte Dateien
- Diff-Statistik
- Betroffene Bereiche
- Auffälligkeiten als Beobachtung
- Status

---

## Kategorie: GitHub

### 6. Issues & PRs lesen

```text
id: github-issues-prs-read
name: Issues & PRs lesen
category: GitHub
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Sammelt GitHub-Informationen zum Repository, falls eine Integration verfügbar ist.

Sammelt:

- offene Issues
- offene Pull Requests
- Labels
- letzte Aktualisierung
- Branch-Bezug, falls erkennbar
- verknüpfte Issues/PRs zum aktuellen Branch, falls erkennbar

Erlaubte Operationen:

- Issues lesen
- PRs lesen
- Labels lesen
- Kommentare lesen, falls nötig

Blockierte Operationen:

- Issues erstellen
- Issues schließen
- Issues bearbeiten
- Kommentare schreiben
- Labels ändern
- PRs ändern
- PRs mergen
- Reviews abgeben

Ausgabeabschnitte:

- Repository
- Offene Issues
- Offene PRs
- Labels
- Zuletzt aktualisiert
- Branch-Bezug
- Nicht prüfbar
- Status

---

## Kategorie: Code

### 7. Code-Inspection

```text
id: code-inspection
name: Code-Inspection
category: Code
profile: read-only
inputMode: required
requiresConfirmation: false
```

Zweck:

Liest und beschreibt eine bestimmte Datei, Funktion, Komponente oder technische Stelle.

Input-Prompt:

```text
Welche Datei, Funktion oder Komponente soll gelesen werden?
```

Sammelt:

- relevante Dateien
- relevante Funktionen
- Imports/Exports
- Aufrufstellen
- grobe Abhängigkeiten
- vorhandene Kommentare
- TODO/FIXME
- sichtbare Konfigurationsverweise

Erlaubte Operationen:

- Dateisuche
- Dateien lesen
- Imports/Exports lesen
- Aufrufstellen suchen

Blockierte Operationen:

- Dateiänderungen
- Refactoring
- Formatierung
- Patch-Erzeugung
- apply_patch
- Dependency-Installation
- Planerstellung

Ausgabeabschnitte:

- Anfrage
- Relevante Dateien
- Relevante Funktionen
- Aufrufstellen
- Imports/Exports
- Beobachtungen
- Nicht gefunden
- Nicht prüfbar
- Status

---

### 8. TODO/FIXME-Suche

```text
id: todo-fixme-search
name: TODO/FIXME-Suche
category: Code
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Sammelt vorhandene TODO-, FIXME-, HACK-, NOTE- oder ähnliche Marker im Projekt.

Sammelt:

- TODO-Kommentare
- FIXME-Kommentare
- HACK-Kommentare
- NOTE-Kommentare
- Dateipfade
- Zeilennummern, falls verfügbar
- Kontextzeilen, falls sicher lesbar

Erlaubte Operationen:

- Suche in Dateien
- Lesen von Trefferstellen

Blockierte Operationen:

- Kommentare ändern
- TODOs entfernen
- Issues erstellen
- Plan erstellen

Ausgabeabschnitte:

- Trefferübersicht
- Treffer nach Datei
- Marker-Typen
- Nicht gefunden
- Status

---

## Kategorie: Dokumente

### 9. Dokumenten-Diff

```text
id: document-diff
name: Dokumenten-Diff
category: Dokumente
profile: read-only
inputMode: required
requiresConfirmation: false
```

Zweck:

Vergleicht Dokumente, Prompt-Dateien, Agent-Dateien, Specs oder alte/neue Versionen miteinander.

Sinnvoll für:

- AGENTS.md
- CLAUDE.md
- CODEX.md
- README.md
- docs/*.md
- agents/*.md
- prompts/*.md
- Konzept-Dateien
- Arbeitsaufträge
- Plan-Dateien
- Projektregeln
- Modus-/Skill-Dokumentation

Sammelt:

- welche Dokumente verglichen wurden
- welche Version neuer/älter ist, falls erkennbar
- fehlende Abschnitte
- doppelte Abschnitte
- widersprüchliche Regeln
- unterschiedliche Formulierungen gleicher Regeln
- Inhalte, die in Dokument A stehen, aber in Dokument B fehlen

Erlaubte Operationen:

- Dokumente lesen
- Überschriften extrahieren
- Abschnitte vergleichen
- ähnliche Inhalte finden
- Widersprüche anzeigen

Blockierte Operationen:

- Dokumente ändern
- Dokumente zusammenführen
- neue Dokumente erstellen
- alte Dokumente löschen
- automatische Aktualisierung

Ausgabeabschnitte:

- Verglichene Dokumente
- Gemeinsame Abschnitte
- Fehlende Abschnitte
- Unterschiede
- Widersprüche
- Doppelte Inhalte
- Nicht prüfbar
- Status

---

### 10. Dokumenten-Konsistenzcheck

```text
id: document-consistency-check
name: Dokumenten-Konsistenzcheck
category: Dokumente
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Sucht in Projektdokumenten nach widersprüchlichen, veralteten oder doppelt gepflegten Regeln.

Sammelt:

- alle relevanten Markdown-/Text-Dokumente
- Projektregeln
- Modusregeln
- Skill-Regeln
- Testanweisungen
- Buildanweisungen
- Sicherheitsregeln
- widersprüchliche Aussagen
- doppelte Abschnitte
- fehlende Querverweise

Erlaubte Operationen:

- Dokumente suchen
- Dokumente lesen
- Abschnitte vergleichen

Blockierte Operationen:

- Dokumente ändern
- Dokumente löschen
- Dokumente neu sortieren
- automatische Vereinheitlichung

Ausgabeabschnitte:

- Geprüfte Dokumente
- Regeln/Abschnitte
- Widersprüche
- Doppelte Inhalte
- Fehlende Querverweise
- Nicht prüfbar
- Status

---

## Kategorie: Agenten-Dokumente

### 11. Agent-Dokumente prüfen

```text
id: agent-docs-check
name: Agent-Dokumente prüfen
category: Agenten-Dokumente
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Prüft, ob ein Projekt sauber für Coding-Agenten vorbereitet ist.

Sucht nach:

- AGENTS.md
- agent.md
- CLAUDE.md
- GEMINI.md
- CODEX.md
- README.md
- CONTRIBUTING.md
- docs/
- prompts/
- agents/
- .github/copilot-instructions.md
- Skill-Dateien
- Projektregeln
- Modusregeln
- Testanweisungen
- Buildanweisungen
- Sicherheitsregeln
- Permissions-Regeln
- Do-not-Regeln
- Abschlusskriterien

Sammelt:

- vorhandene Agent-Dokumente
- fehlende Agent-Dokumente
- vorhandene Regeln
- fehlende Regeln
- widersprüchliche Regeln
- unklare Zuständigkeiten zwischen Dokumenten
- Hinweise auf veraltete Agenten-Anweisungen

Erlaubte Operationen:

- Dateien suchen
- Dokumente lesen
- Regeln extrahieren
- Lücken beschreiben

Blockierte Operationen:

- Dokumente erstellen
- Dokumente ändern
- Regeln ergänzen
- Dateien löschen
- automatische Einrichtung

Ausgabeabschnitte:

- Vorhanden
- Nicht gefunden
- Unvollständig
- Widersprüchlich
- Nicht prüfbar
- Status

---

### 12. Agent-Dokumente vorbereiten

```text
id: agent-docs-setup-preview
name: Agent-Dokumente vorbereiten
category: Agenten-Dokumente
profile: preview-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Erzeugt nur eine Vorschau, welche Agent-Dokumente sinnvoll wären und welche Inhalte sie enthalten könnten.

Wichtig:

Dieser Skill darf nichts schreiben. Er erzeugt nur eine Vorschau.

Sammelt:

- vorhandene Agent-Dokumente
- fehlende Agent-Dokumente
- Projektstruktur
- Scripts
- Test-/Build-Kommandos
- Modus-/Permission-Regeln
- mögliche Zielstruktur für Agent-Dokumente

Darf:

- Dateinamen vorschlagen
- Dokumentstruktur vorschlagen
- Inhalte als Vorschau ausgeben
- Unterschiede zwischen Bestand und Vorschau anzeigen

Darf nicht:

- Dateien schreiben
- Dateien überschreiben
- Dateien löschen
- Änderungen anwenden
- Commits erstellen
- Push ausführen

Ausgabeabschnitte:

- Bestehende Dokumente
- Fehlende Dokumente
- Vorgeschlagene neue Dokumente
- Vorgeschlagene Inhalte als Vorschau
- Keine Änderungen vorgenommen
- Status

---

### 13. Agent-Dokumente einrichten

```text
id: agent-docs-setup
name: Agent-Dokumente einrichten
category: Agenten-Dokumente
profile: write
inputMode: required
requiresConfirmation: true
```

Zweck:

Legt Agent-Dokumente an oder aktualisiert sie. Dieser Skill ist nicht read-only und darf nur mit expliziter Freigabe laufen.

Sicherer Ablauf:

```text
Skill starten
→ bestehende Dokumente prüfen
→ fehlende Dokumente anzeigen
→ vorgeschlagene Dateien als Vorschau erzeugen
→ Nutzer bestätigt mit Go
→ erst dann Dateien schreiben
```

Voraussetzungen:

- Workmodus aktiv oder explizite Schreibfreigabe
- Vorschau wurde angezeigt
- Nutzer bestätigt mit Go

Darf nach Freigabe:

- AGENTS.md erstellen
- docs/agent-workflow.md erstellen
- agents/README.md erstellen
- vorhandene Agent-Dokumente gezielt aktualisieren

Darf nie ohne Freigabe:

- Dateien schreiben
- Dateien überschreiben
- Dateien löschen
- Commits erstellen
- Push ausführen

Ausgabeabschnitte:

- Bestehende Dokumente
- Vorgeschlagene Änderungen
- Vorschau
- Freigabe erforderlich
- Ausgeführte Änderungen, falls Go bestätigt
- Status

Hinweis:

Dieser Skill sollte erst nach stabiler Umsetzung von `agent-docs-check` und `agent-docs-setup-preview` aktiviert werden.

---

## Kategorie: Pi-System

### 14. Subagent-Doctor

```text
id: subagent-doctor
name: Subagent-Doctor
category: Pi-System
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Sammelt Informationen über Subagenten-System, Extension-Dateien und Tool-Registrierung.

Sammelt:

- vorhandene Subagent-Dateien
- agents/*.md
- Extension-Dateien
- Subagent-Registry
- Tool-Registrierung
- Sichtbarkeit in /tools, falls technisch verfügbar
- /subagent-list, falls vorhanden
- /subagent-doctor, falls vorhanden
- letzte erkennbare Subagent-Nutzung, falls gespeichert
- Fehler in Pfaden, Namen oder Konfigurationen

Erlaubte Operationen:

- Dateien suchen
- Dateien lesen
- Tool-/Extension-Registry lesen
- vorhandene Diagnosecommands lesen/aufrufen, wenn read-only

Blockierte Operationen:

- Subagenten-Dateien ändern
- Extension neu schreiben
- Konfiguration ändern
- Tools registrieren oder entfernen
- automatische Reparatur

Ausgabeabschnitte:

- Subagent-Dateien
- Agent-Definitionen
- Extension-Dateien
- Tool-Registrierung
- Commands
- Letzte Nutzung
- Nicht gefunden
- Nicht prüfbar
- Status

---

### 15. Tool-/Extension-Check

```text
id: tool-extension-check
name: Tool-/Extension-Check
category: Pi-System
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Sammelt sichtbare Informationen über Tools, Extensions und Registrierungen im Pi-System.

Sammelt:

- vorhandene Tool-Dateien
- Extension-Dateien
- Registry-Dateien
- geladene Tools, falls sichtbar
- Commands/Tool-Namen
- fehlerhafte oder doppelte Registrierungen, soweit erkennbar

Erlaubte Operationen:

- Dateien suchen
- Dateien lesen
- Registry lesen
- read-only Diagnose ausführen

Blockierte Operationen:

- Tool-Dateien ändern
- Extension-Dateien ändern
- Registry ändern
- Tools aktivieren/deaktivieren
- automatische Reparatur

Ausgabeabschnitte:

- Tools
- Extensions
- Registry
- Sichtbarkeit
- Doppelte Einträge
- Nicht gefunden
- Nicht prüfbar
- Status

---

## Kategorie: Checks

### 16. Test-/Build-Check

```text
id: test-build-check
name: Test-/Build-Check
category: Checks
profile: command-limited
inputMode: optional
requiresConfirmation: true
```

Zweck:

Führt definierte Test-, Lint- oder Build-Kommandos aus und zeigt die Ergebnisse.

Wichtig:

Dieser Skill ist nicht strikt read-only, weil Tests und Builds Cache-, Coverage-, Log- oder Build-Dateien erzeugen können.

Erlaubte Commands nur per Allowlist:

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

Blockierte Commands:

- freie Shell-Kommandos
- install-Kommandos
- rm/delete
- git write commands
- deploy commands
- publish commands

Ausgabeabschnitte:

- Erkannter Paketmanager
- Gefundene Scripts
- Ausgeführte Commands
- Ergebnis
- Fehlerausgabe
- Nicht ausgeführt
- Status

---

### 17. Release-/Deploy-Check

```text
id: release-deploy-check
name: Release-/Deploy-Check
category: Checks
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Sammelt Informationen darüber, ob das Projekt Deploy-/Release-Strukturen besitzt.

Sammelt:

- Build-Scripts
- Deploy-Konfiguration
- GitHub Actions
- Cloudflare/Vercel/Netlify-Konfiguration
- Environment-Beispiele
- Release-Dokumentation
- CI-Konfiguration

Erlaubte Operationen:

- Dateien suchen
- Dateien lesen
- Workflows lesen
- Konfigurationsdateien lesen

Blockierte Operationen:

- Build ausführen
- Deploy ausführen
- Secrets ändern
- Workflows ändern
- Releases erstellen

Ausgabeabschnitte:

- Build
- Deploy-Konfiguration
- CI/CD
- Environment
- Release-Dokumentation
- Nicht gefunden
- Nicht prüfbar
- Status

---

### 18. Security-Surface-Check

```text
id: security-surface-check
name: Security-Surface-Check
category: Checks
profile: read-only
inputMode: optional
requiresConfirmation: false
```

Zweck:

Sammelt sichtbare Sicherheitsflächen im Projekt, ohne Exploit-Anleitungen oder Änderungen zu erzeugen.

Sammelt:

- .env-Hinweise
- API-Key-Verwendung
- unsichere Scripts
- Child-Process-Nutzung
- Shell-Ausführung
- Permissions
- Netzwerkzugriffe
- Auth-Konfiguration
- sensible Dateien
- öffentlich sichtbare Secrets-Hinweise

Erlaubte Operationen:

- Dateien suchen
- Dateien lesen
- statische Treffer anzeigen

Blockierte Operationen:

- Exploit-Erstellung
- Angriffsschritte
- Secrets ausgeben, falls gefunden
- Änderungen an Sicherheitskonfiguration
- automatische Fixes

Ausgabeabschnitte:

- Sichtbare Sicherheitsflächen
- Potenziell sensible Dateien
- Shell/Child-Process
- Netzwerk/Auth
- Nicht gefunden
- Nicht prüfbar
- Status

---

## Empfohlene Umsetzungsreihenfolge

### Phase 1: Skill-Launcher und Registry

- Shift+Tab → Skills ergänzen
- Skill-Untermenü anzeigen
- Skill-Metadaten anzeigen
- Skill auswählen
- Rückkehr zum vorherigen Modus

Noch keine komplexe Ausführung.

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

### Phase 5: Erweiterte Checks

Später umsetzen:

11. Dependency-/Config-Check
12. Issues & PRs lesen
13. Tool-/Extension-Check
14. Test-/Build-Check
15. Release-/Deploy-Check
16. Security-Surface-Check
17. Agent-Dokumente einrichten

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
9. Alle Skills haben ein einheitliches Ausgabeformat.
10. Alle MVP-Skills wurden manuell getestet.
11. Bestehende Plan-/Work-Modi funktionieren weiterhin.
12. Bestehende Modell-/Thinking-/Permission-Menüs funktionieren weiterhin.
13. Die dauerhaft relevanten Informationen wurden in finaler Projekt-/Entwicklerdokumentation oder direkt in Skill-Dateien übernommen.
14. Dieses Dokument wurde nach Abschluss entfernt.
