# Pi Recovery-, Permissions- und Workflow-Audit

**Phase:** nur Analyse. Der Auftrag enthielt keine Implementierung; dieses
Dokument ist der einzige Repo-Eintrag dieses Audits (auf ausdrücklichen
Nutzerwunsch nachträglich committet). Der Code wurde nicht verändert.

## 0. Untersuchungsstand

| Punkt               | Wert                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository / Branch | `daydaylx/pi`, `ccr-936d6397-g0nta9` (zum Zeitpunkt der Untersuchung identisch mit `origin/main`)                                                                                                       |
| Commit              | `bf5b9f3733eff3d118625392dff37d9b3ef7fa3b` (2026-10-10 17:39 +02:00)                                                                                                                                    |
| Untersuchung        | 2026-10-11, ab ca. 15:25 UTC                                                                                                                                                                            |
| Umgebung            | Cloud-Container: Node 22.22.0 (gepinnt ist 22.23.2), npm 10.9.4, Git 2.43.0                                                                                                                             |
| Abhängigkeiten      | Außerhalb des Repos installiert (`--ignore-scripts`), temporär nach `npm/node_modules` gelinkt, danach wieder entfernt. `pi-subagents` ließ sich nicht installieren (GitHub-Tarball per 403 abgelehnt). |
| Ausgeführt          | Vorhandene Tests und eigene Repro-Skripte gegen die echten Extensions (siehe Anhang). Die Skripte sind nicht Teil des Repos.                                                                            |

**Einschränkungen**

- Keine Daten vom lokalen Rechner des Nutzers: keine Sessions, keine Logs,
  kein NixOS/Hyprland, keine Runtime-Patches (`docs/RUNTIME_PATCHES.md`).
- Gelaufen ist `@earendil-works/pi-coding-agent@1.0.4` (gepinnter Upstream-Stand).
- Alle Zeiten sind Sandbox-Messungen, keine Aussage über andere Hardware.

**Evidenzgrade:** _bestätigt_ = Code gelesen und ausgeführt oder getestet;
_plausibel_ = Codepfad vorhanden, nicht reproduziert; _offen_ = Laufzeitdaten fehlen.

---

## Bericht 1 – Aktuelle Architektur

### Entscheidungsweg

```
Provider-/Stream-Fehler, Abort, Compaction-Fehler        (resilience/index.ts:487-497, 585-589)
  → currentAttemptFailed = true                          (Pi-Retry setzt es bei agent_start zurück, :480-485)
agent_settled:                                           (:591-644)
  failed ⇒ recovery-required {reason: final_failure,
           toolMayHaveMutated, workspaceChanged}
  gate = gateRequiresInspection(required) ? Gate : none  (recovery-state.ts:161-169)
tool_call → guards.ts:285-314:
  recoveryEffect(event) == "potentially_mutating"
    && level != yolo-full → requestRecoveryStatus()
  recoverySnapshot():                                    (resilience/index.ts:270-306)
    nicht geprüft → armed
    geprüft → neuer Snapshot-Fingerprint ≠ Prüf-Fingerprint → armed ("workspace-changed")
  armed → Block „Recovery-Gate aktiv …“
recovery_check (:661-757): Snapshot + git status → recovery-checked-Marker → Gate offen,
                           solange der Fingerprint unverändert bleibt
```

### Antworten auf die zehn Fragen aus Untersuchung A

| #   | Frage                                                | Antwort                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Was löst Recovery aus?                               | Ein Turn, der mit `currentAttemptFailed` endet (HTTP ≥ 400, `message_update`-Fehler, Compaction-Fehler, `agent_end` mit `stopReason` `error`/`aborted`, nicht durch Retry ausgeglichen). Zweiter Auslöser: Resume mit offenem `turn-start` ohne `turn-settled` (`interrupted`). **Toolfehler allein lösen nichts aus** (kein `tool_result`-Handler). |
| 2   | Was aktiviert die Schreibsperre?                     | `gateRequiresInspection`: `interrupted` immer; `final_failure` nur bei `toolMayHaveMutated` oder `workspaceChangedSinceTurnStart`. `workspaceChanged` ist automatisch wahr, wenn der Start-Fingerprint `"unavailable"` war (`index.ts:65-73`).                                                                                                       |
| 3   | Was gibt frei?                                       | Nur `recovery_check`, solange der Fingerprint danach unverändert bleibt; außerdem `yolo-full`, eine neue Session ohne Gate.                                                                                                                                                                                                                          |
| 4   | Wann muss `recovery_check` laufen?                   | Vor jedem „potentially_mutating“-Tool, solange das Gate scharf ist – und nach jeder Workspace-Änderung erneut (F-01).                                                                                                                                                                                                                                |
| 5   | Welche Toolfehler können es verursachen?             | Keine direkt. Indirekt: Ein nur gestartetes oder geblocktes Tool setzt `toolMayHaveMutated` (F-03); danach genügt ein Provider-Fehler oder Abort.                                                                                                                                                                                                    |
| 6   | Wird Lesen/Schreiben zuverlässig getrennt?           | **Nein** (F-03, F-06): Allow-Set aus 10 Toolnamen, alles andere „mutierend“; Bash über `classifyOperationEffect === SAFE`, dort sind unbekannte Programme SAFE.                                                                                                                                                                                      |
| 7   | Kann ein harmloser Fehler unverhältnismäßig sperren? | Ja: `web_search` + HTTP 503; Esc nach erledigtem Edit; vom Guard geblockter Write + Abort (alle bestätigt).                                                                                                                                                                                                                                          |
| 8   | Fehlender/fehlerhafter Fingerprint?                  | Snapshot gilt als „geändert“; `recovery_check` wirft denselben Fehler; Sperre bleibt (F-02).                                                                                                                                                                                                                                                         |
| 9   | Überlebt der Zustand einen Neustart?                 | Ja (nur aus Session-Einträgen abgeleitet; getestet, REC-002). Ein abgebrochener Turn wird beim Resume **bedingungslos** zum Gate (F-05).                                                                                                                                                                                                             |
| 10  | Wiederholte Prüfungen ohne Fortschritt?              | Ja: Snapshot nicht erfassbar (F-02), Fingerprint-Churn (X3), `git status` im Nicht-Git-Elternverzeichnis (F-09). Keine Fortschrittserkennung.                                                                                                                                                                                                        |

### Was nachweislich gut funktioniert

- Das Gate ist fail-closed und persistent; Restart und REC-002 sind getestet.
  Alle Resilience-Sections liefen grün (72 + 21 + 5 + 30 Assertions).
- Schreiben außerhalb des Projekts ist hart geblockt, Lesen außerhalb erlaubt (W5a/b).
- Permission-Ablehnungen lösen Recovery nicht direkt aus.
- Die LSP-Registry ist bereits pro `(workspaceRoot, serverId)` geführt.

---

## Bericht 2 – Bestätigte Probleme

Kürzel (R1, W6, X3 …) bezeichnen die ausgeführten Repro-Läufe (Anhang).

### F-01 · P1 · bestätigt – Freigabe ist faktisch eine Einmalfreigabe

- **Dateien:** `resilience/index.ts:270-306` (`recoverySnapshot`), `recovery-state.ts:107-115`.
- **Problem:** Das Gate wird nur durch einen neuen Fehlturn ersetzt, nie geschlossen. Nach `recovery_check` vergleicht jeder Guard-Aufruf den Fingerprint mit dem Prüfzeitpunkt; die eigene, erlaubte Änderung des Agenten verändert ihn.
- **Lauf R4:** Fehlturn → `recovery_check` ⇒ Write #1 erlaubt. Write #1 ausgeführt ⇒ Write #2 und `npm test` blockiert („Workspace hat sich … verändert“). Erneuter Check ⇒ Write #2 erlaubt. Selbst nach einem erfolgreichen Folge-Turn blockiert die nächste Änderung wieder (R4h).
- **Auswirkung:** Nach dem ersten Gate-Ereignis braucht jede Änderung einen Extra-Check, auch nach Restart. Durchsatzproblem, kein Deadlock.
- **Doku-Widerspruch:** `docs/agent-workflow.md:23` sagt „einmal“.
- **Tests:** nicht abgedeckt. `tests/suites/runtime/resilience.mjs:585-624` führt keinen echten Write aus und simuliert die Änderung nur über einen anderen `cwd`.
- **Einschränkung:** Der Write wurde im Repro per Dateizugriff simuliert; die Fingerprint-Logik ist identisch.

### F-02 · P1 · bestätigt – Nicht erfassbarer Snapshot ergibt ein nicht auflösbares Gate

- **Dateien:** `shared/workspace-snapshot.mjs:248-258`, `554-560` (untracked Verzeichnis → `read_failed`), `:637` (Limit 100.000 Einträge); `resilience/index.ts:65-73`, `674-687`; `permissions/verifier-policy.ts:536-557`.
- **Auslöser (jeweils ausgeführt):** untracked verschachteltes Repo (R5); Git-Worktree im Repo (W1); Nicht-Git-Verzeichnis > 100k Einträge (W6); Hintergrundprozess schreibt in nicht ignorierte Datei: 5/5 Snapshots `unstable_workspace` (X3); defektes `.git` (W7).
- **Verlauf:** Start-Fingerprint `"unavailable"` ⇒ `workspaceChanged = true`. **Schon ein reiner Lese-Turn mit HTTP 503 armiert das Gate** (R5, W6b). `recovery_check` wirft denselben Fehler; der „Ausweg: manuell prüfen“ hilft nicht, weil der Agent ohne Schreibrecht nichts beheben kann. Zusätzlich blockt das Commit-Gate jeden `git commit`.
- **Auswege:** `yolo-full` (R5e); `!`-Befehle des Nutzers (`user_bash` prüft Recovery nicht; per Code gelesen); Ursache beheben. Neue Session nur, solange kein weiterer Fehlturn folgt (nicht getestet).
- **Tests:** Limit, verschachtelte untracked Repos und Worktrees sind nicht getestet (nur tracked Gitlink: `tests/suites/runtime/workspace-snapshot.mjs:624-649`).
- **Relevanz:** Repos/Worktrees _innerhalb_ eines Repos sind genau das Mehrprojekt-Szenario.

### F-03 · P2 · bestätigt – Falsche Mutationsannahme

- **Dateien:** `resilience/index.ts:500-505`, `shared/recovery-capabilities.ts:23-50`.
- **(a) Geblockte Aufrufe zählen als Mutation.** Die Runtime emittiert `tool_execution_start` _vor_ `beforeToolCall` (`pi-agent-core/dist/agent-loop.js:379` bzw. `:493`). Ausführungslauf mit dem echten `Agent`: `tool_execution_start(write)` → `beforeToolCall → BLOCK` → `tool_execution_end`, `execute()` nie aufgerufen. R3: Readonly-Ablehnung eines Writes + Abort ⇒ `toolMayHaveMutated = true`. Permission-Ablehnungen können Recovery also indirekt auslösen.
- **(b) Nur 10 Toolnamen gelten als lesend.** `web_search`, `fetch_content`, `get_search_content`, `subagent`, `project_check`, `verify`, `plan_write` zählen als mutierend (R1, R7, R10). `plan_write` schreibt laut `permissions/tool-policy.ts:119-132` nur in die Runtime-Ablage. Ein 503 nach einer Websuche sperrt alle Writes; bei scharfem Gate ist auch `subagent` (z. B. Read-only-Investigator) gesperrt.
- **Tests:** nicht abgedeckt.

### F-04 · P2 · bestätigt (Handler) / plausibel (reale Esc-Wirkung) – Abort zählt als Fehlturn

- `index.ts:495-497` ignoriert `reason: "aborted"`. R2: Esc nach erfolgreichem Edit ⇒ `outcome=failed`, Gate scharf.
- Offen: Ob die reale TUI bei Esc dieses Event liefert (folgt aus `pi-ai/dist/api/anthropic-messages.js:684-686`, nicht live geprüft).

### F-05 · P2 · bestätigt – „Interrupted“ sperrt bedingungslos

- `recovery-state.ts:165`. X7: Abbruch in einem reinen Lese-Turn, Workspace identisch zum persistierten Start-Fingerprint ⇒ trotzdem `interrupted`, Write blockiert. Der Vergleich wäre mit vorhandenen Daten möglich, wird nicht genutzt.

### F-06 · P2 · bestätigt – Zwei Klassifikatoren, beide in Randbereichen falsch

Ausgeführte Klassifikation bei scharfem Gate (R7):

| Befehl                                                                                                                  | Recovery-Wirkung                                           |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `npm test`, `node --check`, `python3 -c`, `make`, `echo $(date)`, `git fetch`, `git stash list`                         | **geblockt** (zu streng, teils rein lesend)                |
| `./deploy.sh`, `rsync -a --delete`, `terraform apply`, `docker compose up`, `kubectl delete`, `psql`/`sqlite3 … delete` | **erlaubt** (zu lax: unbekannte Programme gelten als SAFE) |

- Doku veraltet: `docs/CONTEXT_LEDGER.md:63-71` behauptet, Recovery erbe die Allowlist (`isPlanModeDiagnosticCommand`). Tatsächlich nutzt `recovery-capabilities.ts:47` `classifyOperationEffect === "SAFE"`, die bewusst keine Allowlist ist (`permission-policy.ts:1564`).
- Mindestens vier getrennte Read-only-Tool-Listen: `guards.ts:43`, `recovery-capabilities.ts:23`, `workflow-policy.ts:67/75`, Zweige in `tool-policy.ts`.

### F-07 · P2 · bestätigt (Code, Lauf) / offen (Wirkung im realen Frontend) – Nicht-TUI-Modi

- x6: In `rpc` und `print` setzt ein Recovery-Block `terminate: true` (`guards.ts:74-76`); sind alle Aufrufe des Batches geblockt, endet der Lauf (`agent-loop.js:465-467`). Der Agent kann `recovery_check` im selben Lauf nicht mehr aufrufen. Die Recovery-Anweisung (`index.ts:247`) nennt `recovery_check` nicht, nur der Block-Text.
- `guards.ts:361-367` blockt jedes „ask“ mit `terminate`, sobald `ctx.mode !== "tui"`. Pi-RPC bietet aber `ui.confirm` (`rpc-mode.js:85`), und `frontend-server/index.mjs:507, 1157` leitet `extension_ui_request/response` durch. Vermutung (nicht mit echtem Frontend getestet): Externe Frontends über `pi --mode rpc` (`frontend-server/index.mjs:594`) verlieren Bestätigungsdialoge und `ask_user`, obwohl der Transport sie kann.

### F-08 · P2 · bestätigt – Snapshot-Kosten und Event-Loop-Blockade

- Snapshots laufen bei jedem `before_agent_start` und `agent_settled`, bei drei Compaction-Events und bei jedem gebundenen Guard-Aufruf nach einem Check. `hashFileSync` ist synchron (`workspace-snapshot.mjs:508-524`).
- Messung (Sandbox, Git 2.43, sauberer Tree):

| Untracked Datei | Snapshot                      | max. Event-Loop-Verzögerung |
| --------------- | ----------------------------- | --------------------------- |
| keine           | 51 ms (dieses Repo: 55–63 ms) | 25 ms                       |
| 256 MiB         | 292 ms                        | 254 ms                      |
| 1 GiB           | 892 ms                        | 859 ms                      |

- Auf anderer Hardware nicht gemessen; Verbesserungsaussagen wären erst nach Messung belegbar.

### F-09 · P2 · bestätigt – Nicht-Git-Elternverzeichnis mit mehreren Repos

- `collectFilesystemSnapshot` überspringt `.git` nur auf oberster Ebene (`workspace-snapshot.mjs:620`).
- Jedes „lesende“ `git status` in einem Kind-Repo schreibt `.git/index` und ändert den Fingerprint (`x1c`; mit `GIT_OPTIONAL_LOCKS=0` stabil). Die Recovery-Anweisung empfiehlt aber `git status --short` ⇒ Schleife check → `git status` → blockiert → check.
- Ein `git commit` in Repo A re-armiert auch Repo B (W4g). Die Einträge zählen zusätzlich gegen das 100k-Limit.

### F-10 · P2 · bestätigt – Workspace-Grenzen sind nicht deckungsgleich

| Ebene                                  | Wurzel                                              |
| -------------------------------------- | --------------------------------------------------- |
| Permissions (`resolvePathScope`)       | `cwd`                                               |
| Recovery-/Verifier-Snapshot            | Git-Toplevel (`rev-parse --show-toplevel`)          |
| `.pi/verify.json`, Setup-Config, Trust | `ctx.cwd` (`guards.ts:186`, `session-state.ts:280`) |
| LSP                                    | pro Datei (Marker-Suche aufwärts)                   |

- W3: `cwd=pkg-a`; eine Änderung in `pkg-b` (außerhalb `cwd`, aber im selben Repo) re-armiert das Gate für `pkg-a`.

### F-11 · P2 · plausibel (Code, nicht ausgeführt) – Einzelslot-Ledger

- `setup-core/index.ts:302-317`: ein `lastVerifierRun`; `setup-core/verification-status.ts:41-47`: ein `lastRequiredCheck` mit einer `workspaceRoot`. Verifikation von Repo B verdrängt den Nachweis für A.

### P3-Befunde

- **F-12 · bestätigt.** Recovery wird vor der Permission-Prüfung entschieden (`guards.ts:285-335`). Bei `readonly` + Gate verlangt der Block `recovery_check`, danach blockt Readonly trotzdem („…ausschließlich auf keine Datei“, R8): nutzloser Toolaufruf, irreführende Meldung.
- **F-13 · bestätigt.** `permissions/session-state.ts:10-17` behauptet, Recovery bleibe auf allen YOLO-Stufen aktiv; ADR 029 und `guards.ts` heben es bei `yolo-full` auf. ADR 016 spricht von „write, edit und Bash“, der Code sperrt jedes unbekannte Tool.
- **F-14 · bestätigt.** Tests sind nicht hermetisch gegenüber globaler Git-Config: `commit.gpgsign=true` ändert Commit-SHAs und damit 11 Fingerprint-Assertions.
- **F-15 · plausibel.** Antwortet kein Provider auf die Recovery-Anfrage, sperrt der Guard alle nicht lesenden Tools, und `recovery_check` existiert nicht (X4). Es gibt keinen Doctor-Check für das Vorhandensein von `resilience`. Ob Subagenten-Kindprozesse beide Extensions laden, ist offen.
- **F-16 · bestätigt (Abwesenheit).** Keine technische Erkennung wiederholter identischer Blockaden (nur Prompt-Text `AGENTS.md:11`); einziger Zähler für gleichen Fehler bei gleichem Workspace: `project_check` (`setup-core/index.ts:294-298`). Retry-Konfiguration: `maxRetries 3`, `baseDelayMs 2000`, `provider.timeoutMs 3600000` (`settings.json:110-117`).
- **F-17 · bestätigt.** Der Fingerprint enthält keine Root-Identität (ADR 027 bewusst). Zwei Worktrees mit gleichem Inhalt haben denselben Fingerprint (W2). X5b („allow“ beim Resume in anderem Repo) ist ein Testartefakt (identische Commits) und belegt nur die fehlende Root-Bindung.

---

## Bericht 3 – Mögliche Blockaden

### Deadlock-Matrix (Untersuchung B)

| Szenario                                          | Bewertung                                                                                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery verlangt Aktion, die Permissions sperren | `recovery_check` ist in `tool-policy.ts:135` immer erlaubt. Kein Konflikt, außer wenn der Snapshot selbst fehlschlägt (F-02).                                              |
| Fehlgeschlagene Prüfung wird erneut verlangt      | bestätigt (F-02, X3, W6c).                                                                                                                                                 |
| Verifier braucht Zustand, den Recovery verhindert | `subagent` ist bei scharfem Gate gesperrt (R7); das Commit-Gate verlangt Verifier + Snapshot. Defekter Snapshot ⇒ weder Verifier noch Commit, ohne Ausweg für den Agenten. |
| Agent wiederholt identische geblockte Aktionen    | Kein technischer Schutz (F-16).                                                                                                                                            |
| Unklare Workspace-Identität verhindert Resume     | bestätigt (F-02, F-09).                                                                                                                                                    |
| Komponenten erwarten widersprüchliche Zustände    | Recovery, Permissions und Plan-Mode nutzen unterschiedliche Klassifikatoren (F-06).                                                                                        |

### Fehlerspirale „Aktion → Fehler → Recovery → Sperre → Versuch → kein Fortschritt“

Technisch möglich: dauerhaft ohne Fortschritt bei F-02; mit Fortschritt aber hohem Overhead bei F-01/F-09. Reine Toolfehler (Exit-Codes, fehlschlagende Edits) sind nicht betroffen.

### Teststatus der Szenarien aus Untersuchung F

| #   | Szenario                                    | Abdeckung                                                              |
| --- | ------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Harmloser Lesefehler                        | teilweise (Marker/Anweisung; „kein Gate bei Lese-Turn“ nicht explizit) |
| 2   | Fehlgeschlagene Mutation ohne Dateiänderung | nicht getestet                                                         |
| 3   | Unterbrochene Mutation                      | getestet (`resilience.mjs:225-315`)                                    |
| 4   | Fehlender Fingerprint                       | getestet (als `"unavailable"` im Marker)                               |
| 5   | Wiederholte Recovery-Sperre                 | nur Zwei-Check-Fall (REC-002), nicht mit echtem Write dazwischen       |
| 6   | Neustart mit aktivem Gate                   | getestet                                                               |
| 7   | Permission-Ablehnung                        | Permission getestet, nicht die Wechselwirkung mit Recovery             |
| 8   | Plan-/Work-Wechsel                          | Plan-Suites getestet, nicht mit Gate                                   |
| 9   | Nicht-Git-Verzeichnisse                     | Snapshot getestet, nicht Gate-Zyklus, Limit oder Elternverzeichnis     |
| 10  | Unterschiedliche Workspace-Roots            | nur verschachteltes `cwd` im Snapshot-Test                             |

### Ausgeführte Tests

| Kommando                                                                                                                 | Ergebnis                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `PI_TEST_SUITE=runtime PI_SECTION_STATS=1 node tests/run.mjs`                                                            | 1794 bestanden / 50 fehlgeschlagen                                                     |
| dasselbe mit `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null`                                                   | 1805 bestanden / 39 fehlgeschlagen                                                     |
| `node tests/workspace-snapshot.test.mjs`, `tests/session-health.test.mjs`, `tests/workflow-mode/session-health.test.mjs` | exit 0                                                                                 |
| `tests/permissions.test.mjs`, `tests/workflow-mode/permissions.test.mjs`                                                 | **nicht ausführbar** (importieren `pi-subagents` aus `node_modules`, Installation 403) |

- Die 11 Fingerprint-Fehler des ersten Laufs stammen von der globalen Git-Config des Containers (F-14).
- Die 39 Restfehler betreffen den Verifier („verifier coverage capability bridge“ 16, „verifier ticket contract“ 20, „snapshot gate asynchronous regressions“ 2) sowie einen tracked-executor-SIGKILL-Test. Vermutete Ursache: fehlendes `pi-subagents`; nicht einzeln verifiziert. Diese Sections sind als nicht belastbar zu behandeln.

---

## Bericht 4 – Permissions und Workflow

### Stufen und Wirkung (`guards.ts`, `tool-policy.ts`, `workflow-policy.ts`)

| Stufe         | Trust-Grenze | Recovery-Gate  | Plan-Schreibschutz               | Schreiben außerhalb `cwd`      |
| ------------- | ------------ | -------------- | -------------------------------- | ------------------------------ |
| readonly      | aktiv        | aktiv          | passiert, Readonly blockt selbst | blockiert                      |
| project-write | aktiv        | aktiv          | aktiv                            | blockiert                      |
| confirm-all   | aktiv        | aktiv          | aktiv                            | blockiert                      |
| headless      | aktiv        | aktiv          | aktiv                            | blockiert; jedes „ask“ = Block |
| yolo (1)      | aktiv        | **aktiv**      | aktiv                            | blockiert                      |
| yolo-ask (2)  | aktiv        | **aktiv**      | aktiv                            | fragt nach                     |
| yolo-full (3) | aufgehoben   | **aufgehoben** | aufgehoben                       | erlaubt                        |

Plan-/Work-Modus ändern das Recovery-Verhalten nicht.

### Antworten auf Untersuchung C

1. **Permission-Ablehnung löst Recovery aus?** Indirekt ja (F-03a).
2. **Recovery scheitert an Permissions?** Nein; höchstens am eigenen Snapshot (F-02).
3. **Mehrere Komponenten bewerten denselben Aufruf?** Ja, sequenziell: Trust, Workflow, Web, Verifier-Delegation, Temp-Spec, Commit-Gate, Recovery, Plan-Guard, `decideTool` (`guards.ts:147-379`); drei davon mit eigener Tool-/Shell-Klassifikation.
4. **Widersprüchlich?** In Randbereichen ja (F-06, F-12, F-13).
5. **Nachvollziehbar für den Agenten?** Teilweise: Blocktexte sind ausführlich, aber Gate-Gründe werden vom Permission-Grund überlagert (F-12), und die Recovery-Anweisung nennt `recovery_check` nicht (F-07).
6. **Wiederholte Bestätigungen?** Nicht aus Recovery; der Overhead entsteht aus F-01.
7. **Mehrprojekt erschwert?** Ja: „Projekt“ ist überall genau ein `cwd` (F-10).

### Trennung der sechs Konzepte (Ist-Stand)

| Konzept                   | Heute                                         | Problem                                                |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| Tool-Zugriffsberechtigung | `decideTool`, `assessWorkflowTool`            | ok                                                     |
| Ausführungsberechtigung   | `confirmAction`, `decideBash`                 | ok                                                     |
| Tatsächliche Wirkung      | `classifyOperationEffect`, `resolvePathScope` | Standard „unbekanntes Programm = SAFE“                 |
| Unbekannte Seiteneffekte  | nirgends modelliert                           | Recovery behandelt sie je nach Tool/Bash gegensätzlich |
| Verifikationsanforderung  | `verifier-policy.ts`                          | eigener Snapshot-Aufruf, Einzelslot                    |
| Recovery-Anforderung      | `recoveryEffect`                              | dritte, abweichende Klassifikation                     |

**Vorschlag:** ein gemeinsamer Capability-Descriptor pro Aufruf (`reads`, `writesProject`, `writesExternal`, `executesCode`, `delegates`, `network`, `confidence`), einmal in `guards.ts` berechnet und an alle Schichten übergeben.

---

## Bericht 5 – Multi-Projekt-Grenzen

| Szenario                              | Befund                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: Pi in A, Informationen aus B lesen | **funktioniert**: Lesen außerhalb erlaubt (W5a); Schreiben nach B hart geblockt (W5b).                                                                                                       |
| 2: gleichzeitig mehrere Projekte      | Nicht vorgesehen: Pfadgrenze, Trust, `verify.json`, Setup-Config hängen an einem `cwd`; Schreibfreigabe nur über `yolo-ask`/`yolo-full`, dann blockt ggf. das Gate.                          |
| 3: Fehler in A, B nicht sperren       | Gate ist **sessionweit**, nicht pro Root (W5c). Bei `cwd=P` (Elternverzeichnis) re-armiert ein Commit in A auch B (W4g).                                                                     |
| 4: Start außerhalb von Git            | Dateisystem-Snapshot: klein ok (R9), scheitert ab 100k Einträgen (W6) und bei `git status` in Kind-Repos (F-09). Git-Commit-Check dort ausdrücklich geblockt (`verifier-policy.ts:552-557`). |
| 5: mehrere Repos jeweils verifizieren | Einzelslot-Ledger (F-11); `project_check` nutzt nur das `.pi/verify.json` des `cwd`.                                                                                                         |

### Hindernisse und Voraussetzungen

1. **Workspace-Wurzeln explizit modellieren** (`WorkspaceScope` mit Liste von Roots, abgeleitet aus Git-Toplevel, `cwd`, optionalen Zusatzroots), gemeinsam genutzt von Permissions, Snapshot, Recovery, Verifier, `verify.json` (F-10).
2. **Recovery-Marker pro Root**; Prüfung nur für den betroffenen Root.
3. **Ledger als Map `root → Eintrag`** (F-11).
4. **Snapshot robust gegen verschachtelte Repos/Worktrees:** untracked Verzeichnisse mit `.git` als opaker `stat`-Eintrag; im Dateisystem-Modus `.git` auf jeder Ebene überspringen.
5. **Worktrees:** `.git` als Datei und Geschwister-Worktrees funktionieren (W2); verschachtelte scheitern (W1).

---

## Bericht 6 – Lösungsvarianten

Relativ zum Ist-Stand. Außer den Snapshot-Zahlen oben gibt es keine Performance-Messwerte; „Performance“ ist daher qualitativ.

| Kriterium               | A: behalten, Bugs fixen                       | B: vereinfachen                           | C: risikobasiert                               | D: Gate entfernen                            |
| ----------------------- | --------------------------------------------- | ----------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| Zuverlässigkeit         | F-01/02 behoben, Snapshot-Abhängigkeit bleibt | besser: weniger Auslöser                  | gut, wenn Mutationsklassifikation stimmt       | hängt an Tool-Disziplin und Verifikation     |
| Sicherheit              | wie heute (mit Lücken F-06)                   | etwas weniger Abdeckung bei „interrupted“ | gezielt bei möglicher unvollständiger Mutation | schwächer: keine Sperre nach Teilmutation    |
| Agentenautonomie        | niedrig                                       | mittel                                    | hoch                                           | hoch                                         |
| Wartbarkeit             | schlecht (zwei Klassifikatoren, vier Listen)  | besser                                    | gut mit gemeinsamem Descriptor                 | am besten                                    |
| Komplexität             | unverändert                                   | sinkt                                     | mittel                                         | sinkt am stärksten                           |
| Performance             | unverändert                                   | weniger Snapshots möglich                 | Snapshots nur bei Verdacht                     | entfällt                                     |
| Token-/Tool-Overhead    | bleibt (Extra-Checks)                         | sinkt                                     | niedrig                                        | niedrigster                                  |
| Multi-Projekt           | schwer                                        | mittel                                    | gut (Gate pro Root)                            | einfach                                      |
| Implementierungsaufwand | klein–mittel                                  | mittel                                    | mittel–groß                                    | mittel                                       |
| Migrationsrisiko        | gering                                        | gering–mittel                             | mittel (Marker-Format, ADR 016/027)            | mittel–hoch (Sicherheitsvertrag ändert sich) |

---

## Bericht 7 – Empfehlung

**Ansatz C, schrittweise, beginnend mit den Teilen von A und B, die ohne Semantikverlust umsetzbar sind.** Ansatz D wird vorerst abgelehnt: Das Gate adressiert einen plausiblen, im Code angelegten Fall (blinde Wiederholung nach abgebrochener Mutation); ein Ausfallnachweis aus echten Sessions liegt jedoch nicht vor. Die Probleme liegen in Auslösern, Freigabe-Semantik und Snapshot-Robustheit, nicht im Kerngedanken.

### Priorisierte Maßnahmen

| #   | Maßnahme                                                                                                                                                                                       | Behebt             | Aufwand | Risiko                                                                   | Erwartete Wirkung                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| 1   | **Gate nach erfolgreichem Check schließen.** Re-Arm nur durch neuen Fehlturn/`interrupted` oder Baseline nach eigenem erfolgreichem Mutations-Tool nachführen.                                 | F-01               | S       | ADR-016-Semantik ändert sich (Schutz vor externer Änderung nach Check)   | Kein Extra-Check pro Änderung              |
| 2   | **Nicht erfassbarer Snapshot ≠ Dauerblock:** `"unavailable"` ≠ „geändert“; `recovery_check` meldet „nicht verifizierbar“, Freigabe nach Nutzerbestätigung (`ask_user`/confirm).                | F-02               | M       | Fail-closed wird an einer Stelle aufgeweicht, braucht Nutzerentscheidung | Beseitigt den unauflösbaren Zustand        |
| 3   | **Snapshot robuster:** verschachtelte Repos/Worktrees opak, `.git` auf jeder Ebene überspringen, 100k-Limit degradiert statt scheitert, große Dateien per `stat` oder asynchron hashen.        | F-02, F-08, F-09   | M       | Fingerprint-Schema ändert sich (Version erhöhen, ADR 027)                | Weniger Dauerfehler und UI-Hänger (messen) |
| 4   | **Auslöser präzisieren:** Mutation nur zählen, wenn der Aufruf den Guard passiert hat; Abort als eigener Zustand.                                                                              | F-03, F-04         | S–M     | niedrig                                                                  | Weniger Fehlalarme                         |
| 5   | **„Interrupted“ nur bei Abweichung:** Fingerprint-Vergleich mit Start-Marker, sonst nur Hinweis.                                                                                               | F-05               | S       | niedrig                                                                  | Weniger Sperren nach Absturz im Lese-Turn  |
| 6   | **Gemeinsamer Capability-Descriptor** für Plan, Recovery, Readonly, Trust; Tool-Listen zusammenführen; Bash über denselben Pfad.                                                               | F-06, F-12, F-13   | M–L     | mittel (Regression in Plan/Readonly; gute Testbasis vorhanden)           | Weniger Widersprüche und Doku-Drift        |
| 7   | **Nicht-TUI:** Recovery-Block ohne `terminate`, `recovery_check` in der Anweisung nennen, RPC-Confirm prüfen.                                                                                  | F-07               | S–M     | niedrig; RPC-Teil braucht Test mit echtem Frontend                       | Fortsetzung in RPC/print                   |
| 8   | **Mehrprojektfähigkeit:** `WorkspaceScope` mit Roots, Gate und Ledger pro Root.                                                                                                                | F-10, F-11, Ber. 5 | L       | hoch (öffentlicher Vertrag `docs/frontend-api.md`, Marker-Format)        | Voraussetzung für Szenarien 2, 3, 5        |
| 9   | **Fehlende Tests:** Write nach Check, geblockter Write + Abort, Snapshot-Fehler (verschachteltes Repo, Worktree, >100k, Churn), Elternverzeichnis + `git status`, RPC, hermetische Git-Config. | alle               | S–M     | keins                                                                    | Regressionsschutz für 1–7                  |
| 10  | **Doku/Ledger korrigieren:** `agent-workflow.md:23`, `session-state.ts`-Header, CONTEXT_LEDGER, ADR 016/029.                                                                                   | F-13               | S       | keins                                                                    | Weniger Fehlerwartung beim Agenten         |

---

## Abschlussentscheidung

1. **Ist `recovery_check` in der heutigen Form gerechtfertigt?** Das Schutzziel ja, die Umsetzung nur teilweise. F-01 und F-02 sind unverhältnismäßig und sollten vor Erweiterungen behoben werden.
2. **Welche Mechanismen verhindern nachweislich Risiken?** Das Gate stoppt nach einem Fehlturn mit echter Mutation blindes Weiterschreiben (R2, R4a); Persistenz über Restarts ist getestet; Projekt-/Secret-Grenzen und Commit-Gate sind fail-closed.
3. **Welche könnten unnötige Blockaden verursachen?** Einmalfreigabe (F-01), Snapshot-Abhängigkeit (F-02), Mutationsannahme bei geblockten/nicht-mutierenden Tools (F-03), Abort (F-04), bedingungsloses „interrupted“ (F-05), sessionweites Gate (Bericht 5).
4. **Welche Funktionen überschneiden sich?** Recovery, Plan-Mode, Readonly, Trust und Verifier haben getrennte Tool-/Bash-Klassifikationen; Recovery und Verifier rufen eigene Snapshots auf und teilen die Fehlermodi.
5. **Was könnte entfernt werden?** Die erneute Fingerprint-Prüfung nach erfolgtem Check (Maßnahme 1); die Mutationsannahme für Tools ohne Workspace-Wirkung (`plan_write`, Web, Read-only-Subagenten); vier Kopien der Tool-Listen.
6. **Was braucht Mehrprojektfähigkeit?** Workspace-Scope mit Roots, Gate und Ledger pro Root, robuster Snapshot für verschachtelte Repos, Permissions mit Rootliste statt einem `cwd` (Maßnahme 8).
7. **Minimaler Umbau mit größtem Nutzen?** Maßnahmen 1 und 2 zusammen: kleiner Eingriff, beseitigt die einzige belegte unauflösbare Blockade und den Großteil des Wiederholungsaufwands.
8. **Ohne lokale Laufzeitdaten nicht beantwortbar:** reale Auslösehäufigkeit und Fehlalarmquote (bräuchte `/session-health` bzw. die Session-JSONLs); ob Esc in der echten TUI das Event aus F-04 liefert; Einfluss der Runtime-Patches; reale Snapshot-Zeiten auf Nutzerhardware; Verhalten eines echten RPC-Frontends (F-07); ob Subagenten-Kindprozesse die Permission-/Resilience-Extensions laden (F-15); Ursache der 39 Restfehler im Container-Testlauf.

---

## Anhang – Nachvollziehbarkeit der Repro-Läufe

Die Skripte lagen außerhalb des Repos (Scratchpad) und treiben die echten Extensions über `tests/shared/harness.mjs` und `tests/shared/jiti-loader.mjs`, jeweils in temporären Verzeichnissen mit neutraler Git-Config (`GIT_CONFIG_GLOBAL=/dev/null`).

| Kürzel     | Inhalt                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1–R10     | Recovery-Szenarien: nicht-mutierende Tools, Abort, geblockter Write, Einmalfreigabe, verschachteltes Repo, FIFO, Klassifikationsmatrix bei scharfem Gate, Readonly-Reihenfolge, Nicht-Git-Verzeichnis, Plan-Modus |
| W1–W7      | Workspace-Grenzen: Worktrees, Unterverzeichnis-`cwd`, Elternverzeichnis mit mehreren Repos, Geschwister-Repo, >100k Einträge, defektes `.git`                                                                     |
| X1–X7      | `git status`-Effekt im Elternverzeichnis, Event-Loop-Messung, Churn, fehlende Resilience-Extension, Resume, Nicht-TUI-Modi, `interrupted` bei identischem Workspace                                               |
| `order`    | Echter `pi-agent-core`-`Agent` mit Faux-Provider: `tool_execution_start` vor `beforeToolCall`, `execute()` nie aufgerufen                                                                                         |
| `classify` | `classifyOperationEffect` über ca. 65 Beispielbefehle                                                                                                                                                             |

Die Repro-Läufe benutzen das Test-Harness der Repo-Extensions, nicht die reale Pi-Laufzeit. Die Reihenfolge der Runtime-Events wurde separat mit dem gepinnten `pi-agent-core` (`order`) belegt.
