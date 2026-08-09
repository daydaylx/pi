# Pi Session Audit – Aurora Activity UI

Stand: 2026-08-09
Geprüfte Sitzung: `sessions/--home-d-.pi-agent--/2026-08-09T02-24-06-566Z_019fe455-a7a6-71e0-9795-71a899598917.jsonl`
Geprüft von: Claude Code (Sonnet 5), als externer Beobachter der laufenden Pi-Sitzung
Scope: **Arbeitsweise/Tool-Nutzung des Pi-Agents**, kein Code-Review der resultierenden Änderung.

> Hinweis: Die auditierte Pi-Sitzung lief zum Analysezeitpunkt noch (WORKMODUS,
> Implementierung von `extensions/aurora-ui/*`). Typecheck/Tests/`npm run verify`
> sowie die finale Turn-Antwort waren zum Snapshot-Zeitpunkt noch nicht erreicht
> und werden unten explizit als **nicht beobachtbar** markiert statt geraten.

---

## 1. Sitzung rekonstruiert

| Phase | Zeit (UTC) | Was passierte |
|---|---|---|
| Auftrag + Planmodus-Constraint | 02:24:25 | Sehr detaillierter, 29-Punkte-Auftrag zur Aurora-Activity-UI. System erzwingt Planmodus: nur `.agent/plans/current-plan.md` darf geschrieben werden. |
| Recon (Skill) | 02:24:34 | Liest `skills/repo-analyse/SKILL.md` zuerst — sinnvoller Start. |
| Blockierter Bash-Call | 02:24:37 | `pwd && ls -la && git status ...` (verkettet) wird vom Planmodus-Guard abgelehnt ("nicht nachweislich rein diagnostisch"). Agent recovered sofort mit 3 einzelnen Befehlen. |
| Architektur-Recherche | 02:24:40–02:29:50 | 50 `read`- und 29 `bash`-Aufrufe (alle sequenziell, keine Subagenten, keine parallelen Tool-Batches außer 5 kleine Cluster). Liest Aurora-UI-Quellen, Pi-Extension-Docs, `pi-subagents`-Paketquellen, Testsuite. |
| Plansynthese | 02:29:56–02:33:19 | Zwei lange "Thinking"-Bursts mit je 8–10 benannten Zwischenschritten, dann `write` auf `current-plan.md` (11,8 KB). |
| Planbestätigung | 02:33:38 | Kurze, korrekte Abschlussmeldung: "Plan erstellt … Keine Implementierung oder Tests ausgeführt." |
| Freigabe | 02:34:06 | User: "plan ausführen" → Wechsel in WORKMODUS. |
| Implementierung | 02:34:41–02:43:16+ | Liest `pi-subagents`-Skill erneut, schreibt `tool-renderers.ts` komplett neu (+271/−31), editiert `index.ts` in 4 Schritten (1× Edit-Fehler durch nicht-eindeutigen `oldText`, korrekt recovered), aktualisiert `README.md`. Nach den Edits: zwei gezielte `lsp_diagnostics`-Aufrufe auf die geänderten Dateien. |
| Tests/Typecheck/Verify | — | **Nicht beobachtbar** (Snapshot endet vor diesem Schritt). |
| Finale Antwort | — | **Nicht beobachtbar**. |

---

## 2. Tool-Nutzung

| Tool | Aufrufe | Bewertung |
|---|---|---|
| `read` | 50 | überwiegend sinnvoll gezielt (mit offset/limit), aber 2× vollständige Großdateien ohne Filterung |
| `bash` (meist `rg`/`find`/`git`) | 29 | funktional, aber Ersatz für native Tools in mehreren Fällen |
| `edit` | 3 | genutzt; 1 Fehlversuch wegen Mehrdeutigkeit, korrekt recovered |
| `write` | 2 | Plan-Datei + komplette `tool-renderers.ts`-Neufassung |
| `lsp_diagnostics` | 2 | sinnvoll genutzt, proaktiv nach den Edits, ohne Aufforderung |
| `grep` / `find` / `ls` (native Pi-Tools) | **0** | hätte genutzt werden sollen |
| Subagent (`subagent`-Tool) | **0** | hätte genutzt werden sollen |
| Typecheck/Test/Verify | 0 (bis Snapshot) | nicht beobachtbar zu diesem Zeitpunkt |

Auffällig: Der Agent liest an mehreren Stellen selbst die Quellcodes der eigenen
Such-Tools (`grep.ts`, `find.ts`, `ls.ts`, `bash.ts`) und dokumentiert sie sogar
explizit im eigenen Plan ("Die aktuellen Pi-Built-ins heißen `read`, `bash`,
`edit`, `write`, `grep`, `find` und `ls`") — nutzt sie danach aber in der
gesamten Sitzung kein einziges Mal, sondern bleibt durchgehend bei
`bash rg …` / `bash find …` / `bash ls -la`.

---

## 3. Subagenten

Wichtige Korrektur gegenüber der ursprünglichen Prüf-Annahme: Rollen namens
`investigator` / `debugger` / `verifier` **existieren in diesem Setup nicht**.
Das installierte `pi-subagents`-Paket (Version 0.34.0,
`npm/node_modules/pi-subagents/agents/*.md`) definiert stattdessen:
`context-builder`, `oracle`, `planner`, `delegate`, `researcher`, `reviewer`,
`scout`, `worker` (Konfig: `maxSubagentSpawnsPerSession: 5`,
`concurrency: 3`).

**Befund: Kein einziger Subagent-Aufruf in der gesamten Sitzung**, trotz einer
ausgesprochen recherchelastigen Planphase (50 Reads + 29 Bash-Calls, ~5 Minuten
reine Exploration) und vorhandener `scout`/`researcher`/`worker`/`reviewer`-Rollen.

---

## 4. Main-Agent-Verhalten

**Aufgabenverständnis (stark):** Der Auftrag ist ungewöhnlich präskriptiv
(29 nummerierte Abschnitte, exakte Glyphen, exakte Footer-Reihenfolge). Der
Agent hat trotzdem nicht blind abgeschrieben, sondern reale Constraints
verifiziert und dabei zwei echte Probleme selbst entdeckt:

- Einen Zielkonflikt im Auftrag: Punkt 14 verlangt einen `✓ Verify`-Erfolgshaken,
  das strikte "nur transient, keine History"-Prinzip (Punkt 2) widerspricht dem.
  Der Plan löst das explizit auf, statt beides unreflektiert zu übernehmen.
- Einen bestehenden Architekturfehler: Die aktuelle Aurora-Implementierung löst
  bei Subagent-Events einen zusätzlichen RPC-Tool-Call aus — das verletzt die
  eigene Vorgabe "UI darf nichts auslösen" (Auftragspunkt 22) und wird im Plan
  korrekt zur Entfernung vorgesehen.

**Planung (angemessen):** Faktenbasiert, keine erfundenen Optionen, wo nur ein
sinnvoller Weg existiert — folgt der Planmodus-Instruktion korrekt.

**Implementierung (bisher scope-treu):** Von den zu Sitzungsbeginn bereits
vorhandenen, auftragsfremden Änderungen (`AGENTS.md`, root-`README.md`,
`workflow-policy.ts`, Plan-Mode-Dateien, `settings.json`, `diff.mjs`,
`e2e.test.mjs`) wurde keine einzige zusätzlich angefasst.

**Verifikation:** Zwei `lsp_diagnostics`-Selbstchecks nach den Edits sind ein
gutes, unaufgefordertes Signal. Typecheck/Test/`npm run verify` — laut eigenem
Plan vorgesehen — waren zum Snapshot-Zeitpunkt noch nicht gestartet.

---

## 5. Effizienz — konkrete Befunde

**Befund 1 — Ripgrep gegen gitignorte Vendor-Verzeichnisse, ohne `.gitignore` zu prüfen.**
Vier fehlgeschlagene `rg`-Suchen nach `tool_execution_start|tool_execution_end`
in `npm/node_modules/...` liefern "(no output), exit 1" — jeweils leicht andere
Musterformulierung statt der eigentlichen Ursache (rg respektiert
`.gitignore`, und `npm/node_modules` ist offensichtlich ignoriert). Dasselbe
Muster wiederholt sich später bei der Suche nach `SUBAGENT_CONTROL_EVENT`,
bevor `--no-ignore` verwendet wird und sofort funktioniert.
→ Kosten: 6 leere Tool-Calls, ~1 Minute verlorene Zeit, Musterraten statt
Ursachenanalyse.
→ Bessere Vorgehensweise: Beim ersten leeren Ergebnis in einem offensichtlichen
Drittanbieter-Verzeichnis sofort `--no-ignore` probieren.

**Befund 2 — Zwei vollständige, ungezielte Großdatei-Reads.**
`docs/extensions.md` (Pi-eigene Extension-Doku) wird über zwei Reads praktisch
komplett eingelesen (~102.000 Zeichen), ebenso die `pi-subagents`-SKILL.md
(~51.000 Zeichen, teils zweifach). Zusammen mit weiteren Großdateien
summieren sich die reinen `read`-Ergebnisse in dieser Sitzung auf ~528.000
Zeichen (grob 130.000+ Tokens), bevor überhaupt eine Zeile Code geschrieben
wurde.
→ Bessere Vorgehensweise: Erst innerhalb der Datei gezielt grep'en, dann nur
den Treffer-Kontext lesen, oder die Recherche an einen `scout`-Subagenten mit
eigenem, verwerfbarem Kontext delegieren.

**Befund 3 — Edit-Fehlversuch durch nicht-eindeutigen `oldText`.**
Ein `edit`-Aufruf schlägt fehl ("Found 3 occurrences … must be unique"), weil
der gewählte Anker-Text mehrfach im File vorkommt. Recovery erfolgt korrekt,
kostet aber 2 Extra-Calls.

---

## 6. Fehlende Tool-Nutzung

- Native `grep`/`find`/`ls`-Tools existieren, wurden aber nie verwendet.
- `scout`/`researcher`-Subagent verfügbar, aber die komplette 5-minütige
  Architektur-Recherche lief seriell im Hauptagenten.
- `reviewer`-Subagent verfügbar, für eine unabhängige Prüfung der fertigen
  Implementierung gegen den ungewöhnlich detaillierten Auftrag — im Plan selbst
  nicht vorgesehen.
- `lsp_references`/`lsp_definition` wurden in der Recherchephase nicht
  genutzt, obwohl mehrfach Aufrufstellen von Symbolen per Text-Grep über
  mehrere Dateien gesucht wurden.

---

## 7. Qualitätshebel (max. 5, alle aus dieser Sitzung abgeleitet)

1. **Recherchephasen an `scout`/`researcher` delegieren**, sobald absehbar
   mehr als eine Handvoll Dateien gelesen werden müssen — größter Hebel auf
   Kontext-Effizienz.
2. **Native `grep`/`find`/`ls`-Tools statt `bash`-Ersatzbefehlen verwenden.**
3. **Bei leerem `rg`-Ergebnis in Vendor-Verzeichnissen zuerst Ignore-Regeln
   prüfen**, statt Suchmuster zu variieren.
4. **Vor dem Lesen langer Referenzdokumentation erst innerhalb der Datei
   grep'en**, dann gezielt lesen.
5. **Nach Implementierung `reviewer`-Subagent gegen den Original-Auftrag
   prüfen lassen**, bevor `npm run verify` als alleiniger Qualitäts-Gate gilt —
   besonders bei einem derart langen, präskriptiven Auftrag.

---

## 8. Bewertung

| Bereich | Score | Begründung |
|---|---:|---|
| Aufgabenverständnis | 9/10 | Erkennt Zielkonflikt im Auftrag selbst und einen echten Architekturfehler, statt blind umzusetzen. |
| Planung | 8/10 | Faktenbasiert, keine erfundenen Optionen; etwas lange, zweigeteilte Denkphase. |
| Repository-Navigation | 6/10 | Findet am Ende alles Relevante, aber mit vermeidbaren Umwegen. |
| Tool-Auswahl | 5/10 | Native `grep`/`find`/`ls` komplett ungenutzt trotz Kenntnis ihrer Existenz. |
| Tool-Effizienz | 5/10 | Mehrere leere Wiederholungssuchen, ein Edit-Fehlversuch. |
| LSP-Nutzung | 6/10 | Gutes proaktives Self-Check nach Edits; in Recherchephase ungenutzt. |
| Subagent-Nutzung | 3/10 | Null Subagent-Aufrufe trotz recherchelastiger Aufgabe. |
| Implementierungsqualität | 7/10 | Scope sauber eingehalten; Endqualität mangels Tests/Verify noch nicht abschließend beurteilbar. |
| Verifikation | 4/10 | Nur punktuelle LSP-Checks beobachtet; Typecheck/Test/Verify zum Snapshot noch nicht gestartet. |
| Kontext-Effizienz | 4/10 | ~528.000 Zeichen Rohlektüre im Hauptkontext vor der ersten Code-Zeile. |
| Gesamteffizienz | 5/10 | Solide Grundrichtung, aber vermeidbare Umwege und ungenutzte Delegation. |
| Erwartete Ausgabequalität | 7/10 | Plan- und Implementierungsdisziplin lassen ein korrektes Ergebnis erwarten, unter Vorbehalt fehlender Verifikation. |

---

## 9. Abschlussurteil

**A. Was macht der Agent bereits gut?**
Er verifiziert jede Behauptung gegen echten Code statt gegen Annahmen, benennt
einen Zielkonflikt im Auftrag statt ihn zu verstecken, hält Scope-Disziplin und
prüft eigene Edits proaktiv per LSP-Diagnose.

**B. Wo verschwendet er Ressourcen?**
~130k Tokens Rohlektüre für Referenzdokumentation statt gezielter Suche; sechs
leere `rg`-Aufrufe durch dieselbe gitignore-Falle an zwei unabhängigen
Stellen; ein Edit-Fehlversuch durch unzureichenden Anker-Kontext.

**C. Welche Fähigkeiten/Tools nutzt er zu wenig?**
Native `grep`/`find`/`ls`-Tools (0 Aufrufe trotz Kenntnis), `lsp_references`/
`lsp_definition` während der Recherche (0 Aufrufe), sämtliche Subagenten-Rollen
des installierten `pi-subagents`-Pakets (`scout`, `researcher`, `worker`,
`reviewer` — alle 0 Aufrufe).

**D. Nutzt er Subagenten sinnvoll?**
Nicht bewertbar im eigentlichen Sinn, da keine Subagenten-Rolle in dieser
Sitzung überhaupt aufgerufen wurde.

**E. Braucht das Setup zusätzlich einen Worker?**
Nein. Ein `worker`-Agent (ebenso `scout`, `researcher`, `reviewer`) ist im
installierten `pi-subagents`-Paket bereits vorhanden und konfiguriert. Das
beobachtete Problem ist nicht ein fehlendes Setup-Feature, sondern dass der
Hauptagent die vorhandenen Rollen in dieser konkreten, dafür gut geeigneten
Sitzung nicht in Anspruch genommen hat.

**F. Die drei wichtigsten Änderungen**
- **P1** — Recherchephasen an `scout`/`researcher` delegieren, statt Rohcode im
  Hauptkontext zu behalten.
- **P2** — Native `grep`/`find`/`ls`-Tools statt `bash`-Ersatzbefehlen
  verwenden, inklusive sofortiger `--no-ignore`-Prüfung bei leeren Treffern in
  Vendor-Verzeichnissen.
- **P3** — Verifikationsschritt (Tests/Typecheck/`npm run verify`, ggf.
  `reviewer`-Subagent) unmittelbar nach Implementierung einplanen statt als
  möglicherweise nachgelagerten letzten Schritt.
