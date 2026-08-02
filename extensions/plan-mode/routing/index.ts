/**
 * Routing barrel and orchestration.
 *
 * computeRouting is the only entry a controller needs: it runs the pure
 * assessment → decision → profile pipeline, attaches the resolved profile
 * labels and returns a deeply frozen RoutingDecision. No WorkflowStatus, no
 * persistence — the result is held in memory on WorkflowSession by the caller.
 */
import { assessRouting } from "./assess.ts";
import { decideRouting } from "./decide.ts";
import { resolveProfiles } from "./profiles.ts";
import type {
  RoutingDecision,
  RoutingInput,
  RoutingProfilesConfig,
} from "./types.ts";

export type {
  RoutingAssessment,
  RoutingCoreDecision,
  RoutingDecision,
  RoutingEvidence,
  RoutingInput,
  RoutingLevel,
  RoutingProfileConfig,
  RoutingProfilesConfig,
  RoutingReportMetrics,
} from "./types.ts";
export { ROUTING_LEVELS, isRoutingLevel } from "./types.ts";
export { assessRouting } from "./assess.ts";
export { decideRouting } from "./decide.ts";
export { DEFAULT_ROUTING_PROFILES, resolveProfiles } from "./profiles.ts";
export { formatRoutingSummary } from "./format.ts";

function deepFreezeDecision(decision: RoutingDecision): RoutingDecision {
  Object.freeze(decision.evidence.complexity);
  Object.freeze(decision.evidence.risk);
  Object.freeze(decision.evidence.uncertainty);
  Object.freeze(decision.evidence.hardHighReasons);
  Object.freeze(decision.evidence);
  return Object.freeze(decision);
}

export function computeRouting(
  input: RoutingInput,
  config: RoutingProfilesConfig | undefined,
): RoutingDecision {
  const assessment = assessRouting(input);
  const core = decideRouting(input, assessment);
  const profiles = resolveProfiles(core.level, config);
  return deepFreezeDecision({
    ...core,
    plannerProfile: profiles.planner,
    workerProfile: profiles.worker,
    reviewerProfile: profiles.reviewer,
  });
}
