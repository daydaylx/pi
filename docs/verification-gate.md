# Verifikation und Completion

`/verify-gate` bleibt eine manuelle Diagnose. Der verbindliche Abschluss für
Plan- und Direct-Task-Arbeit liegt in `extensions/plan-mode/completion/`.

## Verbindlicher Ablauf

1. PlanSnapshot/Sidecar beziehungsweise Direct Task validieren.
2. `git status`, `git diff --check`, Diff-Stat und Diff-Fingerprint erfassen.
3. Geänderte Dateien gegen den technischen Scope prüfen.
4. Secret-/Auth-Pfade als harte Grenze behandeln.
5. Projektprofile nach `required`, `recommended` oder `advisory` ausführen.
6. LSP-Diagnosen für unterstützte geänderte Dateien ausführen.
7. Einen unabhängigen lokalen Reviewer über Subagent-RPC starten.
8. Diff, Plan und State nach dem Reviewer erneut prüfen.
9. Erst danach `done` committen und deterministisch archivieren.

Jeder Eintrag aus dem Planabschnitt „Verifikation“ beziehungsweise aus dem
Direct Task muss durch einen erfolgreichen ausführbaren Profil-Check belegt
sein. Eine nicht zuordenbare Deklaration blockiert den Abschluss.

Erforderliche Checks müssen erfolgreich laufen. Ein fehlender erforderlicher
Check ergibt `blocked`, ein fehlgeschlagener `fail`. Empfohlene Checks schlagen
bei echten Fehlern fehl, bleiben bei Nichtverfügbarkeit als Restrisiko sichtbar.
Advisory Checks blockieren nie.

Der Reviewer muss genau einen Marker als letzte nichtleere Zeile liefern:

```text
[COMPLETION-REVIEW:PASS]
[COMPLETION-REVIEW:REWORK]
[COMPLETION-REVIEW:UNVERIFIABLE]
```

Nur `PASS` plus erfolgreiche Pflichtprüfungen ergibt einen normalen
Abschlussbericht. `/finish` darf in einer interaktiven TUI einen Befund mit
nichtleerer Begründung übersteuern; Hintergrundpfade besitzen keinen Override.
Ein Secret-/Auth-Befund ist eine harte Grenze und nie übersteuerbar.

## Sicherheitsgrenzen

- Kein Shell-String für Projektprofile: Programm und Argumente bleiben getrennt.
- Projektprofile werden nur in vertrauten Projekten geladen.
- Secret-/Auth-Diffs werden nicht an den Reviewer übermittelt.
- Untracked Inhalte werden gehasht, nicht in den Reviewer-Diff eingebettet.
- Verändert sich der Diff während der Prüfung, schlägt Completion fehl.
