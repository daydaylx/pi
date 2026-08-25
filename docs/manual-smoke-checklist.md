# Manuelle Restprüfung

Die automatisierten Prüfungen und diese manuelle Matrix sind getrennte
Nachweise. Was hier steht, lässt sich **nur** in einer echten interaktiven
Pi-Sitzung mit Provider-Zugang beobachten. Jede nicht ausgeführte Zeile bleibt
explizit offen.

Pro Schritt eintragen: **beobachtet** und **bestanden / fehlgeschlagen**. Weicht
etwas ab, den Schritt notieren und `#137` offen lassen.

## Vorbereitung

```bash
cd /home/d/.pi/agent
git status --short                    # Arbeitsbaum dokumentieren
git rev-parse HEAD                    # geprüften Commit-SHA dokumentieren
npm --prefix npm run verify           # Arbeitsbaum prüfen
npm --prefix npm run check:imports    # relative Source-Imports im Arbeitsbaum
npm --prefix npm run check:versioned-tree  # nur nach Commit: exportierten HEAD prüfen
```

`verify` prüft den aktuellen Arbeitsbaum. `check:versioned-tree` exportiert
`HEAD` und belegt damit den versionierten Baum ohne unversionierte Hilfsdateien.
Der GitHub-Workflow „Verify“ ist ein dritter, separater Nachweis und muss den
exakten veröffentlichten SHA nennen. „Verifiziert“ darf nur mit dieser Ebene
und dem geprüften SHA verwendet werden; jede spätere relevante Dateiänderung
macht die Aussage über den Arbeitsbaum veraltet.

## Frische Installation

| #   | Schritt                                          | Erwartet                                                             | Beobachtet | ✓/✗ |
| --- | ------------------------------------------------ | -------------------------------------------------------------------- | ---------- | --- |
| 1   | `npm run install:user -- --apply --target <tmp>` | Installation läuft durch; `APPEND_SYSTEM.md` und `prompts/` sind vorhanden, `docs/archive/session-logs/` fehlt |            |     |
| 2   | `npm ci --prefix <tmp>/npm`                      | `@earendil-works/pi-coding-agent@0.84.3` installiert                 |            |     |
| 3   | Pi im Zielverzeichnis starten                    | Neue Session, Extensions laden, keine unerwarteten Startfehler       |            |     |
| 4   | Fork-Pin prüfen                                  | Installierter Pi-Subagents-Fork entspricht exakt `settings.json` → `packages` |            |     |

## Aurora und Workflow

Für jeden manuellen Lauf vorab Terminal, Terminalversion, Terminalgröße und
Commit-SHA in **Beobachtet** eintragen. Die Matrix wird mindestens in Kitty,
WezTerm und Ghostty ausgeführt.

| #   | Schritt                          | Erwartet                                                                                                                               | Beobachtet | ✓/✗ |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --- |
| 5   | Sitzung öffnen                   | Aurora-Fußzeile sichtbar, eine Zeile                                                                                                   |            |     |
| 6   | Shift+Tab                        | Modusauswahl öffnet sich                                                                                                               |            |     |
| 7   | „Schnellplan" wählen             | Modus aktiv, **kein** Turn startet, vorhandene Plandatei unverändert                                                                   |            |     |
| 8   | Eigenen Planungsauftrag eingeben | Plan wird erstellt, `.agent/plans/current-plan.md` geschrieben                                                                         |            |     |
| 9   | Während des Laufs zusehen        | `DENKT NACH` → `ARBEITET` → `ANTWORTET`, Laufzeit zählt hoch (bei Provider-Pausen ≥4s zwischenzeitlich `WARTET AUF MODELL` — kein Bug) |            |     |
| 10  | Shift+Tab → „Work"               | Modus wechselt, **kein** Turn startet                                                                                                  |            |     |
| 11  | Umsetzungsauftrag eingeben       | Plan erscheint **genau einmal** als Kontext                                                                                            |            |     |
| 12  | Zweiten Work-Turn starten        | Plan wird **nicht** erneut eingebunden                                                                                                 |            |     |
| 13  | Tool-Ausführung beobachten       | Sitzungsübersicht bleibt sichtbar; nur die Aktivitätszeile aktualisiert sich und verschwindet nach dem Tool wieder                                                                 |            |     |

### 14 · Der eigentliche Aurora-Fix

Einen längeren Turn laufen lassen, der einen Retry oder eine automatische
Compaction auslöst (Providerfehler oder sehr langer Kontext).

**Erwartet:** Aurora fällt **zu keinem Zeitpunkt** mitten im Turn auf Leerlauf
zurück. Die Anzeige bleibt aktiv und der Laufzeitzähler läuft weiter, bis der
Turn wirklich abgeschlossen ist. Vor der Korrektur setzte jeder interne
Agentenlauf die Anzeige zurück.

| Beobachtet | ✓/✗ |
| ---------- | --- |
|            |     |

## Verifikation

| #   | Schritt                                | Erwartet                                                                                                   | Beobachtet | ✓/✗ |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------- | --- |
| 15  | `project_check({ profile: "verify" })` | Lauf startet, Ergebnis sichtbar                                                                            |            |     |
| 16  | Sitzungsübersicht danach               | `Prüfung · Bereit` bei grünem Lauf und unveränderter Dateilage; der Footer wiederholt den Routineerfolg nicht |            |     |
| 17  | Datei ändern, Footer prüfen            | Wechsel auf `changed_unverified`                                                                           |            |     |
| 18  | Alles zurücksetzen, Footer prüfen      | `unchanged` — **nicht** `clean`, und es liest sich nicht wie ein Prüfergebnis                              |            |     |
| 19  | Tool-Liste ansehen                     | `verify` bietet nur `typecheck` und `test`; die vollständige Verifikation gibt es nur über `project_check` |            |     |

## Subagent und Berechtigungen

| #   | Schritt                                          | Erwartet                      | Beobachtet | ✓/✗ |
| --- | ------------------------------------------------ | ----------------------------- | ---------- | --- |
| 20  | Read-only `investigator` starten                 | Läuft, liefert Befunde inline |            |     |
| 21  | Im Planmodus `npm test` versuchen                | Blockiert                     |            |     |
| 22  | Im Planmodus Datei außerhalb des Plans schreiben | Blockiert                     |            |     |
| 23  | Im Planmodus Plandatei schreiben                 | Erlaubt                       |            |     |
| 24  | Schreibzugriff auf `.git/config`                 | Bestätigung wird verlangt     |            |     |

## Abschluss

| #   | Schritt                | Erwartet                                     | Beobachtet | ✓/✗ |
| --- | ---------------------- | -------------------------------------------- | ---------- | --- |
| 25  | Sitzung sauber beenden | Kein Fehler beim Herunterfahren              |            |     |
| 26  | Neu laden / fortsetzen | Kein alter Plan wird automatisch eingebunden |            |     |

---

## GitHub-Ruleset-Empfehlung (manuell, nur für Repo-Admins)

1. GitHub: **Settings → Rules → Rulesets → New branch ruleset**.
2. Zielbranch `main` wählen und „Require status checks to pass“ aktivieren.
3. Ausschließlich den Check **Verify** verlangen und die Regel auf den neuesten
   Push-SHA anwenden; direkte Pushes dürfen ihn nicht umgehen.
4. Keine zusätzliche Review-Pflicht hinzufügen. Änderungen speichern und mit
   einem Test-Branch prüfen.

Ohne Adminrecht wird keine Regel umgangen oder automatisiert geändert.

---

Sind alle Zeilen bestanden, kann `#137` geschlossen und das Endurteil von
`BEDINGT STABIL` auf `STABIL` gehoben werden.
