# 006 — Genau eine Completion-Pipeline

## Kontext

Neben der Pipeline in `extensions/plan-mode/completion/` existierte ein zweites
Verifikations-Gate in `setup-core/verification-gate.ts` mit eigener Aggregation,
eigener Typfamilie, eigenem Git-Parser, eigenem Report und eigener
Abschlussempfehlung. Zusätzlich hatten `/finish` und `/task-done`
unterschiedliche Override-Semantik: eines baute den Bericht aus dem gelaufenen
Ergebnis, das andere ließ die gesamte Pipeline ein zweites Mal laufen.

## Entscheidung

Es gibt eine Kette und einen internen Handler:

```text
Diff → harte Grenzen → Scope → deklarierte Verifikation → LSP
     → unabhängiger Reviewer → Diff-Stabilität → Completion-Ergebnis
```

- `/finish` (Planaufgabe) und `/task-done` (Direct Task) rufen denselben
  Handler; sie unterscheiden sich nur darin, was mit einem erzeugten Bericht
  geschieht — committen und archivieren gegenüber protokollieren und löschen.
- Ein Override ist kein Pipeline-Modus, sondern eine eigene begründete
  Entscheidung auf genau dem Ergebnis, das bereits vorliegt
  (`completionOverrideReport`). Die Pipeline läuft nie zweimal.
- `/verify-gate` ist eine reine Diagnose: dieselben Prüffunktionen, dieselbe
  Klassifikation, aber ohne Reviewer, ohne Diff-Stabilitätsprüfung, ohne
  Statusschreibung und ohne Bericht.

## Begründung

Zwei Aggregationen bedeuten zwei Antworten auf dieselbe Frage. Ein zweiter
Pipelinelauf für den Override prüfte die Diff-Stabilität gegen einen Diff, der
zu einem anderen Zeitpunkt erfasst wurde — der Override hätte den Nachweis
unterlaufen können, den er gerade übersteuert.

## Konsequenzen

- Harte Secret-/Auth-Grenzen sind nie übersteuerbar:
  `completionOverrideReport` wirft, wenn `hard-boundaries` nicht bestanden hat.
- Ein Override verlangt eine nichtleere Begründung und ist nur im interaktiven
  TUI möglich; Hintergrundpfade besitzen keinen Override.
- **Bewusste Abweichung von der Auftragsvorgabe:** der automatische Abschluss in
  `plan-mode/events.ts` (`agent_settled`, wenn alle Schritte `completed` sind)
  bleibt erhalten. Er ist kein Bypass — er ruft denselben Handler mit
  `allowOverride=false`; ein Befund führt zu `blocked`, nie zu `done`. Der
  Auftragspassus zielt auf markerbasierte Abschlüsse ohne Pflichtchecks, die es
  hier nicht gibt.
