# 035 — Planmodus und Workflow-Zustand entfernt, Shift+Tab freigegeben

## Status

Angenommen. Ersetzt 012 und 020 vollständig und den Planmodus-Teil von 016
(das Recovery-Gate aus 016 bleibt gültig).

## Entscheidung

Pi arbeitet wieder als eigenständiger Coding-Agent ohne technisch erzwungenen
Planmodus. Es gibt weder die Zustände `work`/`simple_plan`/`detailed_plan`
noch `plan_write`, Planfreigabe, Plan-Qualitätsprüfung oder einen
Workflow-Umschalter. Planung läuft über normale Prompts und später optional
über einen Skill.

Shift+Tab ist freigegeben (inzwischen von der Skill-Auswahl belegt, ADR 037). Ein
Launcher ist **nicht** Teil dieser Entscheidung.

## Begründung

Der Planmodus band Berechtigungen, Aurora, Frontend-Protokoll, Task-Tier und
Verifikation an einen zusätzlichen Zustand. Die Permission-Schicht fragte den
Workflow-Zustand bei jedem Tool-Aufruf ab und sperrte YOLO, sobald kein
Provider antwortete; schon das Fehlen der Extension blockierte normale Arbeit.
Der Nutzen (ein Prompt-Kontext und ein Schreibschutz, den die Zugriffsstufe
`readonly` ohnehin bietet) stand in keinem Verhältnis zu Komplexität und
Sonderregeln.

## Konsequenzen

- **Permissions:** Kein Workflow-Provider ist mehr Voraussetzung einer
  Entscheidung. Trust-, Secret-, Symlink- und Systemgrenzen, Freigabedialoge,
  Stufen, YOLO 1–3, Recovery-Gate und Verifier-Anforderungen sind unverändert;
  entfallen sind nur die planmodusspezifischen Schreib-, Bash-, Typecheck- und
  Spec-Sonderregeln und die YOLO-Sperre bei unbekanntem Workflow.
- **Recovery:** Die read-only-Shell-Klassifikation, die Recovery nutzt
  (`diagnoseCommandSafety`, früher `diagnosePlanModeCommand`), ist
  verhaltensgleich erhalten (`docs/executable-trust.md`).
- **`/commands`:** Das Command Center liegt in `extensions/shared/command-center.ts`
  und wird von `extensions/control-plane.ts` registriert; die Kategorie „Plan"
  und die Commands `view-plan`, `edit-plan`, `save-plan`, `plan-decide`,
  `plan-approve`, `workflow-set` entfallen.
- **Aurora:** Keine Workflow-/Plan-Anzeigen mehr; die Fußzeile zeigt nur noch
  bei `pi system` ein `SYSTEM`-Chip statt des Workflow-Labels. Die
  Phasenkette kennt keine Phase „Planen" mehr.
- **Frontend-Protokoll:** Paketversion 1.4.0, Wire-Major bleibt 1. `workflow`
  ist ein konstanter, als deprecated markierter Zustand `work`;
  `workflow.list` liefert `["work"]`, `workflow.set` akzeptiert nur `"work"`
  (No-op) und verweigert die alten Modi mit `UNSUPPORTED_CAPABILITY`. Die
  Command-IDs `workflow.open`, `plan.decide`, `plan.approve` entfallen. Der
  interne Bus-Vertrag (`PROTOCOL_VERSION` in `state-contract.ts`) wird 2.0.0:
  das Feld `workflow` und seine Besitzer-Zuordnung sind weg.
  **Migration externer Clients:** Workflow-Picker und Plan-Entscheidung
  entfernen; ein fehlendes oder `work`-wertiges `workflow` gilt als konstant.
  Entfernung der Felder mit dem nächsten Wire-Major.
- **Persistenz:** Resilience-Marker tragen kein `workflowMode` mehr; ältere
  Einträge mit dem Feld bleiben lesbar. Plandateien unter
  `~/.pi/agent/plans/` und Sitzungshistorien werden nicht angefasst.
- **Installation:** `scripts/install-user.mjs` entfernt beim Update die
  veralteten, installer-eigenen Pfade (`extensions/plan-mode` u. a.), damit
  kein Settings-Eintrag eine verwaiste Extension aktiv hält.
- **Shift+Tab:** Die Runtime belegt die Taste standardmäßig mit
  `app.thinking.cycle`; `keybindings.json` legt diese Aktion auf Super+T. Die
  Umbelegung ist Voraussetzung dafür, dass die Taste frei ist, und wird durch
  `tests/suites/runtime/shortcuts.mjs` geprüft.
