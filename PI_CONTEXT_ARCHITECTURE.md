# Pi Context Architecture

## Zielbild

| Ebene | Eigentümer | Inhalt | Ladeverhalten |
| --- | --- | --- | --- |
| Globale Dauerregeln | `/home/d/.pi/agent/AGENTS.md` | Sicherheit, Kontextdisziplin, Session- und Delegationsgrundsätze | jede Pi-Sitzung |
| Pi-Projektregeln | `/home/d/.pi/AGENTS.md` | Projektkarte, Architekturgrenzen, Verify und Doku-Routing | nur unter `/home/d/.pi` |
| Workflow | `skills/*/SKILL.md` | wiederverwendbare Verfahren | Metadaten immer, Body nur bei Aufruf |
| Referenz | `docs/` und Root-Auditberichte | ausführliche Architektur und Betriebshinweise | gezielt lesen |
| Dauergedächtnis | `docs/CONTEXT_LEDGER.md` | bestätigte Entscheidungen, Architektur, Nicht-Ziele, Risiken, Regeln, Prioritäten | kompakte Kopfzeile bei Sessionstart, voller Inhalt nur bei Bedarf |
| Arbeitszustand | `docs/PROJECT_STATE.md` | flüchtige Phase, letzte Verifikation, nächste Schritte | nur bei Fortsetzung |
| Gespräch | Pi-Session | aktueller Dialog und Toolschritte | nur aktive Session/Branch |

`SYSTEM.md` und `APPEND_SYSTEM.md` werden nicht benötigt. Dynamische
Projektinformationen werden weder in den Core-Systemprompt noch dauerhaft in
globale Regeln verschoben.

## Context Ledger, Projektstatus und Checkpoints

Zwei getrennte Ebenen, keine Doppelrollen:

- **`docs/CONTEXT_LEDGER.md` (dauerhaft):** bestätigte Nutzerentscheidungen,
  Architekturentscheidungen, Nicht-Ziele, bekannte Einschränkungen, offene
  Risiken/Fragen, wichtige Projektregeln und aktuelle Prioritäten. Fester
  Abschnitts-Vertrag (`extensions/shared/context-ledger.ts`), harte Größengrenze
  (< 200 Zeilen), kein wachsendes Log.
- **`docs/PROJECT_STATE.md` (flüchtig):** aktuelle Phase, umgesetzte Punkte,
  letzte Verifikation, nächste drei Schritte. Referenziert den Ledger, dupliziert
  ihn nicht.

Der Ledger wird **automatisch und deterministisch (ohne Modell-Turn)** von
`extensions/plan-mode` konsolidiert. Trigger:

- Plan → Work (`executePlan`);
- Plan-Abschluss (`turn_end`, alle Todos erledigt);
- nach einem geschriebenen Decision Brief (`handleDecisionTurnEnd`);
- an der Token-Schwelle (≥ 75 % des Fensters) als Proxy vor Pis Compaction —
  einmal je Fensterzyklus, da Pi keinen `before_compaction`-Hook bietet;
- beim Sessionende (`session_shutdown`).

Die Konsolidierung liest nur bereits existierende Artefakte (Decision Brief,
Plan-Nicht-Ziele/Risiken, offene Todos), merged dedupliziert und filtert
sensible Zeilen technisch aus (Whitelist der Abschnitte, kein Freitext-
Passthrough). Bei `session_start` erscheint eine kompakte, tokensparsame
Kopfzeile statt eines Voll-Injects; veraltete Einträge (abweichender Quell-Hash)
werden markiert, nicht automatisch übernommen.

`/skill:context-checkpoint` ist die **manuelle, kuratierende** Ebene (LLM-
gestützt) und wird eingesetzt:

- nach einer abgeschlossenen Analyse;
- vor einer längeren Implementierung;
- nach einem abgeschlossenen Teilabschnitt;
- vor Modellwechsel, manueller Compaction oder neuer Session.

Der Skill aktualisiert `docs/PROJECT_STATE.md` und kuratiert
`docs/CONTEXT_LEDGER.md`, wenn der aktive Permission-Modus Dokumentationsschreiben
erlaubt. Er speichert keine Logs, Chats, Secrets oder ungeprüften
Altentscheidungen und startet keine Compaction.

## Prioritätsordnung der Kontextquellen

Verbindliche Reihenfolge (auch die Recovery-Ladepriorität):

1. Sicherheits-/Schutzregeln (globale `AGENTS.md`) — nie entfernbar.
2. Bestätigte Nutzerentscheidungen + Nicht-Ziele (Ledger) — nie verlieren.
3. Aktive Aufgabe: Plan-Todos + Execution-Zustand (`plan-mode`).
4. Aktuelle Prioritäten + offene Risiken (Ledger).
5. Flüchtiger Arbeitsstand (`PROJECT_STATE.md`).
6. Gesprächsverlauf (Pi Core, zuerst compaction-fähig).
7. Rohlogs/Tool-Ausgaben (zuerst entfernbar).

Bei Platzmangel verdichtet Pi Core von unten (7 → 6). Ebenen 1, 2 und 4 liegen
als Dateien außerhalb des compaction-fähigen Chats und sind dadurch strukturell
geschützt.

## Sessionstrategie

### Neue Session

Eine neue Session verwenden bei Wechsel des Hauptziels oder Projekts, nach
einer abgeschlossenen großen Implementierungsphase, nach vielen verworfenen
Wegen, bei merklich schlechterer Anweisungsbefolgung oder beim Wechsel von
allgemeiner Recherche zu einer unabhängigen Umsetzung.

### Branch-Werkzeuge

- `/fork`: alternative Lösungswege ab einem früheren Punkt, riskante
  Experimente oder unabhängige Varianten derselben Aufgabe.
- `/clone`: separate Kopie des aktuellen aktiven Zweigs vor größeren
  Änderungen.
- `/tree`: Navigation zwischen Alternativen innerhalb derselben Session und
  bewusste Rückkehr zu einem früheren Zustand.

### Compaction

`/compact` nur bei einer langen, weiterhin zusammenhängenden Aufgabe, nach
abgeschlossener Analyse, vor längerer Implementierung oder Modellwechsel und
bei hohem Kontextverbrauch verwenden. Vorher einen Context-Checkpoint
erstellen.

Wiederverwendbarer Befehl:

```text
/compact Bewahre das aktuelle Ziel, die Nicht-Ziele, gültige Einschränkungen,
getroffene Entscheidungen, betroffene Dateien, aktuelle Änderungen, bekannte
Fehler, fehlgeschlagene Tests, erfolgreiche Prüfungen, offene Risiken und die
nächsten drei Aktionen. Entferne Wiederholungen, vollständige Logs, Rohdaten,
abgeschlossene Nebendiskussionen und verworfene Optionen, sofern sie keine
aktuelle Entscheidung erklären. Erfinde keine fehlenden Informationen.
Markiere Unsicherheiten ausdrücklich.
```

Pi Core bleibt alleiniger Compaction-Eigentümer. Für das aktuell registrierte
256.000er Fenster bleiben `reserveTokens: 32768` und
`keepRecentTokens: 12000` aktiv.

## Tool-Ausgabe-Regeln

1. Zuerst gezielt suchen und nur relevante Dateien/Ausschnitte lesen.
2. Logs mit Suchmustern, `head` oder `tail` begrenzen; Kürzung melden.
3. Vor vollständigen Diffs `git diff --stat` ausführen, danach dateibezogen
   lesen.
4. Tests als Zusammenfassung plus relevante Fehlerstellen berichten.
5. Keine vollständigen Verzeichnisbäume oder großen JSON-Daten ohne Filter.
6. Eigene Texttools halten ungefähr 50 KiB und 2.000 Zeilen ein.
7. Anfang und Ende erhalten, wenn Fehler oder Empfehlungen am Ende stehen.
8. `!!command` nur nutzen, wenn die Ausgabe für den Nutzer, nicht für den
   weiteren Modellkontext bestimmt ist.

Pi Built-ins besitzen diese Grenzen bereits. `pi-tool-display` zeigt nur
Vorschauen; die tatsächliche kanonische Begrenzung eigener LSP-Tools und des
Subagenten-Endresultats erfolgt vor Aufnahme in den Modellkontext.

## Subagenten

Standard ist `defaultContext: fresh`, `inheritProjectContext: true` und
`inheritSkills: false`. Damit bleiben Parent-Chat und Skill-Katalog isoliert,
während die kleinen Sicherheits- und Projektregeln gelten.

Fresh-Kontext verwenden für Reviews, Recherche, Tests, Sicherheitsanalyse,
einzelne Module, zweite Meinungen und Komplexitätssuche. Fork-Kontext nur dann
verwenden, wenn frühere Nutzerentscheidungen für die Teilaufgabe wesentlich
sind.

Rückgabeformat:

```markdown
## Ergebnis

## Belege

## Betroffene Dateien

## Fehler oder Risiken

## Offene Fragen

## Empfehlung
```

Nur die kompakte Endantwort gelangt in den Parent-Kontext. Vollständige
Unterhaltungen und Rohlogs bleiben außerhalb des Modellkontexts.

## UI-Eigentum

| Oberfläche | Eigentümer | Regel |
| --- | --- | --- |
| Editor und User-Message-Chrome | `pi-zentui` | Standard-Layout, Catppuccin-Farben |
| Footer | `pi-zentui` | drei Zonen: Projekt/Git, Kontext, Tokens/Kosten |
| Built-in- und Subagenten-Tooldarstellung | `pi-tool-display` | keine zweite Renderer-Extension |
| Working-Message und Indicator | `activity-status` | nur grober Lifecycle, kein Thinking-Inhalt |
| Hidden-Thinking-Label | `thinking-view` | Footer-Status selbst ist ausgeblendet |
| Globaler Header | keiner | `git-header` bleibt deaktiviert; Git steht im Footer |

Externe Full-UI-Pakete werden erst aktiviert, wenn sie gegen die laufende
Pi-Version geprüft sind, Projekt-Trust respektieren, keine Tool-Semantik
ändern und ihre UI-Patches vollständig rückbauen können.

## Extension-Entscheidung

| Bedarf | Bestehende Abdeckung | Zusatznutzen einer neuen Extension | Entscheidung |
| --- | --- | --- | --- |
| Kontextanzeige | Zentui zeigt Text und Gauge im Cockpit-Footer | extern geprüfte Kandidaten änderten auch Tool-/Trust-Verhalten | vorhandenen Eigentümer ausbauen |
| manuelle Kontextanalyse | Auditdokumente und Checkpoint-Skill | gering | Core/Skill nutzen |
| Tool-Kompression | Built-in-Limits plus lokaler Guard | konkrete Lücke geschlossen | keine externe Extension |
| strukturierte Compaction | Core `/compact [prompt]` | derzeit unbelegt | keine zweite Compaction |
| persistentes Gedächtnis | `PROJECT_STATE.md` (flüchtig) + `CONTEXT_LEDGER.md` (dauerhaft, deterministisch konsolidiert) | transparent, Git-fähig, ohne Modell-Turn; kein wachsendes Log | keine Memory-Extension; Datei plus reine Funktionen in `context-ledger.ts` |

Rückbau erfolgt dateibezogen über die verifizierte Sicherung. Der lokale
Output-Guard lässt sich unabhängig deaktivieren, ohne Sessions, Providerdaten
oder Paket-Caches zu verändern.
