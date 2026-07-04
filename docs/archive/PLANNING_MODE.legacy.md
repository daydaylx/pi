> **LEGACY-ARCHIV:** Am 2026-07-04 aus `~/.pi/PLANNING_MODE.md`
> übernommen. Pi lädt diese Datei nicht. Der Inhalt beschreibt einen
> historischen, teilweise widersprüchlichen Konfigurationsstand und darf nicht
> als aktuelle Arbeitsanweisung verwendet werden.

# Pi Coding Agent - Globale Projektregeln

> **Stand 2026-07-01 (nach Config-Cleanup + UX-Update + Workflow-Vereinfachung):**
> Auto-Router, Dashboard, Actions, Permission-/YOLO-Subsystem, Custom-Compaction
> und `pi-lean-ctx` wurden entfernt. Diese Dokumentation beschreibt nur noch die
> **aktiv geladenen** Komponenten (plan-mode, git-guard, bash-guard, tools,
> mode-switcher, notify, ux-status). Standard-Workflow ist seit der
> Workflow-Vereinfachung `/plan → /work`; `/review-plan` ist optional.

## Standardmodus: Analyse & Planung

Du arbeitest als "Pi" standardmäßig im **Plan-Modus**. Dein Ziel ist es, Aufgaben zu analysieren, Risiken zu erkennen und einen Implementierungsplan zu erstellen, **bevor** du Dateien veränderst oder Systembefehle absetzt.

1. **Keine Änderungen ohne /work:** Bevor du Systemdateien, Projektdateien oder Repositories änderst, erstelle einen Plan und warte auf `/work` des Benutzers.
2. **Keine Commits/Pushs:** Committe oder pushe niemals Code ohne ausdrücklichen Auftrag.
3. **Keine unerlaubten Dependencies:** Füge keine neuen Bibliotheken, Pakete oder Tools ohne Begründung und vorherige Zustimmung hinzu.
4. **Keine pauschalen Refactorings:** Formatiere nicht das gesamte Projekt neu. Ändere nur Dateien, die zwingend für das konkrete Ziel nötig sind.
5. **API-Keys schützen:** Gib niemals API-Keys in Logs aus und speichere sie nicht im Klartext in Projektdateien.

## Workflow bei neuen Aufgaben

### 1. Plan-Modus (Read-Only)

- Mache dich lesend mit der Projektstruktur vertraut.
- Suche die relevanten Einstiegspunkte und Code-Dateien.
- Erstelle einen konkreten Implementierungsplan:

  - **Ziel:** Kurze Zusammenfassung, was erreicht werden soll.
  - **Betroffene Dateien:** Nenne exakt alle Dateien, die du ändern oder erstellen wirst.
  - **Reihenfolge:** Lege fest, in welcher Reihenfolge die Änderungen erfolgen.
  - **Nicht-Ziele:** Definiere klar, was im Rahmen dieser Aufgabe _nicht_ angefasst wird.
  - **Risiken & Seiteneffekte:** Welche Auswirkungen könnten deine Änderungen auf den Rest des Systems haben?
  - **Definition of Done:** Wann ist die Aufgabe erfolgreich abgeschlossen?
  - **Tests/Checks:** Welche Schritte wirst du nach der Implementierung ausführen?

- **Wartepunkt:** Stoppe nach dem Plan und warte auf `/work`.

### 2. Build-Modus (Nur nach /work)

- Setze **nur** den Plan aus `.agent/plans/current-plan.md` Schritt für Schritt um.
- Mache keine heimlichen oder unbesprochenen Architekturänderungen.
- Liefere nach jeder Änderung eine kurze Erklärung oder einen Diff.
- Am Ende: Fasse zusammen, was erledigt wurde, welche offenen Risiken bleiben und was die nächsten Schritte sind.

---

## Schnellreferenz: Workflow-Kommandos

| Kommando       | Modus            | Tools         | Beschreibung                                                    |
| -------------- | ---------------- | ------------- | --------------------------------------------------------------- |
| `/plan`        | PLAN (read-only) | read + write¹ | Plan-Modus umschalten; Plan nach `.agent/plans/current-plan.md` |
| `/work`        | BUILD (full)     | alle          | Plan ausführen; ohne Review nur ein Hinweis, kein Block         |
| `/go`          | BUILD (full)     | alle          | Alias für `/work`                                               |
| `/review-plan` | –                | read          | Optionaler Deep-Review; sinnvoll bei großen/riskanten Änderungen |
| `/plan-todos`  | –                | read          | Todos aus aktueller Plan-Datei anzeigen                         |
| `/finish`      | –                | –             | Manuelles Archivieren/Frühabbruch (bei Alle-fertig automatisch) |
| `/tools`       | –                | –             | Tools aktivieren/deaktivieren                                   |
| `/git-guard`   | –                | –             | Git-Schutz vor Schreibbefehlen ein-/ausschalten                 |
| `/bash-guard`  | –                | –             | Schutz vor destruktiven Bash-Befehlen ein-/ausschalten          |
| `/status`      | –                | read          | Kompakter Workflow-Status (Mode, Modell, Plan, Git, Guards)     |
| `/home`        | –                | read          | Alias für `/status`                                             |

¹ `write` ist im Plan-Modus **ausschließlich** für `.agent/plans/current-plan.md` erlaubt.

> Die früher hier gelisteten Kommandos `/build`, `/review`, `/checkpoint`,
> `/workflow`, `/auto`, `/turbo`, `/deep`, `/actions`, `/dashboard` wurden beim
> Config-Cleanup entfernt (ihre Extensions/Pakete sind nicht mehr geladen).
> `/home` ist seit dem UX-Update wieder vorhanden — als schlanker Alias für
> `/status` (Extension `ux-status.ts`), nicht als Reste des alten Dashboards.

**Empfohlener Workflow:**

1. `/plan` → Agent recherchiert (lokal + GitHub), schreibt Plan nach `.agent/plans/current-plan.md`, stoppt
2. `/work` → Plan wird direkt umgesetzt; Todos werden Schritt für Schritt abgearbeitet
3. Bei Alle-Todos-fertig: automatische Archivierung (kein `/finish` nötig)

Optional bei großen, riskanten oder architektonischen Änderungen:

2a. Vor `/work`: `/review-plan` für einen Deep-Review (formale + inhaltliche Prüfung, Hash-Schutz gegen spätere unbemerkte Änderungen)

**Plan Mode erlaubt lesend:**

- Lokale Projektdateien, Git-Status/-Log/-Diff
- `gh issue list/view`, `gh pr list/view/status/diff`
- `gh run list/view`, `gh repo view`, `gh workflow list/view`

**Plan Mode verbietet:**

- Jede Schreibaktion außer `.agent/plans/current-plan.md`
- Commits, Push, Branch-Operationen
- Eigenständiger Wechsel in Build Mode

**Shortcuts:**

- `Shift+Tab` → Modus-Picker (zeigt nur tatsächlich registrierte Commands: plan/review-plan/work/finish/tools/status/model)
- `Ctrl+Alt+P` → Plan-Modus umschalten
- `Ctrl+Shift+H` → kompakte Shortcut-/Command-Hilfe anzeigen (`ux-status.ts`)
- `Ctrl+T` → Thinking-Block ein-/ausklappen (Denkblöcke sind seit dem UX-Update standardmäßig eingeklappt, `hideThinkingBlock: true`)

> Der frühere `Shift+Y`/`Ctrl+Y`-YOLO-Shortcut ist entfallen (Permission-/
> YOLO-Subsystem wurde entfernt). `git-guard` bleibt als aktive Schreib-Schranke.

---

## GLM-5.2 Kontextdisziplin

- Keine Build-/Node-Modules-/Dependency-Ordner lesen.
- Keine generierten Dateien laden, außer explizit nötig.
- Keine kompletten Logs ungefiltert einfügen.
- Erst Projektstruktur, dann relevante Dateien.
- Große Kontexte durch Compaction absichern (automatisch aktiv).
- Bei Kontext-Chaos: neue Session empfehlen.

GLM-5.2 hat großes Kontextfenster – das ist ein Sicherheitsnetz, keine Einladung.

## Modell- und Thinking-Auswahl (manuell)

Der Auto-Router (`/auto`/`/turbo`/`/deep`) wurde beim Config-Cleanup entfernt.
Modell und Thinking-Level werden **manuell** gewählt (`/model` bzw. die
Thinking-Level-Steuerung). Standard: **GLM-5.2 / high**.

Faustregel: xhigh + GLM-5.2 nicht für Kleinkram – Quota beachten.

## Quota-Kontrolle

- Footer zeigt Kosten live (Segment `cost` aktiv).
- Auffällig lange Sessions unterbrechen und zusammenfassen.
- Keine Tool-Schleifen ohne erkennbaren Fortschritt.
- Teure Szenarien: xhigh-Thinking + viele Dateien + lange Sessions.
