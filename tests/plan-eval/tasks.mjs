/**
 * The evaluation corpus: eight realistic planning tasks.
 *
 * These exist because the mechanical checks in `plan-quality.ts` can only tell
 * whether a plan has the right shape. Whether a plan is any *good* — does it
 * touch the right files, does it invent work that nobody asked for, does it
 * say how anyone would know it worked — is not decidable from the text alone,
 * so it is measured here against tasks whose right answers are known.
 *
 * Each task names the mode it should be planned in, the facts a competent plan
 * has to reach (`expectedSurface`), things a plan should *not* drag in
 * (`forbiddenSurface`), and the judgement questions a human or a model reviewer
 * answers separately. Nothing here calls a provider: the corpus and the
 * mechanical scoring are the deliverable, and a live run is a separate step.
 */

export const EVAL_TASKS = [
  {
    id: "known-small-change",
    kind: "bekannte kleine Änderung",
    mode: "simple_plan",
    prompt:
      "Der Statusbalken zeigt den Workflow-Modus ohne den vorgemerkten Moduswechsel an. Ergänze ihn.",
    expectedSurface: ["extensions/plan-mode/presentation.ts"],
    forbiddenSurface: ["extensions/permissions/", "gui/"],
    /** A quick plan for a one-file change must not grow phases. */
    expectPhases: false,
    notes:
      "Prüft, ob der Schnellplan klein bleibt und die richtige Datei benennt.",
  },
  {
    id: "unknown-bug",
    kind: "unbekannter Bug",
    mode: "simple_plan",
    prompt:
      "In manchen Terminals läuft die Vordergrundfarbe einer gekürzten Kachelzeile über die Ellipse hinaus. Finde die Ursache und plane den Fix.",
    expectedSurface: ["extensions/aurora-ui/layout.ts"],
    forbiddenSurface: ["extensions/plan-mode/"],
    expectPhases: false,
    notes:
      "Der Plan muss eine Reproduktionsbedingung nennen (Farbtiefe), nicht nur 'Bug beheben'.",
  },
  {
    id: "multi-file-feature",
    kind: "Multi-Datei-Feature",
    mode: "detailed_plan",
    prompt:
      "Führe eine ausdrückliche Planfreigabe ein: Ein Plan darf erst nach einer eindeutigen Nutzeraktion umgesetzt werden.",
    expectedSurface: [
      "extensions/plan-mode/session.ts",
      "extensions/plan-mode/commands.ts",
      "extensions/plan-mode/events.ts",
    ],
    forbiddenSurface: ["extensions/lsp/"],
    expectPhases: true,
    notes: "Mehrere Dateien, echte Reihenfolge, Abschlusskriterien je Phase.",
  },
  {
    id: "architecture-change",
    kind: "Architekturänderung",
    mode: "detailed_plan",
    prompt:
      "Die Planablage ist global pro Repository. Stelle sie auf eine sitzungsbezogene Ablage um.",
    expectedSurface: [
      "extensions/plan-mode/plan-store.ts",
      "extensions/permissions/workflow-policy.ts",
    ],
    forbiddenSurface: ["themes/"],
    expectPhases: true,
    notes:
      "Muss Migration/Rückfall und die Wechselwirkung mit der Schreibgrenze benennen.",
  },
  {
    id: "security-permission",
    kind: "Security-/Permission-Aufgabe",
    mode: "detailed_plan",
    prompt:
      "Die Permission-Schicht fällt auf 'work' zurück, wenn keine Workflow-Extension antwortet. Mache das fail-closed.",
    expectedSurface: [
      "extensions/shared/workflow-capabilities.ts",
      "extensions/permissions/guards.ts",
    ],
    forbiddenSurface: ["gui/renderer/"],
    expectPhases: true,
    notes:
      "Muss die Regressionsgefahr benennen: fail-closed kann legitime Arbeit blockieren.",
  },
  {
    id: "migration",
    kind: "Migration",
    mode: "detailed_plan",
    prompt:
      "Bestehende .agent/plans/current-plan.md-Dateien müssen weiter lesbar sein, dürfen aber nie automatisch ausgeführt werden.",
    expectedSurface: ["extensions/plan-mode/plan-store.ts"],
    forbiddenSurface: ["extensions/setup-core/"],
    expectPhases: true,
    notes: "Migrationspfad und ausdrücklicher Nicht-Ziel-Abschnitt sind Pflicht.",
  },
  {
    id: "cross-surface",
    kind: "Contract-/Frontend-Aufgabe",
    mode: "detailed_plan",
    prompt:
      "TUI und GUI müssen dieselbe Planentscheidung anbieten. Plane die Vertragsänderung.",
    expectedSurface: [
      "extensions/frontend-protocol/state-contract.ts",
      "extensions/frontend-protocol/commands.ts",
    ],
    forbiddenSurface: ["extensions/resilience/"],
    expectPhases: true,
    notes: "Versionierung des Protokolls muss vorkommen.",
  },
  {
    id: "plan-mode-unnecessary",
    kind: "ungeeignete Aufgabe",
    mode: "simple_plan",
    prompt: "Korrigiere den Tippfehler 'Verifikaton' in der README.",
    expectedSurface: [],
    forbiddenSurface: [],
    expectPhases: false,
    /**
     * The interesting outcome here is a plan that says the plan mode is not
     * needed. A multi-phase architecture plan for a typo is a failure, not
     * thoroughness.
     */
    expectMinimal: true,
    notes:
      "Belohnt wird ein Plan, der die eigene Überflüssigkeit benennt und klein bleibt.",
  },
];
