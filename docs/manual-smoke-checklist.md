# Manuelle Restprüfung

Alles Codebasierte ist automatisiert und grün. Was hier steht, lässt sich **nur**
in einer echten interaktiven Pi-Sitzung mit Provider-Zugang beobachten und ist
der einzige offene Punkt aus `#137`.

Pro Schritt eintragen: **beobachtet** und **bestanden / fehlgeschlagen**. Weicht
etwas ab, den Schritt notieren und `#137` offen lassen.

## Vorbereitung

```bash
cd /home/d/.pi/agent
git status --short            # erwartet: keine Ausgabe
git log --oneline -1          # aktuellen geprüften Commit dokumentieren
npm --prefix npm run verify   # erwartet: Exit 0
```

## Frische Installation

| #   | Schritt                                          | Erwartet                                                             | Beobachtet | ✓/✗ |
| --- | ------------------------------------------------ | -------------------------------------------------------------------- | ---------- | --- |
| 1   | `npm run install:user -- --apply --target <tmp>` | Installation läuft durch, `docs/archive/session-logs/` fehlt im Ziel |            |     |
| 2   | `npm ci --prefix <tmp>/npm`                      | `@earendil-works/pi-coding-agent@0.84.2` installiert                 |            |     |
| 3   | Pi im Zielverzeichnis starten                    | Neue Session, Extensions laden, keine unerwarteten Startfehler       |            |     |
| 4   | Fork-Pin prüfen                                  | Checkout auf `54c701242710b1dab39a47f23ef8020f40b82bd4`              |            |     |

## Aurora und Workflow

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
| 13  | Tool-Ausführung beobachten       | Toolzeile erscheint und verschwindet mit dem Tool                                                                                      |            |     |

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
| 16  | Footer danach                          | `verified` bei grünem Lauf und unveränderter Datei­lage                                                    |            |     |
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

Sind alle Zeilen bestanden, kann `#137` geschlossen und das Endurteil von
`BEDINGT STABIL` auf `STABIL` gehoben werden.
