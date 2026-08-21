# 016 — YOLO-Sperre im Planmodus und Recovery-Gate vor Schreibzugriffen

## Kontext

Zwei Schwächen erlaubten es, harte Grenzen stillschweigend zu umgehen:

1. **YOLO im Planmodus.** Der Planmodus-Schutz (012) ließ `yolo` als
   ausdrückliche Ausnahme zu. Damit konnte ein aktiviertes YOLO die
   Schreibgrenze des Planmodus für Agenten-Tool-Aufrufe vollständig
   aufheben — der Planmodus verlor seine zentrale Eigenschaft, dass der
   Agent dort ausschließlich die Plandatei schreibt.
2. **Unterbrochene Mutationen.** Endete ein Turn mit Fehler oder Abbruch,
   nachdem ein mutierendes Tool gelaufen sein konnte, war der Workspace
   möglicherweise halb geändert. Der nächste Turn konnte sofort weiter
   schreiben, ohne dass jemand den Zustand geprüft hatte — und konnte so
   eine bereits gelaufene Mutation blind wiederholen oder darauf aufbauen.

## Entscheidung

**YOLO-Sperre.** `/yolo` und `/permission yolo` werden in `simple_plan` und
`detailed_plan` verweigert; Modus und Berechtigungsstufe bleiben
unverändert. Die TUI weist auf den erforderlichen expliziten Wechsel nach
`work` hin (Shift+Tab). Jeder verweigerte Versuch schreibt einen
auditierbaren `permission-transition-denied`-Session-Eintrag. Zusätzlich
hebt ein bereits aktives YOLO die Planmodus-Guards für Agenten-Tool-Aufrufe
nicht mehr auf — die Ausnahme aus 012 entfällt. Direkt vom Menschen
eingegebene `!`/`!!`-Kommandos behalten ihr bestehendes Verhalten; die
Sperre betrifft Agenten-Tool-Aufrufe. Der Austritt aus einem bestehenden
YOLO_OVERRIDE bleibt jederzeit möglich.

**Recovery-Gate.** Die Resilience-Logik führt einen persistierten Zustand
`recovery-required → recovery-checked`. Nach einem fehlgeschlagenen oder
unterbrochenen Turn mit möglicher Mutation blockieren die Permission-Guards
`write`, `edit` und potenziell schreibende Bash-Aufrufe. Ein neues
read-only Tool `recovery_check` erfasst Workspace-Snapshot, `git status
--short` und eine Diff-Zusammenfassung und schreibt einen
`resilience.recovery-checked`-Eintrag. Nach erfolgreichem Check wird
Schreiben nur freigegeben, solange der Workspace-Fingerprint unverändert
bleibt; jede Änderung aktiviert die Sperre erneut. Das Gate übersteht einen
Neustart, weil es allein aus Session-Einträgen abgeleitet wird.

Das Gate ist eine harte Grenze: Es wirkt unabhängig von der
Berechtigungsstufe (auch unter YOLO) und prüft vor der
Planmodus-Freigabe, damit auch Schreibzugriffe auf die Plandatei nach einem
Fehlturn nicht stillschweigend durchlaufen. `recovery_check` und die
Nur-Lese-Tools bleiben immer frei. Ein Turn nach einer Recovery gilt nicht
wieder als regulär; der Recovery-Hinweis bleibt sichtbar.

## Begründung

Beide Mechanismen ersetzen Appelle durch Technik. Ein Planmodus, den ein
vorher aktiviertes YOLO aushebeln kann, und eine Schreibsperre, die nach
einem Fehlturn nicht existiert, sind Regeln, die nur so lange gelten, wie
niemand sie bricht. Die Guards entscheiden vor dem Executor und sind damit
testbar und versionsunabhängig. Der Recovery-Check ist bewusst zwingend und
ersetzt keine automatische Wiederholung von Schreiboperationen.

## Konsequenzen

- Der `TurnSettledMarker` unterscheidet `completed`,
  `completed_after_failure` und `failed` plus `recoveryPending`;
  Fehlerdiagnostiken tragen den gekürzten Fehlertext, Streaming-Fehler sind
  Klasse `stream` statt pauschal `unknown`.
- Abschlussstatus und UI zeigen „erfolgreich" erst, wenn kein ausstehendes
  Recovery-Gate vorliegt (Statusschlüssel `recovery` im Footer).
- `/session-health` berichtet die neuen Zustände read-only aus den
  Session-JSONLs; `run-history.jsonl` bleibt Rohhistorie.
- `recovery_check` ist als read-only-Fähigkeit in der Tool-Policy erlaubt
  und im Planmodus nutzbar, steht aber niemals hinter einem Dialog.

## Alternativen

- **YOLO nur im Planmodus verweigern, aber bestehendes YOLO weiter als
  Bypass zulassen:** verworfen, weil das die Umgehung über „erst YOLO in
  `work` aktivieren, dann in den Planmodus wechseln" offen gelassen hätte.
- **Recovery automatisch statt zwingend:** verworfen, weil ein automatisches
  Wiederholen einer möglicherweise bereits gelaufenen Mutation den
  Datenzustand verschlechtern kann; die Prüfung muss explizit bleiben.
