/** Session-bound handoff from Pi's agent_end event to agent_settled. */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface SettledWorkflowRun {
  epoch: number;
  sessionId: string;
  messages: AgentMessage[];
}

export class WorkflowSettlementCoordinator {
  #pending: SettledWorkflowRun | undefined;

  capture(run: SettledWorkflowRun): void {
    this.#pending = run;
  }

  takeCurrent(
    epoch: number,
    activeSessionId: string | undefined,
    sessionId: string,
  ): SettledWorkflowRun | undefined {
    const pending = this.#pending;
    this.#pending = undefined;
    if (
      !pending ||
      pending.epoch !== epoch ||
      pending.sessionId !== activeSessionId ||
      pending.sessionId !== sessionId
    ) {
      return undefined;
    }
    return pending;
  }

  clear(): void {
    this.#pending = undefined;
  }
}
