# Historischer Plan: menügeführter Skill-Launcher für Pi

> **Abgelöst durch Phase 4 — nicht umsetzen.** Dieser Entwurf beschreibt den
> verworfenen Eigenbau `extensions/skill-mode` mit Shift+Tab-Menü,
> Ausführungsmodi und eigenen Permission-Profilen. Pi nutzt stattdessen native
> Skills unter `skills/<name>/SKILL.md`, aufrufbar über `/skill:<name>`.
> Die hier beschriebenen Menü-, Modus- und Profilmechanismen dürfen nicht als
> aktuelle Implementierungsvorgabe verwendet werden; die Datei bleibt nur als
> historische Referenz erhalten.

Status: historisch / abgelöst
Zielsystem: Pi Coding Agent  
Zieldateien:

```text
docs/skills/skill-catalog.md
docs/skills/agent-docs-skill-reference.md
```

---

## Ziel

Pi soll einen menügeführten Skill-Launcher bekommen.

Der Nutzer soll Skills über die bestehende Shift+Tab-Steuerung auswählen können, ohne Slash-Commands oder manuelle Befehle eintippen zu müssen.

Gewünschter Ablauf:

```text
Shift+Tab
→ Skills
→ Skill-Kategorie auswählen
→ Skill auswählen
→ Skill-Details anzeigen
→ optionale Aufgabe/Eingabe abfragen
→ Skill mit eigenem Profil ausführen
→ Ergebnis anzeigen
→ zurück zum vorherigen Modus
```

Skills sind keine dauerhaften Modi. Sie sind einmalige, gezielte Aktionen mit eigenem Rechteprofil.

---

## Verbindliche Referenzen

### Skill-Katalog

Der allgemeine Skill-Katalog ist die fachliche Quelle für:

- Skill-Namen
- Skill-IDs
- Kategorien
- Profile
- erlaubte Operationen
- blockierte Operationen
- Ausgabeformate
- empfohlene Umsetzungsreihenfolge
- Löschregel nach vollständiger Umsetzung

Pfad:

```text
docs/skills/skill-catalog.md
```

### Agenten-Dokumente-Skills

Die Agenten-Dokumente-Skills müssen zusätzlich die Spezialreferenz einhalten.

Pfad:

```text
docs/skills/agent-docs-skill-reference.md
```

Diese Referenz gilt verbindlich für:

- `agent-docs-check`
- `agent-docs-setup-preview`
- `agent-docs-setup`
- `agent-docs-review`

Wichtig:

Die Agenten-Dokumente-Skills arbeiten nach dem Modell:

```text
Phase 1 = read-only Analyse / Review
Phase 2 = Schreiben nur nach explizitem Go
```

---

## Nicht-Ziele

- Kein dauerhafter Skill-Modus.
- Keine Pflicht zur Nutzung von Slash-Commands.
- Keine neue komplexe Multi-Agent-Architektur.
- Keine blinde Neuimplementierung des bestehenden Modus-Systems.
- Keine Entfernung bestehender Plan-/Work-Modi.
- Keine Schreiboperationen durch read-only Skills.
- Keine automatische Planerstellung durch normale Informations-Skills.
- Kein automatischer Wechsel in den Workmodus.
- Keine versteckten Seiteneffekte.
- Keine Schwächung der bestehenden Permission-Logik.
- Keine Änderungen an produktiven Dateien, bevor die bestehende Architektur analysiert wurde.
- Kein vollständiger Quellcode schreiben, bevor der Nutzer ausdrücklich `Go` sagt.

---

## Grundentscheidung

Nicht bauen:

```text
Shift+Tab → Skill-Modus dauerhaft aktiv
```

Stattdessen bauen:

```text
Shift+Tab → Skills → Skill auswählen → Skill läuft einmalig → zurück zum vorherigen Modus
```

Begründung:

- Planmodus bleibt für Planung zuständig.
- Workmodus bleibt für Änderungen zuständig.
- Skills bleiben gezielte Werkzeuge.
- Read-only Skills können technisch klar abgesichert werden.
- Die UI bleibt verständlich.
- Die Modusverwaltung bleibt einfacher.

---

## Zielstruktur im Shift+Tab-Menü

```text
Shift+Tab
├─ Modus wechseln
│  ├─ Planmodus
│  └─ Workmodus
├─ Skills
│  ├─ Projekt
│  │  ├─ Projektübersicht
│  │  ├─ Datei-/Struktur-Suche
│  │  └─ Dependency-/Config-Check
│  ├─ Git
│  │  ├─ Git-Status
│  │  └─ Letzte Änderungen
│  ├─ GitHub
│  │  └─ Issues & PRs lesen
│  ├─ Code
│  │  ├─ Code-Inspection
│  │  └─ TODO/FIXME-Suche
│  ├─ Dokumente
│  │  ├─ Dokumenten-Diff
│  │  └─ Dokumenten-Konsistenzcheck
│  ├─ Agenten-Dokumente
│  │  ├─ Agent-Dokumente prüfen
│  │  ├─ Agent-Dokumente vorbereiten
│  │  ├─ Agent-Dokumente einrichten
│  │  └─ Agent-Dokumente reviewen
│  ├─ Pi-System
│  │  ├─ Subagent-Doctor
│  │  └─ Tool-/Extension-Check
│  └─ Checks
│     ├─ Test-/Build-Check
│     ├─ Release-/Deploy-Check
│     └─ Security-Surface-Check
├─ Modell wählen
├─ Thinking einstellen
└─ Permissions
```

Für die erste Umsetzung soll nicht jeder Skill vollständig implementiert werden. Zuerst müssen Registry, Menü, Profile und Guards stabil laufen.

---

## MVP-Umfang

Die erste stabile Version soll diese Skills enthalten:

1. Projektübersicht
2. Datei-/Struktur-Suche
3. Git-Status
4. Letzte Änderungen
5. Code-Inspection
6. Subagent-Doctor

Danach:

7. Dokumenten-Diff
8. Dokumenten-Konsistenzcheck
9. Agent-Dokumente prüfen
10. Agent-Dokumente vorbereiten
11. Agent-Dokumente reviewen

Später:

12. Dependency-/Config-Check
13. Issues & PRs lesen
14. Tool-/Extension-Check
15. Test-/Build-Check
16. Release-/Deploy-Check
17. Security-Surface-Check
18. Agent-Dokumente einrichten

---

## Skill-Profile

Jeder Skill muss ein eigenes Profil besitzen.

Minimal benötigte Profile:

```text
read-only
preview-only
command-limited
write
```

### read-only

Darf lesen, suchen und Informationen ausgeben.

Darf nicht:

- Dateien schreiben
- Dateien löschen
- Dateien verschieben
- Code ändern
- Commits erstellen
- Push/Pull/Merge/Rebase ausführen
- Branches erstellen/löschen
- Issues/PRs ändern
- Dependencies installieren

### preview-only

Darf Vorschauen erzeugen, aber nichts schreiben.

Verwendung:

- Agent-Dokumente vorbereiten
- mögliche Dokumentstruktur anzeigen
- Inhalte als Preview ausgeben

### command-limited

Darf nur definierte Allowlist-Commands ausführen.

Verwendung:

- Test-/Build-Check
- Lint-Check

### write

Darf nach expliziter Freigabe Dateien schreiben.

Verwendung:

- Agent-Dokumente einrichten

Write Skills brauchen immer Bestätigung.

---

## Zentrale Sicherheitsregel

Read-only darf nicht nur ein Prompt-Hinweis sein.

Es muss technisch abgesichert werden.

Erforderlich:

- Skill-Kontext enthält `profile`.
- Tool-/Command-Ausführung prüft das Profil.
- Datei-Schreibtools werden bei `read-only` blockiert.
- `apply_patch` oder äquivalente Patch-Werkzeuge werden bei `read-only` blockiert.
- Shell-Kommandos werden bei `read-only` per Allowlist beschränkt.
- Git-Kommandos mit Seiteneffekten werden blockiert.
- GitHub-Schreibaktionen werden blockiert.
- Preview-only darf keine Dateien schreiben.
- Write Skills brauchen explizite Freigabe.

---

## Agenten-Dokumente-Skills: Sonderregeln

Die Agenten-Dokumente-Skills sind absichtlich strenger als normale Informations-Skills.

### `agent-docs-check`

Profil:

```text
read-only
```

Aufgabe:

- Repo analysieren
- vorhandene Agenten-Doku prüfen
- fehlende oder schwache Dateien identifizieren
- Risiken benennen
- Zielaufbau vorschlagen
- am Ende auf Go für Phase 2 warten

Der Skill muss das Ausgabeformat aus `docs/skills/agent-docs-skill-reference.md` verwenden.

### `agent-docs-setup-preview`

Profil:

```text
preview-only
```

Aufgabe:

- sinnvolle Agenten-Dokumente vorschlagen
- Inhalte als Vorschau zeigen
- keine Dateien schreiben
- keine Wunscharchitektur erzeugen
- nur echte Pfade und echte Commands verwenden

### `agent-docs-setup`

Profil:

```text
write
```

Startbedingung:

- read-only Analyse vorhanden
- Preview vorhanden
- Nutzer bestätigt mit `Go`
- Workmodus oder explizite Schreibfreigabe aktiv

Aufgabe:

- nur bestätigte Agenten-Dokumente erstellen oder aktualisieren
- keine Codeänderungen außer explizit freigegebenen Doku-Verweisen
- keine Commits
- kein Push

### `agent-docs-review`

Profil:

```text
read-only
```

Aufgabe:

- bestehendes Agenten-Setup streng prüfen
- Doku gegen Code, Scripts, CI, Deployment und Claude-Code-Struktur vergleichen
- falsche oder nicht belegte Aussagen markieren
- Overengineering benennen
- PASS / PASS MIT NACHARBEIT / FAIL ausgeben

---

## Technisches Vorgehen

### Schritt 1: Analyse

Vor Codeänderungen prüfen:

1. Wo ist die Shift+Tab-Logik implementiert?
2. Wie ist die bestehende Menüstruktur aufgebaut?
3. Wie werden Modi aktuell gespeichert?
4. Wie funktionieren Planmodus und Workmodus?
5. Gibt es bereits Commands, Tools, Extensions oder Skills?
6. Gibt es bereits eine Registry?
7. Wo liegt die Permission-Logik?
8. Wo werden Shell-Kommandos ausgeführt?
9. Wo werden Dateiänderungen durchgeführt?
10. Wo werden Git-/GitHub-Aktionen ausgeführt?

### Schritt 2: Architekturvorschlag

Danach minimalen Integrationsvorschlag liefern:

- betroffene Dateien
- neue Dateien
- bestehende Dateien, die erweitert werden
- Skill-Registry-Konzept
- Skill-Kontext
- Guard-Konzept
- Menüintegration
- Risiken

### Schritt 3: Skill-Launcher-Grundlage

Implementieren nach Freigabe:

- Menüpunkt „Skills“
- Skills-Untermenü
- Kategorien
- Skill-Auswahl
- Skill-Metadaten-Anzeige
- Zurück-Navigation
- vorherigen Modus merken
- nach Abschluss zurückkehren

### Schritt 4: Profile und Guards

Implementieren:

- read-only Guard
- preview-only Guard
- command-limited Guard
- write Guard
- zentrale Blockierung schreibender Operationen

### Schritt 5: MVP-Skills

Implementieren:

- Projektübersicht
- Datei-/Struktur-Suche
- Git-Status
- Letzte Änderungen
- Code-Inspection
- Subagent-Doctor

### Schritt 6: Dokumenten- und Agenten-Dokumente-Skills

Implementieren:

- Dokumenten-Diff
- Dokumenten-Konsistenzcheck
- Agent-Dokumente prüfen
- Agent-Dokumente vorbereiten
- Agent-Dokumente reviewen

### Schritt 7: Erweiterte Skills

Implementieren:

- Dependency-/Config-Check
- Issues & PRs lesen
- Tool-/Extension-Check
- Test-/Build-Check
- Release-/Deploy-Check
- Security-Surface-Check
- Agent-Dokumente einrichten

### Schritt 8: Aufräumen

Wenn alle Skills aus `docs/skills/skill-catalog.md` technisch angelegt, registriert, sichtbar und getestet sind:

1. Prüfen, ob relevante dauerhafte Informationen in finaler Dokumentation oder Skill-Dateien vorhanden sind.
2. `docs/skills/skill-catalog.md` löschen.
3. Prüfen, ob `docs/skills/agent-docs-skill-reference.md` noch benötigt wird oder in finale Skill-Dateien überführt wurde.
4. Falls nicht mehr benötigt, auch diese Referenzdatei löschen.
5. Löschung im Commit klar benennen.

---

## Risiken

1. Zu viele Skills machen das Menü unübersichtlich.
2. Read-only-Regeln nur im Prompt wären zu schwach.
3. Skill-Launcher darf nicht mit Moduswechsel verwechselt werden.
4. Shell-Kommandos brauchen harte Allowlist/Blocklist.
5. Bestehende Shortcuts dürfen nicht beschädigt werden.
6. Bestehende Plan-/Work-Modi dürfen nicht instabil werden.
7. GitHub-Zugriff kann fehlen oder nicht konfiguriert sein.
8. Test-/Build-Check kann Nebenwirkungen erzeugen.
9. Agent-Dokumente einrichten kann bestehende Regeln überschreiben, wenn nicht sauber geschützt.
10. Dokumenten-Diff kann bei großen Dokumenten zu lange oder zu unübersichtlich werden.
11. Agent-Dokumente-Skills dürfen keine erfundenen Pfade, Commands oder Projektentscheidungen erzeugen.

---

## Verifikation

Manuell prüfen:

1. Shift+Tab öffnet weiterhin das Hauptmenü.
2. Menüpunkt „Skills“ ist sichtbar.
3. Skills-Untermenü öffnet sich.
4. Skills werden gruppiert angezeigt.
5. Skill-Auswahl per Tastatur funktioniert.
6. Zurück-Navigation funktioniert.
7. Ein read-only Skill kann gestartet werden.
8. Skill zeigt Name und Profil.
9. Skill fragt bei Bedarf nach Details.
10. Skill sammelt Informationen.
11. Skill erstellt keinen Plan, außer der jeweilige Agenten-Dokumente-Skill verlangt ausdrücklich eine Setup-Analyse.
12. Skill nimmt keine Änderungen vor, wenn das Profil read-only oder preview-only ist.
13. Datei-Schreiboperationen werden bei read-only blockiert.
14. Schreibende Git-Kommandos werden bei read-only blockiert.
15. Schreibende GitHub-Aktionen werden bei read-only blockiert.
16. Preview-only Skills schreiben keine Dateien.
17. Command-limited Skills akzeptieren nur Allowlist-Commands.
18. Write Skills verlangen explizite Freigabe.
19. Nach Abschluss kehrt Pi zum vorherigen Modus zurück.
20. Planmodus funktioniert weiterhin.
21. Workmodus funktioniert weiterhin.
22. Modellwahl funktioniert weiterhin.
23. Thinking-Auswahl funktioniert weiterhin.
24. Permissions-Menü funktioniert weiterhin.
25. Keine bestehenden Shortcuts wurden beschädigt.
26. Agenten-Dokumente-Skills halten `docs/skills/agent-docs-skill-reference.md` ein.

---

## Ausgabeformat für den Coding-Agenten vor Umsetzung

Der Coding-Agent soll vor der Umsetzung zuerst liefern:

1. Gefundene relevante Dateien
2. Bestehende Shift+Tab-Logik
3. Bestehende Moduslogik
4. Bestehende Command-/Tool-/Extension-/Skill-Struktur
5. Bestehende Sicherheits-/Permission-Logik
6. Minimaler Integrationsvorschlag
7. Betroffene Dateien
8. Neue Dateien
9. Risiken
10. Manuelle Testfälle
11. Konkreter Änderungsplan

Wichtig:

Noch keinen vollständigen Quellcode schreiben.  
Noch keine Dateien ändern.  
Erst nach ausdrücklicher Freigabe mit `Go` implementieren.

---

## Arbeitsauftrag für Coding-Agent

Rolle:
Du bist ein erfahrener TypeScript/Node.js-Architektur- und Coding-Agent für Pi Coding Agent, TUI-Menüs, Skill-Systeme, sichere Tool-Orchestrierung, Modusverwaltung, Git-/GitHub-Inspection, Dokumentenprüfung und read-only Entwickler-Workflows.

Ziel:
Analysiere und plane die Erweiterung von Pi um einen menügeführten Skill-Launcher. Der Nutzer soll über Shift+Tab eine Skill-Liste öffnen und Skills direkt aus dem Menü auswählen können. Slash-Commands dürfen optional intern bestehen, dürfen aber nicht die primäre Bedienung sein.

Nutze diese Dokumente verbindlich:

```text
docs/skills/skill-catalog.md
docs/skills/agent-docs-skill-reference.md
```

Nicht-Ziele:

- Kein dauerhafter Skill-Modus.
- Keine Pflicht zur Nutzung von Slash-Commands.
- Keine blinde Neuimplementierung.
- Keine Änderungen an Plan-/Work-Modus ohne zwingenden Grund.
- Keine Schreiboperationen durch read-only Skills.
- Keine Codeänderungen ohne Freigabe.

Vorgehen:

1. Untersuche die bestehende Shift+Tab-Logik.
2. Untersuche die bestehende Modusverwaltung.
3. Suche bestehende Command-, Tool-, Extension- oder Skill-Registries.
4. Suche bestehende Permission-/Guard-Logik.
5. Entwirf eine minimale Skill-Registry oder erweitere eine vorhandene Registry.
6. Entwirf ein Skill-Profil-System mit read-only, preview-only, command-limited und write.
7. Entwirf zentrale Guards gegen schreibende Operationen.
8. Plane die Menüintegration unter Shift+Tab → Skills.
9. Plane die MVP-Skills anhand des Skill-Katalogs.
10. Plane die Dokumenten- und Agenten-Dokumente-Skills anhand beider Referenzdokumente.
11. Liefere Risiken und manuelle Testfälle.
12. Warte auf `Go`, bevor Code geändert wird.

Abschlusskriterien:

- Skills sind über Shift+Tab erreichbar.
- Skills werden als Menü weitergeführt.
- Nutzer muss keine Slash-Commands verwenden.
- Skill-Liste ist gruppiert und verständlich.
- Skills haben eigene Profile.
- Read-only Skills sind technisch abgesichert.
- Preview-only Skills schreiben nichts.
- Command-limited Skills nutzen Allowlist.
- Write Skills verlangen Freigabe.
- Agenten-Dokumente-Skills halten `docs/skills/agent-docs-skill-reference.md` ein.
- Nach Skill-Ausführung kehrt Pi zum vorherigen Modus zurück.
- Bestehende Modi und Menüs bleiben stabil.

Schwierigkeiten: 8/10 | Thinking: high
