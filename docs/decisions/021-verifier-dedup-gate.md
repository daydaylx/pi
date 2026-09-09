# 021 — Verifier-Delegationen werden auf unverändertem Fingerprint dedupliziert

## Kontext

`extensions/setup-core/index.ts` bindet seit Entscheidung 015 jeden
abgeschlossenen `verifier`-Lauf an den Workspace-Fingerprint, gegen den er
geurteilt hat (`lastVerifierRun`, über `requestVerificationCapabilities()`
abfragbar). Genutzt wurde diese Bindung bisher ausschließlich für das
Commit-Gate (`assessGitCommitVerifierGate` /
`assessVerifierCoverageForDiff`): Ein `git commit` auf einem Pflichtpfad wird
blockiert, wenn der aktuelle Fingerprint **keinen** passenden PASS-Lauf hat.

Die umgekehrte Richtung fehlte: Ruft der Hauptagent den `verifier` zweimal
auf demselben, seit dem letzten abgeschlossenen Lauf unveränderten Diff auf,
wird das technisch nicht verhindert. Ein solcher zweiter Lauf liest
denselben Diff, führt dieselben Checks aus und kann bestenfalls dasselbe
Urteil reproduzieren — er verbraucht bis zu die vollen 20 Minuten
`timeoutMs` aus `agents/verifier.md`, ohne eine neue unabhängige Prüfung zu
liefern. Dieses Muster war Ausgangspunkt für eine externe Analyse von
Agent-Harness-Best-Practices (2026-09), die genau diesen Fall — Verifikation
ohne Rücksicht auf einen bereits vorliegenden, weiterhin gültigen Befund zu
wiederholen — als den am klarsten belegten Effizienzverlust benennt.

## Entscheidung

`extensions/permissions/verifier-policy.ts` bekommt eine neue reine Funktion
`assessVerifierDedup(task, cwd, verification)`, aufgerufen aus
`assessVerifierDelegation` nach den bestehenden Prüfungen (Pflichtabschnitte,
`turnBudget`/`timeoutMs`-Sperre):

1. Ist der letzte in `verification` erfasste Lauf `status: "completed"` für
   exakt diesen `cwd`, und stimmt sein `workspaceFingerprint` mit dem
   frisch über `collectWorkspaceSnapshot(cwd)` ermittelten aktuellen
   Fingerprint überein, gilt der Diff als bereits geurteilt.
2. In diesem Fall muss der `task`-Text einen zusätzlichen Abschnitt
   „Grund für erneute Prüfung" enthalten (analog zum bereits bestehenden
   Acceptance-Pattern), der begründet, was diese Delegation von der
   vorherigen unterscheidet — z. B. eine andere Teilfrage oder neue
   Erkenntnisse. Fehlt er, wird die Delegation geblockt; die Fehlermeldung
   nennt das gecachte Urteil.
3. Ein `"incomplete"`-Lauf (Timeout, Turn-Budget, Provider-Fehler, Detach)
   zählt nie als Vorlauf — ein Retry nach einem gescheiterten Lauf bleibt
   uneingeschränkt erlaubt, wie im bestehenden INCOMPLETE-Konzept
   (Entscheidung 015) bereits festgelegt.
4. Ein abweichender `workspaceRoot` oder ein Fingerprint-Unterschied (also
   ein tatsächlich veränderter Diff) lässt den Aufruf unverändert passieren.
5. Kann der aktuelle Fingerprint nicht ermittelt werden (kein Git-Repo
   o. Ä.), gilt dasselbe Fail-open-Prinzip wie beim Commit-Gate — ohne
   Evidenz wird nicht blockiert.

`extensions/permissions/guards.ts` zieht dafür den bestehenden
`requestVerificationCapabilities()`-Aufruf vor die Delegationsprüfung, statt
eine zweite Capability-Bridge einzuführen.

## Konsequenzen

- Ein Hauptagent, der denselben Diff versehentlich zweimal verifizieren
  lässt, bekommt das sofort und mit dem gecachten Urteil zurückgemeldet,
  statt erst nach bis zu 20 Minuten ein redundantes zweites Ergebnis zu
  erhalten.
- Ein absichtlicher zweiter Lauf auf demselben Diff (z. B. für eine andere
  Teilfrage) bleibt möglich, verlangt aber eine explizite, im Task-Text
  sichtbare Begründung — dieselbe „technisch erzwungen statt appelliert"-
  Linie wie die bestehende Delegationsvorlage.
- Keine neue Persistenz und keine neue Capability-Bridge: Die Funktion nutzt
  ausschließlich den bereits vorhandenen `lastVerifierRun`-Zustand und
  `collectWorkspaceSnapshot`.

## Alternativen

- **Nur Prosa-Regel in `AGENTS.md`.** Verworfen als alleinige Maßnahme aus
  demselben Grund wie in Entscheidung 015: Regel und Laufzeitverhalten
  laufen erfahrungsgemäß auseinander, wenn nichts sie technisch durchsetzt.
- **Hartes Verbot ohne Override-Pfad.** Verworfen, weil ein legitimer Zweitlauf
  auf demselben Diff (andere Teilfrage, neue Erkenntnis nach Rücksprache)
  dann grundsätzlich unmöglich wäre — die Begründungspflicht erreicht
  dieselbe Sparsamkeit, ohne einen echten Bedarf zu blockieren.
- **Automatisches Zurückliefern des gecachten Urteils statt eines Blocks.**
  Verworfen für diese erste Stufe: Das Blockieren mit sichtbarem Hinweis auf
  das gecachte Urteil ist einfacher zu testen und zu verstehen als ein
  synthetisches Tool-Result, das einen echten Subagenten-Lauf vortäuscht.
