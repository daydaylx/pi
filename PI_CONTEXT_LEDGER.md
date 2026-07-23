# Pi Context Ledger — Konzept und Umsetzung

Datum: 2026-07-23
Ziel: Qualitative Verbesserung der Kontextverwaltung — den *richtigen* Kontext
zum *richtigen* Zeitpunkt bereitstellen, nicht mehr Kontext speichern.

Dieser Bericht dokumentiert Analyse, Konzept und die umgesetzte Lösung. Er
orientiert sich an bewährten Mustern moderner Coding-Agenten (Claude Code,
Codex CLI, Gemini CLI) und übernimmt nur Konzepte mit nachweisbarem Mehrwert.
Jede Empfehlung ist nach Qualität, Robustheit, Wartbarkeit und Tokeneffizienz
begründet.

---

## 1. Analyse des aktuellen Systems

### Kontextquellen und Ladezeitpunkt

| Quelle | Datei | Geladen | Inhaltstyp |
| --- | --- | --- | --- |
| Globale Dauerregeln | `AGENTS.md` (global) | jede Session, dauerhaft | dauerhaft |
| Projektregeln | `AGENTS.md` (Projekt) | im Projektpfad, dauerhaft | dauerhaft |
| Arbeitszustand | `docs/PROJECT_STATE.md` | nur bei Fortsetzung, on demand | vor der Änderung **gemischt** |
| Decision Brief | `.agent/plans/decision-brief.md` | bei `/work` als Plan-Kontext | dauerhaft (Entscheidungen) |
| Plan + Todos | `.agent/plans/current-plan.md` | in Plan-/Work-Phase | temporär (Todos) + dauerhaft (Nicht-Ziele) |
| Workflow-Sidecar | `plan-mode/state.ts` + `appendEntry` | `session_start`-Rekonstruktion | technischer Zustand |
| Gespräch | Session-JSONL | aktive Session, Pi-Core-Compaction | flüchtig |

### Kontextfluss

- Pi lädt globale Regeln, durchsucht Elternverzeichnisse, lädt Projektregeln.
- `plan-mode` verwaltet den Plan-/Work-/Decision-Workflow, schreibt Decision
  Brief und Plan-Datei, rekonstruiert seinen Zustand bei `session_start` aus dem
  Sidecar.
- Pi Core besitzt die **Compaction** des Chats (Auto-Compaction bei ~87,2 %,
  `reserveTokens: 32768`, `keepRecentTokens: 12000`).

### Wo Information verloren geht

1. **Compaction.** Pi bietet **keinen `before_compaction`-Hook** (nur `context`,
   `turn_end`, `agent_settled`, `session_shutdown`). Dauerhafte Entscheidungen,
   die nur im Chat leben, überstehen eine Compaction nur als Modellzusammenfassung
   — verlust- und halluzinationsanfällig.
2. **Sessionwechsel.** Eine neue Session lud Sidecar + Plan, aber **kein**
   kuratiertes Dauergedächtnis. `PROJECT_STATE.md` wurde nur „bei Fortsetzung"
   gelesen.
3. **Decision Brief lokal.** Bestätigte Entscheidungen lebten nur für die eine
   Aufgabe und veralteten still, ohne projektweite Persistenz.

### Wo doppelte Information / unnötige Tokenkosten entstehen

- `docs/PROJECT_STATE.md` enthielt zwei `## Umsetzt`- und zwei `## Bekannte
  offene Punkte`-Blöcke (organisch gewachsene Duplikate).
- Nicht-Ziele/Entscheidungen standen parallel in Decision Brief, Plan (Abschnitt
  2 + 4) und PROJECT_STATE — dreifach, ohne Single Source of Truth.

---

## 2. Schwächen

- **S1 (Kern):** Keine Trennung *dauerhaft* vs. *flüchtig* → falscher Kontext
  wird mitgeschleppt, richtiger wird bei Compaction nicht gezielt gerettet.
- **S2:** Checkpoints waren rein manuell (`/skill:context-checkpoint`) → hingen
  an Nutzerdisziplin und griffen genau dann nicht, wenn eine Sitzung lang wurde.
- **S3:** Keine intelligente Wiederherstellung — Recovery war „Sidecar + Plan
  laden", ohne Klassifikation dauerhaft/temporär/veraltet/nie-auto-übernehmen.
- **S4:** Keine explizite, technisch verankerte Prioritätsordnung der Quellen.

---

## 3. Risiken

- **R1 (Datenverlust):** Bestätigte Entscheidung nur im Chat → nach Compaction weg.
- **R2 (Halluzination):** Modell rekonstruiert eine verlorene Entscheidung falsch.
- **R3 (Doppelte Verantwortung):** Ein neues Gedächtnis könnte mit
  PROJECT_STATE, Decision Brief oder Pi-Core-Compaction kollidieren.
- **R4 (Token-Regression):** Ein bei jedem Turn injiziertes Gedächtnis würde das
  Nicht-Ziel „nicht mehr Kontext" verletzen.

---

## 4. Verbesserungsvorschläge (nach Priorität)

1. **Trennung dauerhaft/flüchtig** über eine kleine, kuratierte Datei
   `docs/CONTEXT_LEDGER.md` (dauerhaft-only) neben dem entschlackten
   `docs/PROJECT_STATE.md` (flüchtig). *Qualität + Wartbarkeit: eine Single
   Source of Truth beseitigt die Dreifach-Duplikate. Tokeneffizienz: die Datei
   liegt außerhalb des Chats und wird nicht bei jedem Turn injiziert.* Behebt S1.
2. **Deterministische Auto-Konsolidierung ohne Modell-Turn** an den vorhandenen
   `plan-mode`-Codepfaden. *Robustheit: hängt nicht an Nutzerdisziplin.
   Tokeneffizienz: kostenneutral, weil kein LLM-Aufruf.* Behebt S2 und R1.
3. **Intelligente Recovery** als kompakte Kopfzeile + Klassifikation statt
   Voll-Inject. *Tokeneffizienz + Robustheit.* Behebt S3 und R4.
4. **Explizite Prioritätsordnung** in Doku und Recovery-Code. Behebt S4.
5. **Benchmark** auf dem vorhandenen Harness, der Entscheidungs-Persistenz und
   Halluzination misst. *Wartbarkeit: belegt den Nutzen messbar.*

Verhältnis zu modernen Agenten: Der Ledger übernimmt das bewährte Muster einer
persistenten, git-transparenten Projekt-Memory-Datei (vgl. Claude Code
`CLAUDE.md`, Codex/Gemini `AGENTS.md`), aber bewusst als *ersetzendes Register*
statt als wachsendes Log — die Größengrenze ist ein Feature, kein Nebeneffekt.
Nicht übernommen: eine separate Vektor-/Memory-Extension (kein belegter Mehrwert
für dieses Setup, verletzt „keine unnötige Komplexität").

---

## 5. Empfohlene Architektur

**Kernidee:** Eine einzige, kleine, kuratierte, **dauerhaft-only** Datei
`docs/CONTEXT_LEDGER.md` mit festem Abschnitts-Vertrag und harter Größengrenze
(< 200 Zeilen / 32 KiB). Kein wachsendes Log.

### Verantwortungstrennung (gegen R3 — keine Doppelrollen)

| Komponente | Eigentum |
| --- | --- |
| **Pi Core** | Compaction des Chats (unverändert) |
| **plan-mode** | Workflow-Phasen, Plan-Todos, Decision-Intake — nur um Checkpoint-Emitter ergänzt |
| **Decision Brief / Plan** | *Quellen* bestätigter Entscheidungen, Nicht-Ziele, Risiken |
| **`PROJECT_STATE.md`** | flüchtiger Arbeitszustand (entschlackt) |
| **`CONTEXT_LEDGER.md`** *(neu)* | dauerhaftes Projektgedächtnis |

Regel gegen Duplikate: Dauerhafte Fakten leben **ausschließlich** im Ledger;
PROJECT_STATE und Plan referenzieren sie.

### Ledger-Schema (Whitelist, kein Freitext-Passthrough)

`Bestätigte Nutzerentscheidungen`, `Architekturentscheidungen`, `Nicht-Ziele`,
`Bekannte Einschränkungen`, `Offene Risiken`, `Offene Fragen`, `Wichtige
Projektregeln`, `Aktuelle Prioritäten`, `Verworfene Optionen` + JSON-Metafooter
(`CONTEXT-LEDGER-META`: `schemaVersion`, `lastCheckpoint`, `lastTrigger`,
`briefHash`, `planHash`). Der Writer akzeptiert nur diese Abschnitte und filtert
sensible Zeilen (Secrets, Env-Zuweisungen, Key-Präfixe, Bearer-Token, private
Keys) technisch aus — „nie automatisch übernehmen" ist damit erzwungen.

### Automatische Checkpoints (deterministisch, ohne LLM-Turn)

`consolidateLedger()` liest die bereits existierenden strukturierten Artefakte
(Decision Brief, Plan-Nicht-Ziele/Risiken, offene Todos) und merged sie
**idempotent** (append-dedupe für dauerhafte Abschnitte, replace für „Aktuelle
Prioritäten") in den Ledger. Trigger:

| Auslöser | Codepunkt (`plan-mode/index.ts`) | Trigger-Name |
| --- | --- | --- |
| Plan → Work | `executePlanInternal` (nach Commit von `executing`) | `plan-to-work` |
| Plan-Abschluss | `turn_end` (alle Todos erledigt → `ready`) | `plan-complete` |
| Bestätigte Entscheidung | `handleDecisionTurnEnd` (Brief geschrieben) | `decision-brief` |
| Vor Compaction (Proxy) | dedizierter `turn_end` + `ctx.getContextUsage()` ≥ 75 % | `token-threshold` |
| Sessionende | `session_shutdown` | `session-shutdown` |

Der Token-Proxy ist die einzige Näherung (mangels `before_compaction`-Hook):
Schwelle deutlich unter Pis 87,2 %; einmal je Fensterzyklus (das Flag wird
wieder scharf gestellt, sobald `getContextUsage().tokens` klein oder `null` ist
— typisch direkt nach einer Compaction).

### Intelligente Wiederherstellung (`session_start`)

Kein Voll-Inject. Der Ledger bleibt eine Datei; nur eine kompakte, tokensparsame
Kopfzeile (n Entscheidungen, m Nicht-Ziele, offene Risiken/Fragen, aktuelle
Priorität) wird angezeigt. Klassifikation:

- **Dauerhaft:** Entscheidungen, Nicht-Ziele, Regeln — als Datei, auf Abruf.
- **Temporär:** progressRecords/Phase — weiter aus Sidecar/Plan.
- **Veraltet:** abweichender Quell-Hash (`briefHash`/`planHash`) → in der
  Kopfzeile markiert, nicht automatisch übernommen.
- **Nie automatisch:** Secrets/Env/Rohlogs — durch Schema + Writer-Filter
  technisch ausgeschlossen.

### Prioritätsordnung der Kontextquellen

1. Sicherheits-/Schutzregeln (globale `AGENTS.md`) — nie entfernbar.
2. Bestätigte Nutzerentscheidungen + Nicht-Ziele (Ledger) — nie verlieren.
3. Aktive Aufgabe: Plan-Todos + Execution-Zustand.
4. Aktuelle Prioritäten + offene Risiken (Ledger).
5. Flüchtiger Arbeitsstand (`PROJECT_STATE.md`).
6. Gesprächsverlauf (Pi Core, zuerst compaction-fähig).
7. Rohlogs/Tool-Ausgaben (zuerst entfernbar).

Pi Core verdichtet von unten (7 → 6). Ebenen 1, 2, 4 liegen als Dateien
außerhalb des Chats und sind strukturell geschützt.

---

## 6. Benötigte Dateien

**Neu**
- `docs/CONTEXT_LEDGER.md` — die dauerhafte Ledger-Datei (initial aus
  PROJECT_STATE destilliert).
- `extensions/shared/context-ledger.ts` — Schema, `consolidateLedger()`,
  reine Merge-/Klassifikations-/Sanitize-Funktionen, atomarer symlink-sicherer
  Writer, Token-Proxy-Helfer. Einziges neues Verhalten; vollständig testbar.
- `schemas/context-ledger.schema.json` — Vertrag des Metadaten-Footers.
- `benchmarks/tasks/11-context-ledger-survival/TASK.md` — neue Benchmark-Aufgabe.

**Geändert (minimal, an definierten Codepunkten)**
- `extensions/plan-mode/index.ts` — fünf Checkpoint-Emitter + Recovery-Kopfzeile.
- `skills/context-checkpoint/SKILL.md` — Trennung manuell (kuratierend) vs.
  automatisch (deterministisch).
- `docs/PROJECT_STATE.md` — auf flüchtigen Zustand entschlackt, Duplikate raus.
- `AGENTS.md`, `PI_CONTEXT_ARCHITECTURE.md` — Ledger-Eigentum, Prioritätsordnung.
- `benchmarks/SCORING.md`, `benchmarks/harness/collect-metrics.mjs`,
  `benchmarks/harness/schema/run-result.schema.json` — Messgrößen 13–15.
- `tests/run.mjs` — Unit- und Integrationstests.

---

## 7. Datenflussdiagramm

```
                    ┌───────────────────────────────┐
 Nutzer ──/decide──▶│ plan-mode: Decision-Intake     │
                    │  → decision-brief.md           │──┐
                    └───────────────────────────────┘  │  (deterministisch,
 Nutzer ──/plan────▶│ current-plan.md (Nicht-Ziele,   │  │   kein LLM-Turn)
                    │  Risiken, Todos)               │──┤
                    └───────────────────────────────┘  ▼
 Nutzer ──/work────▶ executePlan ─┐            ┌──────────────────────────┐
 turn_end (ready) ──────────────  ├──trigger──▶│ consolidateLedger()      │
 getContextUsage ≥ 75% ─────────  │            │ (shared/context-ledger)  │
 session_shutdown ──────────────  ┘            │  merge → atomarer Write  │
                                                └───────────┬──────────────┘
                                                            ▼
                                              docs/CONTEXT_LEDGER.md  (dauerhaft)
                                                            │
        session_start ──────────────────────────────────────┤ Klassifikation
                                                            ▼ (dauerhaft/temporär/
                          kompakte Kopfzeile + Abruf ◀──────  veraltet/nie-auto)
                                                            │
 Pi Core Compaction  ◀── Chat (Prio 6, zuerst verdichtet) ──┘ Ledger liegt
                                                              außerhalb des Chats
```

---

## 8. Integrationsaufwand

Gering–mittel. Kein neuer Extension-Prozess, keine neuen Hooks — alle Trigger
existieren bereits. Kern ist ein reines Funktionsmodul (`context-ledger.ts`) plus
fünf schmale, fail-open Emitter-Aufrufe und eine Recovery-Kopfzeile. Kein
Modell-/Provider-Eingriff, keine Änderung an Compaction-Werten. Das Risiko
konzentriert sich auf das isoliert getestete Modul und die konservative
Token-Heuristik.

---

## 9. Migrationsplan

1. `context-ledger.ts` + Schema + Unit-Tests (erledigt, grün).
2. Initiales `docs/CONTEXT_LEDGER.md` aus PROJECT_STATE destillieren;
   PROJECT_STATE entschlacken (erledigt).
3. Fünf Emitter + Token-Proxy in `plan-mode` andocken (erledigt).
4. Recovery-Klassifikation in `session_start` (erledigt).
5. Skill + `AGENTS.md` + `PI_CONTEXT_ARCHITECTURE.md` (erledigt).
6. Benchmark-Aufgabe 11 + Messgrößen 13–15 (erledigt).
7. `npm run verify` grün gegen die bekannte Baseline (siehe Abschnitt 12).

Rückbau: `context-ledger.ts`, den Ledger und die fünf Emitter-Zeilen entfernen;
alle Emitter sind fail-open und ändern das bestehende Workflow-Verhalten nicht.

---

## 10. Benchmark-Konzept

Aufsetzend auf dem vorhandenen Harness (`SCORING.md`, `collect-metrics.mjs`;
Aufgabe 08 misst bereits „verlorene Anforderungen nach Compaction", Messgröße 11).

**Aufgabe 11 — Context-Ledger-Survival:** eine lange Sitzung, in der der Nutzer
(a) eine Entscheidung bestätigt, (b) ein Nicht-Ziel setzt, (c) ein
Architektur-Detail festlegt und dann eine lange Umsetzung erzwingt, die
Compaction auslöst; am Ende wird nach genau diesen Fakten + offenen Todos gefragt.

**Neue Messgrößen (13–15):**
- **13 — Entscheidungs-Persistenz nach Compaction.** Automatischer Anteil:
  Abgleich erwarteter Fakten gegen `docs/CONTEXT_LEDGER.md`
  (`--ledger-expects`, Feld `automatic.ledgerSurvival`). Inhaltliche
  Widerspruchsfreiheit im finalen Turn: manuell.
- **14 — Projektstatus-Korrektheit.** Manuell: berichtete offene/erledigte Todos
  gegen Plan/Progress.
- **15 — Halluzinationsrate.** Teilautomatisch/manuell: unbelegte Behauptungen
  im Abschluss-Turn zählen.

**A/B-Vergleich** (ohne automatisches Ranking — bewusstes Nicht-Ziel des
Harness): Aufgabe 08 + 11 einmal mit, einmal ohne Ledger-Automatik. Erwartung:
Messgröße 11/13 (verlorene Entscheidungen) sinkt, 15 (Halluzination) sinkt, bei
**neutralem** Tokenverbrauch (Messgröße 7), weil die Automatik keinen LLM-Turn
kostet.

---

## 11. Klare Empfehlung

**Umsetzen (umgesetzt):**
- Getrennte, kleine `docs/CONTEXT_LEDGER.md` + Entschlackung von PROJECT_STATE.
- Deterministische Auto-Konsolidierung an den fünf vorhandenen Codepunkten,
  ohne LLM-Turn.
- Intelligente Recovery via Klassifikation + Kopfzeile statt Voll-Inject.
- Benchmark-Aufgabe 11 + Messgrößen 13–15.

**Bewusst NICHT umsetzen** (respektiert die Nicht-Ziele und die Audit-Historie):
- Keine eigenständige Memory-Extension, kein neuer Extension-Prozess.
- Keine zweite Compaction, kein Eingriff in Pi-Core-Compaction oder
  `reserveTokens`/`keepRecentTokens`.
- Kein `before_compaction`-Monkeypatch — nur der konservative Token-Proxy.
- Keine Vergrößerung des Kontextfensters, keine dauerhafte Ledger-Injektion in
  jeden Turn.
- Keine LLM-gestützte Auto-Kuratierung im Hintergrund (bleibt manueller Skill).

---

## 12. Verifikationsergebnis

- `npm run typecheck`: erfolgreich (`strict: true`).
- `npm test`: neue Unit-Tests (Konsolidierung, Idempotenz, Secret-Filter,
  Klassifikation, Token-Proxy, Zeilengrenze, Dateisystem-Roundtrip) und ein
  Integrationstest (session_shutdown schreibt den Ledger ohne Modell-Turn;
  session_start meldet nur die kompakte Kopfzeile) bestehen. Die Gesamtsuite ist
  grün bis auf **zwei bekannte, umgebungsbedingte Baseline-Fehler** (Pfad- und
  CLI-Versionsdrift außerhalb von `~/.pi/agent`), die es bereits vor dieser
  Änderung gab.
- `collect-metrics.mjs --ledger-expects`: liefert korrekt `present`/`missing`
  gegen den Ledger.
- Der ausgelieferte `docs/CONTEXT_LEDGER.md` parst sauber durch das Modul
  (5 Entscheidungen, 4 Nicht-Ziele, 2 Risiken, 1 offene Frage) und bleibt unter
  der Zeilengrenze.
