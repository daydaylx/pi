# Referenz: Agenten-Dokumente-Skills

> **Historische Referenz — durch Phase 4 abgelöst, nicht umsetzen.** Die hier
> beschriebenen `agent-docs-*`-Skills, ihre Shift+Tab-Integration und ihre
> eigenen Rechteprofile gehören zum verworfenen Skill-Launcher. Aktive
> Pi-Skills werden stattdessen nativ aus `skills/<name>/SKILL.md` entdeckt und
> mit `/skill:<name>` aufgerufen. Diese Profil- und Menüregeln ersetzen oder
> erweitern die zentrale Permission-Policy nicht und dürfen nicht als
> Implementierungsvorgabe verwendet werden.

Status: historisch / abgelöst
Gilt für: `agent-docs-check`, `agent-docs-setup-preview`, `agent-docs-setup`, `agent-docs-review`  
Ziel: Agenten-Dokumentation nicht generisch, sondern kontrolliert, repo-basiert und praktisch nutzbar erstellen oder prüfen.

---

## Zweck

Die Agenten-Dokumente-Skills sollen Projekte so vorbereiten oder prüfen, dass Coding-Agenten wie Claude Code, Codex, Gemini CLI, Kilo Code, OpenCode und vergleichbare Tools zuverlässig arbeiten können.

Nicht Ziel ist Doku-Bürokratie. Ein Dokument ist nur sinnvoll, wenn es Agentenarbeit konkret verbessert, echte Projektentscheidungen absichert, Prüfungen klarer macht, veraltete Doku ersetzt oder wiederkehrende Fehler verhindert.

---

## Grundregel

Die Agenten-Dokumente-Skills müssen nach einem zweistufigen Sicherheitsmodell arbeiten:

```text
Phase 1 = read-only Analyse / Review
Phase 2 = Schreiben nur nach explizitem Go
```

Das gilt besonders für:

- `agent-docs-check`
- `agent-docs-setup-preview`
- `agent-docs-setup`
- `agent-docs-review`

---

## Skill: Agent-Dokumente prüfen

```text
id: agent-docs-check
profile: read-only
```

### Aufgabe

Prüfen, ob ein Repository sauber für agentische Coding-Workflows vorbereitet ist.

### Darf

- Dateien lesen
- Repo-Struktur analysieren
- Scripts und Konfigurationen prüfen
- vorhandene Doku bewerten
- fehlende Agenten-Dokumente identifizieren
- Risiken und Widersprüche beschreiben
- einen Bericht ausgeben

### Darf nicht

- Dateien ändern
- Dateien erstellen
- Dateien löschen
- formatieren
- refactoren
- Commits erstellen
- Branches ändern
- eine Einrichtung automatisch starten

### Muss prüfen

1. Projektgrundlage
   - `README.md`
   - Package-/Build-Dateien
   - Framework/Stack
   - App-/Service-Struktur
   - Einstiegspunkte
   - Teststruktur
   - Deployment-Struktur

2. Bestehende Agenten-Dateien
   - `AGENTS.md`
   - `CLAUDE.md`
   - `GEMINI.md`
   - `.github/copilot-instructions.md`
   - `.cursorrules`
   - `.windsurfrules`
   - `.clinerules`
   - `.kilocode/rules`
   - sonstige Agenten-/Tool-Regeln

3. Claude-Code-Struktur
   - `.claude/`
   - `.claude/settings.json`
   - `.claude/settings.local.json`
   - `.claude/rules/`
   - `.claude/agents/`
   - `.claude/commands/`
   - Hooks oder Skills

4. Projektdokumentation
   - `docs/`
   - Architektur
   - Konzept
   - Workflow
   - Deployment
   - Testing
   - Security/Privacy
   - UI/Design
   - Datenmodell
   - Statusdateien
   - historische/veraltete Reports

5. Automatisierung und Qualität
   - CI-Workflows
   - Linting
   - Typecheck
   - Tests
   - Build
   - Smoke-Tests
   - E2E-Tests
   - lokale Scripts
   - Git Hooks

6. Risiken
   - sensible Daten
   - Secrets
   - lokale Nutzerdaten
   - API-Keys
   - Deployment-Credentials
   - Produktentscheidungen, die Agenten leicht versehentlich ändern könnten

### Ausgabeformat

Der Skill muss exakt diese Struktur liefern:

```markdown
# Agenten-Setup-Analyse

## Gesamturteil

Kurze Einschätzung:

* gut vorbereitet
* teilweise vorbereitet
* kaum vorbereitet

## Gefundene vorhandene Dateien

| Datei | Vorhanden | Inhaltlicher Zustand | Problem |
| ----- | --------: | -------------------- | ------- |

## Fehlende oder schwache Dateien

| Datei | Priorität | Warum nötig | Sollte erstellt/geändert werden? |
| ----- | --------- | ----------- | -------------------------------- |

## Empfohlener Zielaufbau

```text
AGENTS.md
CLAUDE.md
docs/
  CODEMAP.md
  AGENT_CONTEXT_PACKS.md
  CURRENT_STATUS.md
  VALIDATION_MATRIX.md
  ...
.claude/
  rules/
  agents/
```

## Konkreter Umsetzungsplan

Schritte in sinnvoller Reihenfolge.

## Risiken

Liste Risiken.

## Benötigte Entscheidung von mir

Liste nur echte Entscheidungen, die nicht aus dem Repo ableitbar sind.

## Wartepunkt

Warte auf dein Go für Phase 2.
```

---

## Skill: Agent-Dokumente vorbereiten

```text
id: agent-docs-setup-preview
profile: preview-only
```

### Aufgabe

Eine Vorschau erzeugen, welche Agenten-Dokumente sinnvoll wären und wie sie aufgebaut sein sollten.

### Darf

- vorhandene Dateien lesen
- sinnvolle Zielstruktur vorschlagen
- Inhalte als Vorschau ausgeben
- geplante Änderungen beschreiben
- echte Pfade und echte Commands verwenden

### Darf nicht

- Dateien schreiben
- Dateien überschreiben
- Dateien löschen
- Änderungen anwenden
- Commits erstellen
- Push ausführen
- Wunscharchitektur erfinden
- nicht belegte Projektannahmen als Fakt ausgeben

### Ziel-Dateien nach Bedarf

Nicht jedes Projekt braucht alle Dateien. Der Skill muss anhand des echten Projektkontexts entscheiden.

Standard-Dateien:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/CODEMAP.md`
- `docs/AGENT_CONTEXT_PACKS.md`
- `docs/CURRENT_STATUS.md`
- `docs/VALIDATION_MATRIX.md`
- `docs/DECISIONS/README.md`
- `docs/decisions/*.md`
- `docs/SECURITY_PRIVACY_CONTEXT.md`
- `docs/PRIVACY_CONTEXT.md`
- `docs/MANUAL_TEST_SCENARIOS.md`

Nur bei UI-/App-Projekten:

- `docs/UI_CONTEXT.md`
- `docs/DESIGN_CONTEXT.md`

Nur bei Projekten mit Daten/Persistenz:

- `docs/DATA_MODEL.md`

Nur bei Deployment-/Hosting-Projekten:

- `docs/DEPLOYMENT_CONTEXT.md`

Nur bei KI-/LLM-/Provider-Projekten:

- `docs/MODEL_PROVIDER_CONTEXT.md`

Nur bei größeren Projekten:

- `.claude/rules/*.md`
- `.claude/agents/*.md`
- `.claude/commands/*.md`

---

## Skill: Agent-Dokumente einrichten

```text
id: agent-docs-setup
profile: write
requiresConfirmation: true
```

### Startbedingung

Dieser Skill darf erst nach einer read-only Analyse und einer Preview laufen.

Er muss stoppen, wenn kein bestätigter Plan oder keine ausdrückliche Freigabe vorliegt.

### Ablauf

```text
1. Bestehende Dokumente prüfen
2. Fehlende oder schwache Dokumente anzeigen
3. Vorschau erzeugen
4. Nutzer bestätigt mit Go
5. Nur bestätigte Dateien erstellen oder aktualisieren
6. Passende Checks ausführen, falls vorhanden und sinnvoll
7. Ergebnisbericht ausgeben
```

### Darf nach Go

- bestätigte Agenten-Dokumente erstellen
- bestätigte Agenten-Dokumente aktualisieren
- kurze Claude-Code-Kompatibilitätsschicht anlegen
- Context Packs, Codemap, Validation Matrix oder Statusdateien erstellen, wenn im Projektkontext sinnvoll

### Darf nie ohne Go

- Dateien schreiben
- Dateien überschreiben
- Dateien löschen
- Code ändern
- Commits erstellen
- Push ausführen
- persönliche Settings schreiben
- Secrets anfassen

### Nach Phase 2 Ausgabeformat

```markdown
# Agenten-Setup abgeschlossen

## Geänderte Dateien

| Datei | Aktion | Zweck |
| ----- | ------ | ----- |

## Neuer Agenten-Workflow

Kurz erklären:

* welche Datei Agenten zuerst lesen sollen
* wann Context Packs genutzt werden
* welche Checks bei Änderungen gelten
* wie Claude Code eingebunden ist

## Verifikation

| Check | Ergebnis | Hinweis |
| ----- | -------- | ------- |

## Offene Punkte

Nur echte offene Punkte.

## Nutzung für zukünftige Prompts

1. Analyse-only
2. Umsetzung nach Context Pack
3. Strenger Review

## Abnahme

Fertig
```

oder:

```text
Fertig mit offenen Punkten
```

---

## Skill: Agent-Dokumente reviewen

```text
id: agent-docs-review
name: Agent-Dokumente reviewen
category: Agenten-Dokumente
profile: read-only
inputMode: optional
requiresConfirmation: false
```

### Aufgabe

Streng prüfen, ob ein vorhandenes Agenten-Setup korrekt, vollständig, widerspruchsfrei, praktisch nutzbar und mit dem aktuellen Codebestand vereinbar ist.

### Darf

- Dateien lesen
- suchen
- Git-Status prüfen
- Scripts und Konfigurationen prüfen
- vorhandene Doku gegen Code vergleichen
- Widersprüche dokumentieren
- konkrete Nacharbeiten empfehlen

### Darf nicht

- Dateien ändern
- Dateien erstellen
- Dateien löschen
- Formatierung ändern
- Hooks installieren
- Settings ändern
- Tests anpassen
- Issues schließen
- Commits erstellen
- Branches ändern

### Muss prüfen

1. Git-Status
2. `README.md`
3. `AGENTS.md`, falls vorhanden
4. `CLAUDE.md`, falls vorhanden
5. `GEMINI.md`, falls vorhanden
6. relevante `docs/`-Dateien
7. relevante `.claude/`-Dateien
8. Package-/Build-Dateien
9. CI-Workflows
10. Testkonfiguration
11. Deployment-Dateien
12. echte Code-Einstiegspunkte
13. Widersprüche zwischen Doku und Code
14. Overengineering
15. Security/Privacy

### Ausgabeformat

Der Skill muss exakt diese Struktur liefern:

```markdown
# Review: Agenten-Setup

## Gesamturteil

PASS / PASS MIT NACHARBEIT / FAIL

## Geprüfte Quellen

Liste der wichtigsten gelesenen Dateien und Konfigurationen.

## Git-Status

sauber / uncommitted Änderungen vorhanden / unklar

## Ergebnis nach Bereich

| Bereich | Urteil | Begründung |
| ------- | ------ | ---------- |
| AGENTS.md / CLAUDE.md | | |
| CODEMAP | | |
| Context Packs | | |
| Validation Matrix | | |
| Current Status | | |
| ADRs / Decisions | | |
| UI / Design Context | | |
| Data Model | | |
| Security / Privacy | | |
| Manual Tests | | |
| Claude-Code Settings | | |
| Rules / Subagents | | |

## Gefundene Probleme

| Priorität | Bereich | Problem | Datei/Pfad | Warum relevant | Empfehlung |
| --------- | ------- | ------- | ---------- | -------------- | ---------- |

## Widersprüche

## Falsche oder nicht belegte Aussagen

## Overengineering-Prüfung

## Konkrete Nacharbeit

## Abnahmeentscheidung

PASS / PASS MIT NACHARBEIT / FAIL
```

---

## Designprinzipien für erzeugte Agenten-Dokumente

### `AGENTS.md`

- zentrale, tool-neutrale Agenten-Regeldatei
- kurz, hart, konkret
- keine langen Architekturromane
- enthält Source-Priority, Workflow-Regeln, No-Go-Regeln, wichtige Checks

### `CLAUDE.md`

- dünne Claude-Code-Kompatibilitätsschicht
- importiert nach Möglichkeit `@AGENTS.md`
- enthält nur Claude-spezifische Ergänzungen
- nicht mit langen Doku-Inhalten überladen

### `docs/CODEMAP.md`

- schnelle Projektkarte
- reale Pfade
- Einstiegspunkte
- Hauptbereiche
- kritische Dateien
- Daten-/UI-/Build-Flüsse
- Links zu Detaildoku

### `docs/AGENT_CONTEXT_PACKS.md`

- wichtigste Datei für praktische Agentenarbeit
- Format: Aufgabe → Dateien → Risiken → Checks
- keine allgemeinen Erklärungen
- task-basiert und direkt nutzbar

### `docs/VALIDATION_MATRIX.md`

- Änderungstyp → Mindestprüfung → erweiterte Prüfung
- nur echte Commands verwenden
- keine erfundenen Scripts

### `docs/CURRENT_STATUS.md`

- aktueller Stand
- aktive Prioritäten
- offene Punkte
- letzte erfolgreiche Verifikation
- veraltete/historische Doku klar markieren

### `docs/decisions/*.md`

- kurze ADRs
- nur echte Entscheidungen
- Status, Kontext, Entscheidung, Konsequenzen
- Konsequenzen speziell für Agentenarbeit nennen

### `.claude/rules/`

- nur bei größeren Projekten oder klaren Teilbereichen
- path-spezifische Regeln nutzen, wenn sinnvoll
- nicht alles global laden

### `.claude/agents/`

- nur erstellen, wenn wiederkehrende Spezialaufgaben sinnvoll sind
- Tool-Rechte möglichst begrenzen

### `.claude/settings.json`

- nur projektweite, teamtaugliche Einstellungen
- keine persönlichen Einstellungen
- keine Secrets
- keine lokalen Pfade

---

## Anti-Hallucination-Regeln

- Keine Aussagen über Dateien, Scripts, Architektur oder Projektstatus ohne Prüfung der relevanten Dateien.
- Wenn etwas nicht eindeutig belegbar ist: `Nicht verifiziert`, `Unklar` oder `Nicht im aktuellen Code belegt` schreiben.
- Keine erfundenen Pfade.
- Keine erfundenen Commands.
- Keine erfundenen Projektentscheidungen.
- Keine Wunscharchitektur.
- Nur auf Basis des aktuellen Repos arbeiten.

---

## Anti-Overengineering-Regeln

Empfiehl oder erstelle keine Dokumente nur, weil sie theoretisch sauber wirken.

Ein Dokument ist nur sinnvoll, wenn es mindestens eines davon erfüllt:

- Agentenarbeit konkret verbessern
- echte Projektentscheidungen absichern
- Prüfungen klarer machen
- veraltete Doku ersetzen
- wiederkehrende Fehler verhindern
- Sicherheit/Privacy verbessern

Keine Doku-Deko. Keine Dokumentationsbürokratie.

---

## Bezug zum OpenCode-/Phasenworkflow

Wenn ein Projekt zusätzlich mit OpenCode-Phasen arbeitet, müssen die Agenten-Dokumente-Skills den kontrollierten Ablauf respektieren:

```text
/auftrag
→ /kontext
→ /implementierplan
→ /arbeitsmodus
→ /review
```

Für kleine Aufgaben darf ein verkürzter Ablauf möglich sein:

```text
/auftrag
→ /arbeitsmodus
→ /review
```

Für größere oder riskante Aufgaben gilt der vollständige Ablauf.

Die wichtigste Regel:

```text
Keine Umsetzung vor Arbeitsmodus.
Kein Arbeitsmodus ohne freigegebenen Plan bei größeren Aufgaben.
Keine Aufgabe gilt ohne Review als fertig.
```

---

## Abschlusskriterien

Die Agenten-Dokumente-Skills gelten erst als sauber spezifiziert, wenn:

1. `agent-docs-check` read-only arbeitet.
2. `agent-docs-setup-preview` nur Vorschauen erzeugt.
3. `agent-docs-setup` erst nach Go schreibt.
4. `agent-docs-review` read-only prüft.
5. Alle vier Skills im Menü sichtbar sind.
6. Alle vier Skills auf diese Referenzdatei verweisen.
7. Keine der Skills erfundene Pfade oder Commands ausgibt.
8. Keine der Skills Doku-Bürokratie erzeugt.
9. Write-Aktionen technisch blockiert sind, solange keine Freigabe vorliegt.
