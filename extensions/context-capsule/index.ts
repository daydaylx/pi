/**
 * Keeps a bounded session work note across short continuations and successful
 * compaction. It is never written to a project file and carries no authority
 * over current workflow, permissions, recovery, or workspace state.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { relative, resolve, sep } from "node:path";
import {
  CAPSULE_MAX_BYTES,
  createContextCapsule,
  extractAcceptanceCriteria,
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

interface ActiveWork {
  objective: string;
  acceptanceCriteria?: string[];
  changedFiles: Set<string>;
  lastSuccessfulCheck?: string;
  sessionGeneration: number;
}

interface ActiveTurn {
  sessionGeneration: number;
  turnGeneration: number;
}

interface PendingCapsule {
  capsule: ContextCapsule;
  serializedBytes: number;
  sessionGeneration: number;
  turnGeneration: number;
}

const CONTINUATION_PROMPTS = [
  /^(?:(?:bitte|dann|jetzt|okay|ok)\s+)*(?:weiter(?:\s+mit\s+(?:den\s+)?(?:offenen\s+)?(?:punkten|schritten|aufgaben))?|mach(?:e)?\s+(?:bitte\s+)?weiter|mach\s+(?:das|es)(?:\s+bitte)?|fortsetzen|fortfahren|versuch(?:e)?\s+(?:es\s+)?(?:jetzt\s+)?(?:noch\s+einmal|erneut)|noch\s+einmal\s+versuchen|nochmal|continue(?:\s+with\s+the\s+remaining\s+(?:items|steps))?|try\s+again)[.!?…]*$/i,
  /^(?:(?:dann|bitte|jetzt)\s+)*(?:übernimm(?:e)?|übernehm(?:en)?)\s+(?:das|es)(?:\s+bitte)?[.!?…]*$/i,
  /^kannst\s+du\s+(?:bitte\s+)?(?:das|es)\s+übernehmen[.!?…]*$/i,
  /^(?:(?:bitte|dann|jetzt)\s+)*(?:die\s+)?(?:aktuelle\s+)?sitzung\s+(?:neu\s+starten|neustarten)(?:\s+(?:von\s+)?pisystem)?[.!?…]*$/i,
];

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

function isContinuationPrompt(prompt: unknown): boolean {
  if (typeof prompt !== "string") return false;
  const normalized = prompt
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("de-DE");
  if (!normalized || normalized.length > 180) return false;
  return CONTINUATION_PROMPTS.some((pattern) => pattern.test(normalized));
}

function capsuleForWork(work: ActiveWork): ContextCapsule {
  return createContextCapsule({
    objective: work.objective,
    acceptanceCriteria: work.acceptanceCriteria,
    changedFiles: [...work.changedFiles],
    lastSuccessfulCheck: work.lastSuccessfulCheck,
    nextAction: work.acceptanceCriteria?.length
      ? "Continue the original request. Work on the first unmet acceptance criterion; verify each actual outcome before reporting completion."
      : "Continue unfinished parts of the original request; verify their actual outcomes before reporting completion.",
  });
}

export default function contextCapsule(pi: ExtensionAPI): void {
  let sessionGeneration = 0;
  let turnGeneration = 0;
  let activeWork: ActiveWork | undefined;
  let activeTurn: ActiveTurn | undefined;
  let pending: PendingCapsule | undefined;

  function discardPending(): void {
    const current = pending;
    pending = undefined;
    if (current)
      pi.appendEntry(
        "context-capsule.telemetry",
        telemetry("discarded", current),
      );
  }

  pi.on("session_start", () => {
    discardPending();
    sessionGeneration += 1;
    turnGeneration += 1;
    activeWork = undefined;
    activeTurn = undefined;
    pending = undefined;
  });

  pi.on("before_agent_start", (event) => {
    // Only a user prompt defines a new objective; extension-triggered runs
    // continue the current turn state untouched.
    if (event.messageType === "custom") return;
    discardPending();
    turnGeneration += 1;
    const continuation =
      isContinuationPrompt(event.prompt) &&
      activeWork?.sessionGeneration === sessionGeneration;
    if (continuation && activeWork) {
      activeTurn = { sessionGeneration, turnGeneration };
      return {
        systemPrompt: formatContextCapsule(capsuleForWork(activeWork)),
      };
    }

    const objective = objectiveFromPrompt(event.prompt);
    activeWork = objective
      ? {
          objective,
          acceptanceCriteria: extractAcceptanceCriteria(event.prompt),
          changedFiles: new Set(),
          sessionGeneration,
        }
      : undefined;
    activeTurn = activeWork ? { sessionGeneration, turnGeneration } : undefined;
  });

  pi.on("tool_result", (event, ctx: ExtensionContext) => {
    const turn = activeTurn;
    const work = activeWork;
    if (
      !turn ||
      !work ||
      turn.sessionGeneration !== sessionGeneration ||
      work.sessionGeneration !== sessionGeneration ||
      turn.turnGeneration !== turnGeneration ||
      event.isError
    )
      return;

    const input = event.input as Record<string, unknown> | undefined;
    if (event.toolName === "edit" || event.toolName === "write") {
      const path = workspacePath(input?.path ?? input?.filePath, ctx.cwd);
      if (path && work.changedFiles.size < 12) work.changedFiles.add(path);
      return;
    }
    if (event.toolName === "project_check") {
      const profile =
        typeof input?.profile === "string"
          ? input.profile
          : "requested profiles";
      work.lastSuccessfulCheck = `project_check (${profile.slice(0, 180)}) completed`;
    }
  });

  pi.on("session_before_compact", () => {
    const turn = activeTurn;
    const work = activeWork;
    if (
      !turn ||
      !work ||
      turn.sessionGeneration !== sessionGeneration ||
      turn.turnGeneration !== turnGeneration ||
      work.sessionGeneration !== sessionGeneration
    )
      return;

    const capsule = capsuleForWork(work);
    const serializedBytes = Buffer.byteLength(
      serializeContextCapsule(capsule),
      "utf8",
    );
    if (serializedBytes > CAPSULE_MAX_BYTES) return;

    const snapshot: PendingCapsule = {
      capsule,
      serializedBytes,
      sessionGeneration,
      turnGeneration,
    };
    discardPending();
    pending = snapshot;
    pi.appendEntry(
      "context-capsule.telemetry",
      telemetry("captured", snapshot),
    );
  });

  pi.on("session_compact", () => {
    const snapshot = pending;
    if (!snapshot) return;
    pending = undefined;
    if (
      snapshot.sessionGeneration !== sessionGeneration ||
      snapshot.turnGeneration !== turnGeneration
    ) {
      pi.appendEntry(
        "context-capsule.telemetry",
        telemetry("discarded", snapshot),
      );
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
      pi.appendEntry(
        "context-capsule.telemetry",
        telemetry("restored", snapshot),
      );
    } catch {
      pi.appendEntry(
        "context-capsule.telemetry",
        telemetry("discarded", snapshot),
      );
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
      handler: (
        event: SessionCompactFailedEvent,
        ctx: ExtensionContext,
      ) => void,
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
    activeWork = undefined;
    activeTurn = undefined;
    pending = undefined;
  });
}
