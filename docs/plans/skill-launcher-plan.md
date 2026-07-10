# Plan und Arbeitsauftrag: Menügeführter Skill-Launcher für Pi

Status: Entwurf / Arbeitsauftrag  
Zielsystem: Pi Coding Agent  
Zieldatei für Skill-Spezifikation: [`docs/skills/skill-catalog.md`](../skills/skill-catalog.md)

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

## Verweis auf Skill-Katalog

Alle vorgesehenen Skills, Profile, Ausgabeformate, Rechte und Umsetzungsphasen sind im Skill-Katalog beschrieben:

```text
docs/skills/skill-catalog.md
```

Der Skill-Katalog ist während der Implementierung die fachliche Quelle für:

- Skill-Namen
- Skill-IDs
- Kategorien
- Profile
- erlaubte Operationen
- blockierte Operationen
- Ausgabeformate
- empfohlene Umsetzungsreihenfolge
- Löschregel nach vollständiger Umsetzung

Wichtig:

Wenn alle Skills aus dem Skill-Katalog angelegt, registriert, über das Menü auswählbar und getestet wurden, soll `docs/skills/skill-catalog.md` gelöscht werden.

Vor dem Löschen muss geprüft werden, ob die dauerhaft relevanten Informationen in Skill-Definitionen, Registry, Tests oder finaler Entwicklerdokumentation enthalten sind.

---

## Nicht-Ziele

- Kein dauerhafter Skill-Modus.
- Keine Pflicht zur Nutzung von Slash-Commands.
- Keine neue komplexe Multi-Agent-Architektur.
- Keine blinde Neuimplementierung des bestehenden Modus-Systems.
- Keine Entfernung bestehender Plan-/Work-Modi.
- Keine Schreiboperationen durch read-only Skills.
- Keine automatische Planerstellung durch Informations-Skills.
- Kein automatischer Wechsel in den Workmodus.
- Keine versteckten Seiteneffekte.
- Keine Schwächung der bestehenden Permission-Logik.
- Keine Änderungen an produktiven Dateien, bevor die bestehende Architektur analysiert wurde.
- Kein vollständiger Quellcode schreiben, bevor der Nutzer ausdrücklich „Go“ sagt.

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

Gewünschte Menüstruktur:

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
│  │  └─ Agent-Dokumente einrichten
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

Für die erste Umsetzung soll nicht zwingend jeder Skill vollständig implementiert werden. Zuerst sollen Registry, Menü, Profile und MVP-Skills stabil laufen.

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

Später:

11. Dependency-/Config-Check
12. Issues & PRs lesen
13. Tool-/Extension-Check
14. Test-/Build-Check
15. Release-/Deploy-Check
16. Security-Surface-Check
17. Agent-Dokumente einrichten

Details stehen in `docs/skills/skill-catalog.md`.

---

## Rechteprofile

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
- Pläne als Hauptausgabe erstellen

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

## Erlaubte Git-Kommandos für read-only Skills

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

## Blockierte Git-Kommandos für read-only Skills

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

## Skill-Registry

Prüfe zuerst, ob bereits eine Registry für Commands, Tools, Extensions oder Skills existiert.

Falls vorhanden:

- Bestehende Registry verwenden.
- Keine zweite parallele Registry bauen.
- Skill-Metadaten minimal ergänzen.

Falls nicht vorhanden:

- einfache Skill-Registry erstellen.
- keine komplexe Plugin-Architektur bauen.

Jeder Skill braucht mindestens:

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
handler oder entrypoint
```

---

## Menüanforderungen

1. Shift+Tab öffnet weiterhin das Hauptmenü.
2. Menüpunkt „Skills“ wird ergänzt.
3. „Skills“ öffnet ein Untermenü.
4. Das Untermenü zeigt Skills gruppiert nach Kategorie.
5. Jeder Skill zeigt:
   - Name
   - Kurzbeschreibung
   - Profil
6. Navigation per Tastatur:
   - Pfeile hoch/runter
   - Enter zum Auswählen
   - Esc oder Zurück zum vorherigen Menü
7. Optional später:
   - Suche/Filter innerhalb der Skill-Liste
   - Anzeige „zuletzt genutzt“
   - Anzeige „verfügbar/nicht verfügbar“
8. Der Nutzer muss keinen Slash-Command kennen oder eintippen.

---

## Ablauf einer Skill-Ausführung

1. Vorherigen Modus speichern.
2. Skill-Kontext erzeugen.
3. Skill-Profil setzen.
4. Skill-Details anzeigen.
5. Falls Input nötig ist, Nutzer nach Aufgabe fragen.
6. Guard aktivieren.
7. Skill ausführen.
8. Ergebnis im definierten Ausgabeformat anzeigen.
9. Guard beenden.
10. Zum vorherigen Modus zurückkehren.

Beispiel:

```text
Vorheriger Modus: Workmodus
Nutzer: Shift+Tab → Skills → Git → Git-Status
Pi: Skill: Git-Status
Pi: Profil: read-only
Pi: Schreibzugriff: gesperrt
Pi: Welche Informationen sollen gesammelt werden?
Nutzer: Status, Branches, Remote und letzte Commits.
Pi: führt nur read-only Prüfung aus
Pi: zeigt Ergebnis
Pi: Skill abgeschlossen. Keine Änderungen vorgenommen. Zurück zu: Workmodus.
```

---

## Ausgabeformat für read-only Skills

Read-only Skills sollen das im Skill-Katalog definierte Standardformat nutzen.

Kurzform:

```text
Skill:
<Name>

Profil:
read-only

Anfrage:
<Nutzerauftrag>

Gesammelte Informationen:

1. <Bereich>
- Gefunden:
- Nicht gefunden:
- Nicht prüfbar:

Quellen:
- <Datei/Command/Tool>

Auffälligkeiten als Beobachtung:
- <nur beschreibend>

Status:
Informationssammlung abgeschlossen.
Keine Änderungen vorgenommen.
```

Read-only Skills dürfen keine Plan-/Work-Antwort erzeugen.

---

## Dokumenten- und Agent-Dokumente-Skills

Diese Skills sind wichtig, weil Pi projektorientiert mit Agenten, Prompts, Regeln und Dokumenten arbeitet.

### Dokumenten-Diff

Profil: read-only

Zweck:

- Unterschiede zwischen Dokumenten finden
- fehlende Abschnitte anzeigen
- widersprüchliche Regeln sichtbar machen
- doppelte Inhalte erkennen

Keine Änderungen.

### Dokumenten-Konsistenzcheck

Profil: read-only

Zweck:

- mehrere Dokumente auf widersprüchliche Regeln prüfen
- veraltete oder doppelte Projektregeln sichtbar machen
- fehlende Querverweise anzeigen

Keine Änderungen.

### Agent-Dokumente prüfen

Profil: read-only

Zweck:

- prüfen, ob Agent-Dokumente vorhanden sind
- fehlende Agent-Dokumente anzeigen
- fehlende Regeln sichtbar machen
- Plan-/Work-/Permission-/Testregeln prüfen

Keine Änderungen.

### Agent-Dokumente vorbereiten

Profil: preview-only

Zweck:

- sinnvolle Agent-Dokumente vorschlagen
- Inhalte als Vorschau erzeugen
- nichts schreiben

Keine Änderungen.

### Agent-Dokumente einrichten

Profil: write

Zweck:

- Agent-Dokumente tatsächlich erstellen oder aktualisieren

Nur nach:

- Workmodus oder expliziter Schreibfreigabe
- Vorschau
- Nutzerbestätigung mit „Go“

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

### Schritt 6: Dokumenten-Skills

Implementieren:

- Dokumenten-Diff
- Dokumenten-Konsistenzcheck
- Agent-Dokumente prüfen
- Agent-Dokumente vorbereiten

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
3. Falls nötig, dieses Plan-Dokument aktualisieren.
4. Löschung im Commit klar benennen.

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
11. Skill erstellt keinen Plan.
12. Skill nimmt keine Änderungen vor.
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
Erst nach ausdrücklicher Freigabe mit „Go“ implementieren.

---

## Arbeitsauftrag für Coding-Agent

Rolle:
Du bist ein erfahrener TypeScript/Node.js-Architektur- und Coding-Agent für Pi Coding Agent, TUI-Menüs, Skill-Systeme, sichere Tool-Orchestrierung, Modusverwaltung, Git-/GitHub-Inspection und read-only Entwickler-Workflows.

Ziel:
Analysiere und plane die Erweiterung von Pi um einen menügeführten Skill-Launcher. Der Nutzer soll über Shift+Tab eine Skill-Liste öffnen und Skills direkt aus dem Menü auswählen können. Slash-Commands dürfen optional intern bestehen, dürfen aber nicht die primäre Bedienung sein.

Nutze `docs/skills/skill-catalog.md` als fachliche Skill-Spezifikation.

Nicht-Ziele:

- Kein dauerhafter Skill-Modus.
- Keine Pflicht zur Nutzung von Slash-Commands.
- Keine blinde Neuimplementierung.
- Keine Änderungen an Plan-/Work-Modus ohne zwingenden Grund.
- Keine Schreiboperationen durch read-only Skills.
- Keine Planerstellung durch Informations-Skills.
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
10. Plane die Dokumenten- und Agent-Dokumente-Skills anhand des Skill-Katalogs.
11. Liefere Risiken und manuelle Testfälle.
12. Warte auf „Go“, bevor Code geändert wird.

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
- Info-/Git-/Code-/Dokumenten-/Agent-Dokumente-Skills können Informationen sammeln oder Vorschauen erzeugen.
- Read-only Skills erstellen keine Pläne.
- Read-only Skills ändern nichts.
- Nach Skill-Ausführung kehrt Pi zum vorherigen Modus zurück.
- Bestehende Modi und Menüs bleiben stabil.
- `docs/skills/skill-catalog.md` wird nach vollständiger Anlage aller Skills gelöscht.

Schwierigkeiten: 8/10 | Thinking: high
