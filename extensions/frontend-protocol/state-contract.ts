/**
 * Versionierter Zustandsvertrag zwischen dem Pi-Core (Runtime und fachliche
 * Extensions) und beliebigen Frontends (Aurora-TUI heute, Desktop-GUI später).
 *
 * Dieses Modul gehört zu keiner Präsentationsschicht: Aurora ist Konsument
 * wie jedes andere Frontend und keine Datenquelle. Die fachlichen Extensions
 * (plan-mode, setup-core, diff-viewer, permissions, lsp) und die Runtime
 * bleiben die alleinigen Wahrheitsquellen.
 *
 * Transport: dieselben EventBus-Kanäle, die die fachlichen Extensions bereits
 * bedienen. Die Kanalnamen sind bewusst stabil ("aurora-ui/state/*"), damit
 * bestehende Provider unverändert weiterlaufen; die semantische Bedeutung ist
 * über PROTOCOL_VERSION versioniert.
 */
import type { WorkflowMode } from "../shared/workflow-mode.ts";

export const PROTOCOL_VERSION = "1.1.0";

export const FRONTEND_STATE_CHANNELS = {
  request: "aurora-ui/state/request",
  patch: "aurora-ui/state/patch",
  snapshot: "aurora-ui/state/snapshot",
} as const;

/** Presentation mirror of the selected workflow mode. */
export type FrontendWorkflowPhase = WorkflowMode;

export type FrontendActivityKind = "idle" | "thinking" | "tool" | "responding";

export interface FrontendTaskChanges {
  filesCount: number;
  files: string[];
  linesAdded: number;
  linesRemoved: number;
}

export interface FrontendVerificationSummary {
  status?: string;
  declaredRequiredIds: string[];
  requiredOutcomes: Record<string, string>;
  blockingRecommendedIds: string[];
}

export interface FrontendSubagentBranch {
  agent: string;
  role: string;
  runId: string;
  status: "running" | "paused" | "needs_attention" | "queued";
  focus?: string;
  progress?: string;
}

export interface FrontendTask {
  title: string;
  phaseLabel: string;
}

/**
 * A plan that finished a planning turn and is now waiting for a decision.
 *
 * Every frontend needs this to offer the same three choices (execute, keep
 * planning, switch to work without executing). `hash` is what an approval is
 * bound to, so a frontend can tell that the plan it displayed is still the plan
 * it is approving.
 */
export interface FrontendPlanReadiness {
  hash: string;
  mode: FrontendWorkflowPhase;
  qualityOk: boolean;
}

export interface FrontendUiState {
  sessionEpoch: string;
  workflow: {
    phase: FrontendWorkflowPhase;
    label: string;
    /** Selected during a running turn; in force only after it settles. */
    pending?: FrontendWorkflowPhase;
    planReady?: FrontendPlanReadiness | null;
  };
  permissions: {
    level?: string;
    label?: string;
  };
  lsp: {
    state?: string;
    detail?: string;
  };
  model: {
    id?: string;
    thinking?: string;
  };
  activity: {
    kind: FrontendActivityKind;
  };
  changes: FrontendTaskChanges | null;
  verification: FrontendVerificationSummary | null;
  task: FrontendTask;
  subagents: FrontendSubagentBranch[];
}

export interface FrontendUiStatePatch {
  workflow?: Partial<FrontendUiState["workflow"]>;
  permissions?: Partial<FrontendUiState["permissions"]>;
  lsp?: Partial<FrontendUiState["lsp"]>;
  model?: Partial<FrontendUiState["model"]>;
  activity?: Partial<FrontendUiState["activity"]>;
  changes?: FrontendTaskChanges | null;
  verification?: FrontendVerificationSummary | null;
  task?: FrontendTask;
  subagents?: FrontendSubagentBranch[];
}

export interface FrontendUiStateRequest {
  type: "request";
  requestId: string;
  sessionEpoch: string;
  requester: string;
}

export interface FrontendUiPatchEvent {
  type: "patch";
  sessionEpoch: string;
  source: string;
  patch: FrontendUiStatePatch;
}

export interface FrontendUiSnapshotEvent {
  type: "snapshot";
  requestId: string;
  sessionEpoch: string;
  source: string;
  state: FrontendUiStatePatch;
}

/** Erlaubte Besitzer. Kein Eintrag zeigt auf eine Präsentationsschicht. */
export const STATE_FIELD_OWNERS = [
  "runtime",
  "extension:plan-mode",
  "extension:setup-core",
  "extension:diff-viewer",
  "extension:lsp",
  "extension:mode-permissions",
  "package:pi-subagents",
  "derived-from-core-signals",
] as const;

export type StateFieldOwner = (typeof STATE_FIELD_OWNERS)[number];

export type StateTransport = "rpc" | "bus" | "bus-events";

/**
 * Das Pflichtfeldschema aus dem GUI-Arbeitsauftrag (Phase 2): zwölf
 * Kernfelder mit ihrem Core-Besitzer und ihrem Transport. "task" und
 * "activity" sind Projektionen aus echten Core-Signalen (Tool-Ereignisse,
 * Verification-Urteile, letzte Nutzereingabe) — sie dürfen nie aus UI-Text
 * erraten werden.
 */
export const FRONTEND_STATE_FIELDS = {
  session: { owner: "runtime", transport: "rpc" },
  workflow: { owner: "extension:plan-mode", transport: "bus" },
  task: { owner: "derived-from-core-signals", transport: "bus-events" },
  activity: { owner: "derived-from-core-signals", transport: "bus-events" },
  changes: { owner: "extension:diff-viewer", transport: "bus" },
  verification: { owner: "extension:setup-core", transport: "bus" },
  subagents: { owner: "package:pi-subagents", transport: "bus-events" },
  model: { owner: "runtime", transport: "rpc" },
  thinking: { owner: "runtime", transport: "rpc" },
  permissions: { owner: "extension:mode-permissions", transport: "bus" },
  context: { owner: "runtime", transport: "rpc" },
  lsp: { owner: "extension:lsp", transport: "bus" },
} as const satisfies Record<
  string,
  { owner: StateFieldOwner; transport: StateTransport }
>;

export type FrontendStateFieldName = keyof typeof FRONTEND_STATE_FIELDS;
