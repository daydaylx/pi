# Pi Second-Opinion Service – Abnahmecheckliste

Diese Checkliste ist die kurze Merge- und Freigabeprüfung. Details stehen in Spezifikation und Testplan.

## A. Phase 0 abgeschlossen

- [ ] Repository, Branch und vollständiger Base-SHA dokumentiert
- [ ] bestehender Worktree geprüft und Nutzeränderungen erhalten
- [ ] relevante Provider-, Approval-, Context-, UI- und Telemetriepfade benannt
- [ ] konkrete wiederverwendete Komponenten benannt
- [ ] Architekturvariante begründet
- [ ] Zieloberflächen festgelegt
- [ ] voraussichtliche Änderungsdateien benannt
- [ ] Risiken und offene Entscheidungen dokumentiert
- [ ] ausdrückliches Go für Phase 1 vorhanden

## B. Core-Architektur

- [ ] genau ein gemeinsamer `SecondOpinionService`
- [ ] kein autonomer Subagent
- [ ] kein Agentenloop
- [ ] keine neue allgemeine Agentenplattform
- [ ] Provider-Adapter wiederverwendet
- [ ] Opinion-Modell erhält technisch keine Tools
- [ ] Feature standardmäßig deaktiviert
- [ ] Modellfamilie unterscheidet sich vom Hauptmodell
- [ ] vollständiger Modell-Identifier zentral konfiguriert
- [ ] kein stiller Modell-, Provider- oder Full-Context-Fallback

## C. Request und Kontext

- [ ] konkrete Frage, Begründung, Nutzen und Constraints verpflichtend
- [ ] generische Begründungen werden abgelehnt
- [ ] `request_id` und `decision_id` vorhanden
- [ ] Kontext ausschließlich über begrenzte Referenzen
- [ ] Projekt-Root nach kanonischer Auflösung erzwungen
- [ ] Symlink-Ausbruch blockiert
- [ ] Binärdateien blockiert
- [ ] ungültige und übergroße Bereiche blockiert
- [ ] kein impliziter Session- oder Conversation-Dump
- [ ] keine automatische Hauptagentenpräferenz im Payload
- [ ] Context Manifest stimmt exakt mit dem Payload überein
- [ ] genehmigter Snapshot ist eingefroren
- [ ] Kontextänderung führt zu `stale_context`

## D. Datenschutz und Sicherheit

- [ ] `.env`- und Credential-Dateien blockiert
- [ ] private Schlüssel blockiert
- [ ] Token-/Authorization-Muster behandelt
- [ ] Fehlermeldungen geben keine Secret-Werte aus
- [ ] eingebettete Inhalte als untrusted evidence gekapselt
- [ ] Approval nennt externe Verarbeitung
- [ ] Approval zeigt tatsächliche Modell-/Providerroute
- [ ] Approval zeigt Dateien, Bereiche und Umfang
- [ ] Telemetrie enthält keinen Code, keine Fragen und keine Dateipfade

## E. Budget und Calls

- [ ] Gesamtinput einschließlich Systemprompt wird gezählt
- [ ] hartes Inputlimit aktiv
- [ ] Outputlimit aktiv
- [ ] kein stilles Abschneiden
- [ ] kein Abschneiden mitten in Codebereichen
- [ ] genau ein Call pro genehmigtem Request
- [ ] maximal ein Call pro `decision_id`
- [ ] Deduplizierung gegen doppelte Events vorhanden
- [ ] Timeout aktiv
- [ ] kein automatischer Retry
- [ ] `insufficient_context` beendet den MVP-Call

## F. Approval und Fehler

- [ ] direkter Call ohne gültiges Approval technisch blockiert
- [ ] Ablehnung erzeugt null Calls
- [ ] Abbruch erzeugt keinen nachträglichen Seiteneffekt
- [ ] Providerfehler lässt normalen Workflow offen
- [ ] ungültige Response wird nicht als Opinion dargestellt
- [ ] verspätete Response nach Abbruch wird ignoriert
- [ ] Session-Wiederaufnahme erzeugt keinen doppelten Call
- [ ] Opinion kann Plan, Gate oder Verifier nicht verändern

## G. Darstellung

- [ ] Opinion klar als beratend markiert
- [ ] Modell-Identifier sichtbar
- [ ] Hauptrisiko und Gegenargument sichtbar
- [ ] fehlende Evidenz sichtbar
- [ ] Confidence nicht als gemessene Zuverlässigkeit dargestellt
- [ ] kleine Terminalgröße geprüft
- [ ] Shift+Tab und bestehende Shortcuts unverändert
- [ ] nicht unterstützte Oberflächen bleiben sicher deaktiviert

## H. Technische Tests Phase 1

- [ ] alle anwendbaren R-, A-, C-, S-, B-, P-, O-, V- und T-Tests grün
- [ ] Typecheck grün
- [ ] relevante Unit- und Integrationstests grün
- [ ] Formatierung/Lint grün
- [ ] bestehende relevante Projektprüfungen grün
- [ ] übersprungene Prüfungen und Risiken dokumentiert
- [ ] Provider-Smoke-Test nur nach Freigabe durchgeführt
- [ ] Abschlussbericht Phase 1 geliefert

## I. Nutzennachweis

- [ ] Evaluationsfälle vor dem Lauf festgelegt
- [ ] Vergleichsarme A und B sauber getrennt
- [ ] Repository-Snapshot und Hauptmodell konstant
- [ ] Bewertung soweit möglich blind
- [ ] deterministische Tests vor Judge-Bewertung genutzt
- [ ] Token, Latenz, Fehler und Qualität erfasst
- [ ] Go-/No-Go-Schwellen nicht nachträglich verändert
- [ ] Ergebnis rechtfertigt Phase 2
- [ ] ausdrückliches Go für Phase 2 vorhanden

## J. `ask_user` Phase 2

- [ ] bestehende Dialoginfrastruktur wiederverwendet
- [ ] Opinion-Aktion nur bei ausdrücklich geeigneten Entscheidungen
- [ ] Payload vor Anzeige der Aktion fertig geprüft und eingefroren
- [ ] Details anzeigen löst keinen Call aus
- [ ] Auswahl der Aktion gilt eindeutig als Approval
- [ ] kein zweiter Bestätigungsdialog
- [ ] Opinion-Aktion visuell von Antworten getrennt
- [ ] ursprüngliche Entscheidung bleibt nach Ergebnis offen
- [ ] Opinion wählt keine Option automatisch
- [ ] maximal ein Pending-Call pro `decision_id`
- [ ] Fehler und Abbruch geben die Entscheidung frei
- [ ] Resize, Resume und verspätete Responses getestet
- [ ] alle U-Tests grün
- [ ] unterstützte Oberflächen besitzen dieselbe Semantik
- [ ] Abschlussbericht Phase 2 geliefert

## K. Endgültige Entscheidung

- [ ] zusätzliche Produktions- und Testkomplexität beziffert
- [ ] bekannte Einschränkungen dokumentiert
- [ ] Rollback beziehungsweise Deaktivierung über Feature Flag möglich
- [ ] Verifier unverändert getrennt
- [ ] kein offener P0- oder P1-Befund
- [ ] Gesamturteil: GO | CONDITIONAL GO | NO-GO

## Sofortiges NO-GO

Unabhängig von anderen Ergebnissen gilt NO-GO bei:

- Call ohne gültiges Approval,
- Toolzugriff des Opinion-Modells,
- Übertragung eines bekannten Secrets,
- stiller Provider- oder Modellwechsel,
- doppeltem abrechenbaren Call,
- automatischer Plan-, Gate- oder Optionsänderung,
- nicht reproduzierbarem beziehungsweise nicht überprüfbarem Payload,
- Vermischung mit dem Verifier,
- fehlender Möglichkeit, das Feature vollständig zu deaktivieren.
