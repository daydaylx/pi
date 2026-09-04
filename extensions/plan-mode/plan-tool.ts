/**
 * `plan_write` — the only way the agent can produce a plan.
 *
 * Previously the agent wrote `.agent/plans/current-plan.md` with the ordinary
 * `write` tool, and the permission layer had to punch a hole in the plan-mode
 * write ban for exactly that path. That hole is what tied plans to the user's
 * checkout: `write` is bounded by the hard "stay inside the project" boundary,
 * so a plan could not live anywhere else without weakening that boundary.
 *
 * A dedicated tool owns the path instead. Plan mode's write surface on project
 * files is now empty, and the store can sit outside the worktree without any
 * hard boundary being relaxed. The tool is also the natural place for the two
 * checks that must not be optional: the mode's minimum plan requirements and
 * the size limit.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import { assessPlanQuality, describePlanQuality } from "./plan-quality.ts";
import { MAX_PLAN_BYTES, writePlan } from "./plan-store.ts";
import type { WorkflowSession } from "./session.ts";

export const PLAN_WRITE_TOOL_NAME = "plan_write";

export function registerPlanTool(
  pi: ExtensionAPI,
  session: WorkflowSession,
): void {
  pi.registerTool({
    name: PLAN_WRITE_TOOL_NAME,
    label: "Plan schreiben",
    description:
      "Schreibt oder ersetzt den Plan der aktuellen Sitzung. Nur im Planmodus verfügbar. Der Plan wird in der sitzungseigenen Ablage der Pi-Runtime gespeichert, nicht im Projektverzeichnis, und muss die Mindestanforderungen des aktiven Planmodus erfüllen (Schnellplan bzw. Architekturplan). Ein abgelehnter Plan wird nicht gespeichert; die Begründung nennt jeden fehlenden Abschnitt.",
    promptSnippet:
      "Write or replace this session's plan (plan mode only; content is validated against the active plan mode's requirements).",
    parameters: Type.Object({
      content: Type.String({
        description:
          "Der vollständige Plan als Markdown. Ersetzt einen bestehenden Plan vollständig; es gibt kein teilweises Anhängen.",
      }),
    }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const mode = session.effectiveMode();
      if (!isPlanningMode(mode)) {
        throw new Error(
          "plan_write ist nur im Schnellplan- oder Architekturplan-Modus verfügbar. Der Moduswechsel ist eine Nutzeraktion (Shift+Tab); bitte über ask_user darum bitten.",
        );
      }
      const content = params.content;
      const quality = assessPlanQuality(mode, content);
      if (!quality.ok) throw new Error(describePlanQuality(mode, quality));

      const location = session.location(ctx);
      const result = writePlan(location, content, session.expectedPlanHash());
      if (!result.ok && result.reason === "too-large") {
        throw new Error(
          `Der Plan ist mit ${result.bytes} Byte zu groß (Grenze: ${MAX_PLAN_BYTES} Byte). Kürze ihn auf das, was für die Umsetzung wirklich gebraucht wird.`,
        );
      }
      if (!result.ok) {
        // Someone else changed the plan since this turn last saw it — in
        // practice the operator's own external editor. Overwriting silently
        // would discard their edit, so the agent has to look again.
        throw new Error(
          "Der gespeicherte Plan hat sich seit dem Beginn dieses Turns geändert (vermutlich durch den externen Editor). Der Schreibvorgang wurde abgebrochen, damit keine fremde Änderung verloren geht. Lies den aktuellen Stand erneut und schreibe dann neu.",
        );
      }

      session.recordPlanWrite(result.stored.hash, true);
      const label = mode === "detailed_plan" ? "Architekturplan" : "Schnellplan";
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `${label} gespeichert (${Buffer.byteLength(content, "utf8")} Byte, Hash ${result.stored.hash.slice(0, 12)}).`,
              "Der Plan wird nicht automatisch ausgeführt: Die Nutzerin/der Nutzer entscheidet danach ausdrücklich über die Freigabe.",
            ].join(" "),
          },
        ],
        details: { hash: result.stored.hash, mode },
      };
    },
  });
}
