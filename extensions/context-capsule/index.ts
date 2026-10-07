/**
 * Keeps a bounded, turn-local work note across successful compaction only.
 * The capsule is never written to a project file and carries no authority over
 * current workflow, permissions, recovery, or workspace state.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { relative, resolve, sep } from "node:path";
import {
  CAPSULE_MAX_BYTES,
  createContextCapsule,
  fieldsPresent,
  formatContextCapsule,
  serializeContextCapsule,
  type ContextCapsule,
} from "./capsule.ts";

interface CapsuleTelemetry {
  schemaVersion: 1;
  event: "context-capsule";
  phase: "captured" | "restored" | "discarded";
  serializedBytes: number;
  fieldsPresent: string[];
  sessionGeneration: number;
  turnGeneration: number;
}

interface ActiveTurn {
  objective: string;
  changedFiles: Set<string>;
  lastSuccessfulCheck?: string;
  sessionGeneration: number;
  turnGeneration: number;
}

interface PendingCapsule {
  capsule: ContextCapsule;
  serializedBytes: number;
  sessionGeneration: number;
  turnGeneration: number;
}

function telemetry(
  phase: CapsuleTelemetry["phase"],
  pending: PendingCapsule,
): CapsuleTelemetry {
  return {
    schemaVersion: 1,
    event: "context-capsule",
    phase,
    serializedBytes: pending.serializedBytes,
    fieldsPresent: fieldsPresent(pending.capsule),
    sessionGeneration: pending.sessionGeneration,
    turnGeneration: pending.turnGeneration,
  };
}

function workspacePath(value: unknown, cwd: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const absolute = resolve(cwd, value);
  const path = relative(cwd, absolute);
  if (!path || path === ".." || path.startsWith(`..${sep}`)) return undefined;
  return path.split(sep).join("/").slice(0, 180);
}

function objectiveFromPrompt(prompt: unknown): string | undefined {
  if (typeof prompt !== "string") return undefined;
  const bounded = prompt.slice(0, 4096).replace(/\s+/g, " ").trim();
  return createContextCapsule({ objective: bounded }).objective;
}

export default function contextCapsule(pi: ExtensionAPI): void {
  let sessionGeneration = 0;
  let turnGeneration = 0;
  let activeTurn: ActiveTurn | undefined;
  let pending: PendingCapsule | undefined;

  function discardPending(): void {
    const current = pending;
    pending = undefined;
    if (current) pi.appendEntry("context-capsule.telemetry", telemetry("discarded", current));
  }

  pi.on("session_start", () => {
    discardPending();
    sessionGeneration += 1;
    turnGeneration += 1;
    activeTurn = undefined;
    pending = undefined;
  });

  pi.on("before_agent_start", (event) => {
    discardPending();
    turnGeneration += 1;
    const objective = objectiveFromPrompt(event.prompt);
    activeTurn = objective
      ? {
          objective,
          changedFiles: new Set(),
          sessionGeneration,
          turnGeneration,
        }
      : undefined;
  });

  pi.on("tool_result", (event, ctx: ExtensionContext) => {
    const turn = activeTurn;
    if (
      !turn ||
      turn.sessionGeneration !== sessionGeneration ||
      turn.turnGeneration !== turnGeneration ||
      event.isError
    ) return;

    const input = event.input as Record<string, unknown> | undefined;
    if (event.toolName === "edit" || event.toolName === "write") {
      const path = workspacePath(input?.path ?? input?.filePath, ctx.cwd);
      if (path && turn.changedFiles.size < 12) turn.changedFiles.add(path);
      return;
    }
    if (event.toolName === "project_check") {
      const profile = typeof input?.profile === "string" ? input.profile : "requested profiles";
      turn.lastSuccessfulCheck = `project_check (${profile.slice(0, 180)}) completed`;
    }
  });

  pi.on("session_before_compact", () => {
    const turn = activeTurn;
    if (
      !turn ||
      turn.sessionGeneration !== sessionGeneration ||
      turn.turnGeneration !== turnGeneration
    ) return;

    const capsule = createContextCapsule({
      objective: turn.objective,
      changedFiles: [...turn.changedFiles],
      lastSuccessfulCheck: turn.lastSuccessfulCheck,
    });
    const serializedBytes = Buffer.byteLength(serializeContextCapsule(capsule), "utf8");
    if (serializedBytes > CAPSULE_MAX_BYTES) return;

    const snapshot: PendingCapsule = {
      capsule,
      serializedBytes,
      sessionGeneration,
      turnGeneration,
    };
    discardPending();
    pending = snapshot;
    pi.appendEntry("context-capsule.telemetry", telemetry("captured", snapshot));
  });

  pi.on("session_compact", () => {
    const snapshot = pending;
    if (!snapshot) return;
    pending = undefined;
    if (
      snapshot.sessionGeneration !== sessionGeneration ||
      snapshot.turnGeneration !== turnGeneration
    ) {
      pi.appendEntry("context-capsule.telemetry", telemetry("discarded", snapshot));
      return;
    }
    try {
      pi.sendMessage(
        {
          customType: "pi-context-capsule-resume",
          content: formatContextCapsule(snapshot.capsule),
          display: false,
        },
        { deliverAs: "steer" },
      );
      pi.appendEntry("context-capsule.telemetry", telemetry("restored", snapshot));
    } catch {
      pi.appendEntry("context-capsule.telemetry", telemetry("discarded", snapshot));
    }
  });

  type SessionCompactFailedEvent = {
    type: "session_compact_failed";
    reason: "manual" | "threshold" | "overflow";
    errorMessage: string;
    willRetry: boolean;
  };
  (
    pi.on as unknown as (
      event: "session_compact_failed",
      handler: (event: SessionCompactFailedEvent, ctx: ExtensionContext) => void,
    ) => void
  )("session_compact_failed", () => discardPending());

  pi.on("agent_end", () => {
    discardPending();
    activeTurn = undefined;
  });

  pi.on("session_shutdown", () => {
    discardPending();
    sessionGeneration += 1;
    turnGeneration += 1;
    activeTurn = undefined;
    pending = undefined;
  });
}
