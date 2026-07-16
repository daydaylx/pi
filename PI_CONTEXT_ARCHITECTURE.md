# Pi Context Architecture

## Zielbild

| Ebene | Eigentümer | Inhalt | Ladeverhalten |
| --- | --- | --- | --- |
| Globale Dauerregeln | `/home/d/.pi/agent/AGENTS.md` | Sicherheit, Kontextdisziplin, Session- und Delegationsgrundsätze | jede Pi-Sitzung |
| Pi-Projektregeln | `/home/d/.pi/AGENTS.md` | Projektkarte, Architekturgrenzen, Verify und Doku-Routing | nur unter `/home/d/.pi` |
| Workflow | `skills/*/SKILL.md` | wiederverwendbare Verfahren | Metadaten immer, Body nur bei Aufruf |
| Referenz | `docs/` und Root-Auditberichte | ausführliche Architektur und Betriebshinweise | gezielt lesen |
| Arbeitszustand | `docs/PROJECT_STATE.md` | aktuelles Ziel, Entscheidungen, Fehler, nächste Schritte | nur bei Fortsetzung |
| Gespräch | Pi-Session | aktueller Dialog und Toolschritte | nur aktive Session/Branch |

`SYSTEM.md` und `APPEND_SYSTEM.md` werden nicht benötigt. Dynamische
Projektinformationen werden weder in den Core-Systemprompt noch dauerhaft in
globale Regeln verschoben.

## Projektstatus und Checkpoints

`/skill:context-checkpoint` wird eingesetzt:

- nach einer abgeschlossenen Analyse;
- vor einer längeren Implementierung;
- nach einem abgeschlossenen Teilabschnitt;
- vor Modellwechsel, manueller Compaction oder neuer Session.

Der Skill aktualisiert ausschließlich `docs/PROJECT_STATE.md`, wenn der aktive
Permission-Modus Dokumentationsschreiben erlaubt. Er speichert keine Logs,
Chats, Secrets oder ungeprüften Altentscheidungen und startet keine Compaction.

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
| persistentes Gedächtnis | `PROJECT_STATE.md` | ausreichend, transparent, Git-fähig | keine Memory-Extension |

Rückbau erfolgt dateibezogen über die verifizierte Sicherung. Der lokale
Output-Guard lässt sich unabhängig deaktivieren, ohne Sessions, Providerdaten
oder Paket-Caches zu verändern.
