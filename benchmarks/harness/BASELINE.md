# Bekannte Baseline-Abweichungen bei Commit 7b886a3

`npm run verify` zeigt bei Referenzcommit `7b886a3`, wenn es **außerhalb**
von `/home/d/.pi/agent` läuft (z. B. in einem Benchmark-Worktree), sechs
Fehlschläge, die nichts mit einer Agentenaktion zu tun haben. Verifiziert
durch isolierte Vergleichsläufe (git-archive-Snapshot an einem Fremdpfad,
mit/ohne einzelne Dateiänderungen).

## Ursachen

1. **`verify runs the setup's fixed command from the agent directory`**
   (`tests/run.mjs`, Section "setup core lifecycle"): `getAgentDir()` aus
   `@earendil-works/pi-coding-agent` fällt ohne gesetzte
   `PI_CODING_AGENT_DIR`-Umgebungsvariable auf `homedir() + "/.pi/agent"`
   zurück — unabhängig vom tatsächlichen Ausführungspfad. Der Test erwartet
   `ROOT` (den Pfad, aus dem `tests/run.mjs` tatsächlich geladen wurde).
   **Gegenmaßnahme:** `harness/run-verify.sh` setzt `PI_CODING_AGENT_DIR` auf
   den Worktree-Pfad. Das behebt genau diesen einen Fehlschlag (siehe unten,
   Rest bleibt bestehen).

2. **Fünf Fehlschläge in Section "thinking view lifecycle"**
   (`agent start publishes a waiting state`, `a thinking_start delta flips
the status to THINKING`, `the hidden-thinking label is kept informative
while thinking streams`, `a text delta after thinking flips the status to
ANSWERING, never THINKING again`, `a turn without any thinking delta is
honestly labeled NO VISIBLE THINKING`): Bei Commit `7b886a3` ist
   `extensions/thinking-view.ts` bereits auf deutsche Statuswerte umgestellt
   (`WARTEN`/`DENKEN`/`ANTWORTEN`/`NO VISIBLE THINKING` fehlt komplett), aber
   `tests/run.mjs` bei genau diesem Commit sucht noch nach den alten
   englischen Werten (`WAITING`/`THINKING`/`ANSWERING`). Verifiziert per
   Debug-Trace: der publizierte Status ist korrekt `"◌ WARTEN"`, der Test
   prüft `.includes("WAITING")`. Das ist eine Inkonsistenz, die im Commit
   selbst steckt (Quelldatei und Testdatei liefen bei der Übersetzung
   auseinander) — **kein** Umgebungs- oder Pfadproblem, keine Nebenwirkung
   dieses Benchmarks, keine Aufgabe, die ein Agent lösen soll.

   Wichtig: Dieser Fehlschlag tritt unabhängig vom Ausführungspfad auf und
   ist reproduzierbar identisch, ob im Haupt-Checkout mit gecheckoutetem
   `7b886a3` oder in einem Worktree/Archiv-Snapshot.

## Konsequenz für die Metrik "Test-/Build-Ergebnis"

`harness/run-verify.sh` behebt Fehlschlag 1 durch `PI_CODING_AGENT_DIR`.
Fehlschlag 2 (5 Tests) bleibt bestehen und wird von
`harness/collect-metrics.mjs` als bekannte Baseline abgezogen: Eine Aufgabe
gilt nur dann als "Test-/Build-Ergebnis: rot", wenn **mehr** als diese 5
bekannten Fehlschläge auftreten, oder wenn einer der 5 bekannten Fehlschläge
fehlt, aber ein anderer, unbekannter Fehlschlag an seiner Stelle steht
(Signatur-Vergleich über die exakten Testnamen, nicht nur die Anzahl).

`BASELINE_FAILURE_COUNT = 5` und `BASELINE_FAILURE_NAMES` sind in
`harness/collect-metrics.mjs` als Konstanten hinterlegt.

## Warum das nicht repariert wird

Dieser Auftrag ändert keinen Produktivcode und keinen bestehenden Commit.
`7b886a3` ist der bewusst gewählte, unveränderliche Referenzpunkt für alle
Benchmark-Aufgaben (siehe Plan). Die Inkonsistenz wird hier dokumentiert und
in der Metrik-Erfassung kompensiert, nicht am Ursprung behoben.
