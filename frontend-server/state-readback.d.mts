export type SystemStateGoal =
  | {
      kind: "user-service";
      unit: string;
      operation: "start" | "stop" | "restart";
    }
  | { kind: "focused-window"; address: string }
  | { kind: "workspace"; workspace: number }
  | { kind: "nixos-generation"; expectedSystem: string };

export function normalizeSystemGoal(value: unknown): SystemStateGoal;
export function systemGoalForTool(
  toolName: string,
  args?: Record<string, unknown>,
): SystemStateGoal | undefined;
export function legacyStateGoalEvent<T>(data: T): T;
export function readSystemGoal(value: unknown): {
  passed: boolean;
  observation: {
    activeState?: string;
    invocationId?: string;
    address?: string;
    workspace?: number;
    currentSystem?: string;
  };
  source: string;
};
export function readApplyJob(jobId: string): {
  completed: boolean;
  passed: boolean;
  invocationId: string;
};
export function releaseApplyJob(jobId: string, invocationId: string): boolean;
