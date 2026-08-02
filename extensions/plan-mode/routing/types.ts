/**
 * Routing types.
 *
 * Deliberately free of file system access, execution, formatting and state
 * mutation — like completion/types.ts. Routing is a pure assessment of
 * Komplexität, Risiko and Unsicherheit into a `RoutingLevel`, from which the
 * only enforced effect is phase steering (plannerRequired/reviewerRequired)
 * plus a profile recommendation. No model names live here, no new
 * `WorkflowStatus` is introduced, and a RoutingDecision is never persisted: it
 * rides on `WorkflowSession` in memory only.
 *
 * Reviewpflicht/Planungsbedarf are derived from the decision (decide.ts), never
 * from a profile, so a missing or invalid profile can never silently drop a
 * required review.
 */
export type RoutingLevel = "low" | "standard" | "high";

export const ROUTING_LEVELS: readonly RoutingLevel[] = [
  "low",
  "standard",
  "high",
];

export function isRoutingLevel(value: unknown): value is RoutingLevel {
  return (
    typeof value === "string" &&
    (ROUTING_LEVELS as readonly string[]).includes(value)
  );
}

export interface RoutingEvidence {
  complexity: string[];
  risk: string[];
  uncertainty: string[];
  /** Non-empty list forces HIGH regardless of the score (harte HIGH-Regeln). */
  hardHighReasons: string[];
}

/**
 * Fachliche Entscheidung ohne Profil-Bezeichner. decide.ts erzeugt sie aus der
 * Bewertung; computeRouting fügt die aufgelösten Profil-Bezeichner hinzu und
 * friert das Ergebnis zur unveränderlichen RoutingDecision ein.
 */
export interface RoutingCoreDecision {
  level: RoutingLevel;
  evidence: RoutingEvidence;
  plannerRequired: boolean;
  reviewerRequired: boolean;
  manuallyEscalated: boolean;
  /**
   * Set (non-empty) when a manual downgrade was refused because a hard HIGH rule
   * applies. Pure payload — the caller surfaces it, the decision stays HIGH.
   */
  downgradeBlocked?: string;
}

export interface RoutingDecision extends RoutingCoreDecision {
  plannerProfile?: string;
  workerProfile: string;
  reviewerProfile?: string;
}

/** Ergebnis der reinen Signalerfassung: Evidence-Strings plus Roh-Score. */
export interface RoutingAssessment {
  evidence: RoutingEvidence;
  score: number;
}

/** Neutral routing metrics attached to the completion report (no evidence). */
export interface RoutingReportMetrics {
  level: RoutingLevel;
  workerProfile: string;
  plannerProfile?: string;
  reviewerProfile?: string;
  manuallyEscalated: boolean;
}

/** Pure inputs to the assessment: signals only, no model names, no state. */
export interface RoutingInput {
  /** Free-form task description (Direct Task args, plan goal, …). */
  taskText: string;
  /** Project-relative scope paths/globs from the plan's „Technischer Scope". */
  scopePaths: string[];
  /** Affected areas / module hints from the plan or task. */
  affectedAreas: string[];
  /** Selected planning mode, when a plan is used as input. */
  planType?: "simple_plan" | "detailed_plan";
  /** Declared verification profile ids / commands available. */
  verification: string[];
  /** Optional manual override level requested by the user. */
  manualLevel?: RoutingLevel;
}

/**
 * Profil-Bezeichner je Rolle. Rein Bezeichner (Strings) — die Abbildung auf
 * konkrete Modelle aus settings.enabledModels bleibt Pi-nativ und global; hier
 * steht bewusst kein Modellname und kein reviewRequired.
 */
export interface RoutingProfileConfig {
  planner?: string;
  worker: string;
  reviewer?: string;
}

/** Konfigurierte Profil-Bezeichner je Routing-Stufe. */
export interface RoutingProfilesConfig {
  levels: Record<RoutingLevel, RoutingProfileConfig>;
}
