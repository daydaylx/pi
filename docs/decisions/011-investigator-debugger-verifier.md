# 011 — Investigator, Debugger, Verifier ersetzen Planner, Worker, Reviewer

## Kontext

[005](005-three-agent-model.md) legte drei aktive Rollen unter `agents/` fest:
`planner`, `worker`, `reviewer`. In der Praxis deckten sich diese Phasen nicht
mit den tatsächlichen Delegationsanlässen. Repository-Exploration verbraucht
bei Coding-Agenten häufig einen großen Teil des Kontexts und verdient eine
eigene, rein lesende Rolle statt einer Variante von `planner`. Ein unbekannter
oder instabiler Fehler braucht einen anderen Ablauf als eine normale Änderung
— reproduzieren, Hypothesen trennen, Experimente durchführen — und keine
eigenmächtige Reparatur. Und ein sprachliches „sieht gut aus" ist kein
Nachweis; eine unabhängige Prüfung muss Anforderungen, Diff und ausführbare
Checks verbinden, ohne selbst zu korrigieren.

## Entscheidung

Es bleiben genau drei aktive Rollen unter `agents/`:

- `investigator` — read-only, kein Bash, kein `edit`/`write`; findet
  Fundstellen, Kontrollfluss und Änderungssurface.
- `debugger` — Bash für Reproduktion und Experimente, kein `edit`/`write`;
  reproduziert unbekannte oder intermittierende Fehler und prüft Hypothesen,
  repariert aber nicht selbst.
- `verifier` — Bash für ausführbare Checks, kein `edit`/`write`; prüft einen
  fertigen Patch gegen Anforderungen, Diff und Tests, korrigiert aber nicht
  selbst.

Planung, Implementierung, Triage und finale Nutzerkommunikation bleiben
vollständig beim Hauptagenten; er bleibt alleiniger regulärer
Patch-Eigentümer. Es gibt keine automatische Pflichtkette durch alle drei
Rollen und keine verschachtelte Delegation. Die alten Profile `planner.md`,
`worker.md`, `reviewer.md` liegen archiviert unter
`docs/archive/subagents-v1/`.

## Begründung

Getrennte, überwiegend lesende Rollen halten breite Exploration und
Verifikation aus dem Hauptkontext heraus, ohne einen zweiten schreibenden
Agenten oder eine Completion-/Abschlusslogik einzuführen. `debugger` und
`verifier` besitzen technisch ein breites Werkzeug (`bash`), weil sie
Programme und Tests ausführen müssen; ihre Profile verbieten aber ausdrücklich
Befehle, deren Zweck die Änderung von Quellcode, Konfiguration oder
Git-Zustand ist. Damit gibt es weiterhin nur einen regulären schreibenden
Agenten im Setup: den Hauptagenten.

## Konsequenzen

- 005 gilt als historisches Protokoll weiter, beschreibt aber nicht mehr die
  aktive Rollenstruktur; diese Entscheidung ersetzt sie vollständig.
- `AGENTS.md`, `docs/subagents.md` und `README.md` verweisen nur noch auf
  `investigator`, `debugger`, `verifier` als aktive Rollen.
- `tests/suites/runtime.mjs` (Abschnitt „native subagent profiles") prüft
  maschinell: genau drei aktive Profile mit exakten Namen, die Tool-Grenzen
  (kein `edit`/`write`; `investigator` ohne `bash`; `debugger`/`verifier` mit
  `bash`), `defaultContext: fresh`/`inheritProjectContext: true`/
  `inheritSkills: false`, die Archivierung der alten Profile und dass
  `planner`/`worker`/`reviewer` in den aktiven Dokumenten nicht mehr als
  verfügbare Rollen erscheinen.
- Der Paket-Pin für `git:github.com/daydaylx/pi-subagents` in `settings.json`
  bleibt von dieser Umstellung unberührt; die Rollenanzahl ist kein Anlass für
  einen Paket-Update.
