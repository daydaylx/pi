import Type from "typebox";
import Schema from "typebox/schema";
import type { RequestMethod } from "./constants.js";

const Strict = { additionalProperties: false } as const;
const OptionalString = Type.Optional(Type.String());
const Empty = Type.Object({}, Strict);

const CurrentSession = Type.Object(
  {
    id: OptionalString,
    name: OptionalString,
    connected: Type.Boolean(),
    model: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Object({ provider: Type.String(), id: Type.String() }, Strict),
      ]),
    ),
    thinkingLevel: OptionalString,
    isStreaming: Type.Boolean(),
    messageCount: Type.Integer({ minimum: 0 }),
  },
  Strict,
);

const SessionSummary = Type.Object(
  {
    id: Type.String(),
    name: OptionalString,
    cwd: Type.String(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    messageCount: Type.Integer({ minimum: 0 }),
    firstMessage: Type.String(),
    archived: Type.Optional(Type.Literal(true)),
  },
  Strict,
);

export const MessageBlockSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal("text"),
      Type.Literal("thinking"),
      Type.Literal("tool_call"),
      Type.Literal("tool_result"),
      Type.Literal("image"),
      Type.Literal("unknown"),
    ]),
    text: OptionalString,
    toolCallId: OptionalString,
    toolName: OptionalString,
    isError: Type.Optional(Type.Boolean()),
  },
  Strict,
);

export const PublicMessageSchema = Type.Object(
  {
    id: OptionalString,
    parentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    timestamp: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    role: Type.String(),
    blocks: Type.Array(MessageBlockSchema),
  },
  Strict,
);

const SessionStats = Type.Object(
  {
    sessionId: Type.String(),
    userMessages: Type.Integer({ minimum: 0 }),
    assistantMessages: Type.Integer({ minimum: 0 }),
    toolCalls: Type.Integer({ minimum: 0 }),
    toolResults: Type.Integer({ minimum: 0 }),
    totalMessages: Type.Integer({ minimum: 0 }),
    tokens: Type.Object(
      {
        input: Type.Number({ minimum: 0 }),
        output: Type.Number({ minimum: 0 }),
        cacheRead: Type.Number({ minimum: 0 }),
        cacheWrite: Type.Number({ minimum: 0 }),
        total: Type.Number({ minimum: 0 }),
      },
      Strict,
    ),
    cost: Type.Number({ minimum: 0 }),
    contextUsage: Type.Optional(
      Type.Object(
        {
          tokens: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
          contextWindow: Type.Number({ minimum: 1 }),
          percent: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        },
        Strict,
      ),
    ),
  },
  Strict,
);

const Model = Type.Object(
  {
    provider: Type.String(),
    id: Type.String(),
    name: OptionalString,
    contextWindow: Type.Optional(Type.Number({ minimum: 1 })),
    reasoning: Type.Optional(Type.Boolean()),
  },
  Strict,
);

const PermissionEntry = Type.Object(
  {
    level: Type.String({ minLength: 1 }),
    settable: Type.Boolean(),
  },
  Strict,
);

export const RunStateSchema = Type.Union([
  Type.Literal("ACCEPTED"),
  Type.Literal("INVESTIGATING"),
  Type.Literal("EXECUTING"),
  Type.Literal("VERIFYING"),
  Type.Literal("WAITING_INPUT"),
  Type.Literal("CANCELLING"),
  Type.Literal("UNCERTAIN"),
  Type.Literal("RECONCILING"),
  Type.Literal("RESUMABLE"),
  Type.Literal("SUCCEEDED"),
  Type.Literal("FAILED"),
  Type.Literal("BLOCKED"),
  Type.Literal("CANCELLED"),
]);

export const RunActionSchema = Type.Object(
  {
    actionId: Type.String({ minLength: 1 }),
    toolCallId: Type.String({ minLength: 1 }),
    toolName: Type.String({ minLength: 1 }),
    mutating: Type.Boolean(),
    startedAt: Type.String({ minLength: 1 }),
    finishedAt: OptionalString,
    effectState: Type.Union([
      Type.Literal("intended"),
      Type.Literal("executing"),
      Type.Literal("applied"),
      Type.Literal("not_applied"),
      Type.Literal("failed"),
      Type.Literal("unknown"),
    ]),
    reconcileNote: OptionalString,
  },
  Strict,
);

export const RunVerificationSchema = Type.Object(
  {
    checkId: Type.String({ minLength: 1 }),
    status: Type.Union([
      Type.Literal("passed"),
      Type.Literal("failed"),
      Type.Literal("pending"),
    ]),
    summary: Type.String({ minLength: 1 }),
    recordedAt: Type.String({ minLength: 1 }),
    evidenceRef: OptionalString,
  },
  Strict,
);

export const RunResultSchema = Type.Object(
  {
    outcome: Type.Union([
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("blocked"),
      Type.Literal("cancelled"),
      Type.Literal("uncertain"),
    ]),
    partial: Type.Boolean(),
    errorCode: OptionalString,
    message: Type.String(),
    cancelScope: Type.Optional(
      Type.Union([
        Type.Literal("queued_removed"),
        Type.Literal("turn_and_tools_stopped"),
        Type.Literal("turn_aborted_external_effect_uncertain"),
      ]),
    ),
    verificationRefs: Type.Array(Type.String()),
  },
  Strict,
);

export const RunRollbackSchema = Type.Object(
  {
    available: Type.Boolean(),
    strategy: Type.Union([Type.String(), Type.Null()]),
    ref: Type.Union([Type.String(), Type.Null()]),
    status: Type.String({ minLength: 1 }),
  },
  Strict,
);

export const RunSnapshotSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    runId: Type.String({ minLength: 1 }),
    sessionId: Type.String({ minLength: 1 }),
    clientSubmissionId: OptionalString,
    title: Type.String({ minLength: 1 }),
    goal: Type.String({ minLength: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    hostEpoch: Type.String({ minLength: 1 }),
    state: RunStateSchema,
    stateReason: Type.String({ minLength: 1 }),
    lastStep: Type.String({ minLength: 1 }),
    queued: Type.Boolean(),
    requireVerification: Type.Boolean(),
    source_of_truth: Type.Array(Type.String()),
    actions: Type.Array(RunActionSchema),
    observations: Type.Array(Type.String()),
    verification: Type.Array(RunVerificationSchema),
    rollback: RunRollbackSchema,
    remaining_issues: Type.Array(Type.String()),
    result: Type.Union([RunResultSchema, Type.Null()]),
  },
  Strict,
);

export const RunSummarySchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }),
    sessionId: Type.String({ minLength: 1 }),
    clientSubmissionId: OptionalString,
    title: Type.String({ minLength: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    state: RunStateSchema,
    stateReason: Type.String({ minLength: 1 }),
    lastStep: Type.String({ minLength: 1 }),
    queued: Type.Boolean(),
  },
  Strict,
);

export const RunEventEntrySchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 1 }),
    timestamp: Type.String({ minLength: 1 }),
    event: Type.String({ minLength: 1 }),
    state: RunStateSchema,
    stateReason: Type.String({ minLength: 1 }),
    lastStep: Type.String({ minLength: 1 }),
  },
  Strict,
);

const CorruptedRunEntrySchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }),
    fileName: Type.String({ minLength: 1 }),
    reason: Type.String({ minLength: 1 }),
    detectedAt: Type.String({ minLength: 1 }),
  },
  Strict,
);

export const REQUEST_RESULT_SCHEMAS = {
  "system.ping": Type.Object(
    {
      pong: Type.Literal(true),
      protocolVersion: Type.Literal(1),
      piVersion: Type.String(),
    },
    Strict,
  ),
  "session.list": Type.Object({ sessions: Type.Array(SessionSummary) }, Strict),
  "session.create": CurrentSession,
  "session.open": CurrentSession,
  "session.rename": Empty,
  "session.archive": Empty,
  "session.delete": Empty,
  "session.current": CurrentSession,
  "session.messages": Type.Object(
    {
      messages: Type.Array(PublicMessageSchema),
      nextCursor: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    },
    Strict,
  ),
  "session.stats": SessionStats,
  "agent.prompt": Empty,
  "agent.steer": Empty,
  "agent.followUp": Empty,
  "agent.abort": Empty,
  "model.list": Type.Object({ models: Type.Array(Model) }, Strict),
  "model.set": Type.Object({ model: Type.Union([Model, Type.Null()]) }, Strict),
  "model.cycle": Type.Object(
    { model: Type.Union([Model, Type.Null()]) },
    Strict,
  ),
  "thinking.list": Type.Object({ levels: Type.Array(Type.String()) }, Strict),
  "thinking.set": Empty,
  "thinking.cycle": Type.Object(
    { level: Type.Optional(Type.Union([Type.String(), Type.Null()])) },
    Strict,
  ),
  "workflow.list": Type.Object({ modes: Type.Array(Type.String()) }, Strict),
  "workflow.set": Empty,
  "permission.list": Type.Object(
    {
      levels: Type.Array(Type.String()),
      entries: Type.Optional(Type.Array(PermissionEntry)),
    },
    Strict,
  ),
  "permission.set": Empty,
  "command.list": Type.Object(
    {
      commands: Type.Array(
        Type.Object(
          {
            name: Type.String(),
            description: OptionalString,
            source: OptionalString,
            location: OptionalString,
          },
          Strict,
        ),
      ),
    },
    Strict,
  ),
  "command.invoke": Empty,
  "verification.run": Empty,
  "changes.list": Type.Object(
    {
      changes: Type.Array(
        Type.Object(
          {
            path: Type.String(),
            additions: Type.Optional(Type.Integer({ minimum: 0 })),
            deletions: Type.Optional(Type.Integer({ minimum: 0 })),
          },
          Strict,
        ),
      ),
    },
    Strict,
  ),
  "configuration.get": Type.Object(
    {
      model: Type.Optional(Type.Union([Model, Type.Null()])),
      thinkingLevel: OptionalString,
    },
    Strict,
  ),
  "ui.respond": Type.Object({ delivered: Type.Literal(true) }, Strict),
  "run.submit": Type.Object(
    {
      run: RunSnapshotSchema,
      deduplicated: Type.Boolean(),
    },
    Strict,
  ),
  "run.current": Type.Object(
    {
      run: Type.Union([RunSnapshotSchema, Type.Null()]),
    },
    Strict,
  ),
  "run.get": Type.Object({ run: RunSnapshotSchema }, Strict),
  "run.list": Type.Object(
    {
      runs: Type.Array(RunSummarySchema),
      nextCursor: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      corrupted: Type.Optional(Type.Array(CorruptedRunEntrySchema)),
    },
    Strict,
  ),
  "run.cancel": Type.Object(
    {
      run: RunSnapshotSchema,
      cancelScope: Type.Union([
        Type.Literal("queued_removed"),
        Type.Literal("turn_abort_requested"),
        Type.Literal("already_terminal"),
      ]),
    },
    Strict,
  ),
  "run.events": Type.Object(
    {
      run: RunSnapshotSchema,
      events: Type.Array(RunEventEntrySchema),
      currentRevision: Type.Integer({ minimum: 1 }),
    },
    Strict,
  ),
  "run.reconcile": Type.Object({ run: RunSnapshotSchema }, Strict),
  "run.resume": Type.Object({ run: RunSnapshotSchema }, Strict),
  "run.verify": Type.Object({ run: RunSnapshotSchema }, Strict),
} as const;

const validators = Object.fromEntries(
  Object.entries(REQUEST_RESULT_SCHEMAS).map(([method, schema]) => [
    method,
    Schema.Compile(schema),
  ]),
) as Record<RequestMethod, ReturnType<typeof Schema.Compile>>;

export function isValidRequestResult(
  method: RequestMethod,
  result: unknown,
): boolean {
  return validators[method].Check(result);
}
