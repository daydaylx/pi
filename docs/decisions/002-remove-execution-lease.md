# 002 — Keine Execution Lease, kein Heartbeat

## Kontext

v2 sicherte konkurrierende Ausführung über eine Lease mit Besitzer-ID und
Ablaufzeit ab, aufgefrischt durch einen Heartbeat. Das erzeugte zeitgesteuerte
Übernahmen: eine abgelaufene Lease durfte ein anderer Prozess an sich ziehen.

## Entscheidung

Lease, Heartbeat, Besitzer-ID und zeitgesteuerte Übernahme sind ersatzlos
entfernt. Nebenläufigkeit wird über CAS auf dem Sidecar plus kurzlebige
Workspace-Locks für mehrteilige Operationen abgesichert.

## Begründung

Eine Zeitgrenze ist eine Vermutung über einen anderen Prozess. CAS ist eine
Tatsache über den Zustand auf der Platte: entweder der erwartete Token passt
oder der Schreibvorgang scheitert. Für die tatsächlich auftretenden Fälle —
zwei Sessions im selben Projekt — reicht das und es kann nichts stillschweigend
übernommen werden.

## Konsequenzen

- Eine unterbrochene Ausführung meldet plan-mode beim Sitzungsstart und
  verweist auf `/work`. Es gibt keine automatische Fortsetzung.
- Ein verwaister Lock wird nur über `/recover-workflow-lock` nach ausdrücklicher
  TUI-Bestätigung entfernt.
- Tests für Lease und Heartbeat sind entfallen; der CAS-Konflikttest in
  `tests/workflow-v3/concurrency.test.mjs` bleibt und schützt die Anforderung.
