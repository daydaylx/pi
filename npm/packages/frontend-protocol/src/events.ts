import Type from "typebox";
import Schema from "typebox/schema";
import type { EventName } from "./constants.js";
import { ProtocolErrorSchema } from "./schemas.js";
import { PublicMessageSchema, RunSnapshotSchema } from "./results.js";
import { StatePatchV1Schema, StateSnapshotV1Schema } from "./state-schemas.js";

const Strict = { additionalProperties: false } as const;
const NonEmptyString = Type.String({ minLength: 1 });
const Empty = Type.Object({}, Strict);
const SystemStateGoal = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("user-service"),
      unit: Type.String({
        pattern: "^(?!-)[A-Za-z0-9_.@:-]{1,120}\\.service$",
      }),
      operation: Type.Union([
        Type.Literal("start"),
        Type.Literal("stop"),
        Type.Literal("restart"),
      ]),
    },
    Strict,
  ),
  Type.Object(
    {
      kind: Type.Literal("workspace"),
      workspace: Type.Integer({ minimum: 1, maximum: 99 }),
    },
    Strict,
  ),
  Type.Object(
    {
      kind: Type.Literal("nixos-generation"),
      expectedSystem: Type.String({
        pattern: "^/nix/store/[a-z0-9]{32}-nixos-system-[A-Za-z0-9+._-]+$",
      }),
    },
    Strict,
  ),
]);
const MessageData = Type.Object({ message: PublicMessageSchema }, Strict);
const ToolData = Type.Object(
  {
    toolCallId: NonEmptyString,
    toolName: NonEmptyString,
    targetPath: Type.Optional(NonEmptyString),
    jobAction: Type.Optional(
      Type.Union([
        Type.Literal("status"),
        Type.Literal("output"),
        Type.Literal("stop"),
      ]),
    ),
    systemTarget: Type.Optional(SystemStateGoal),
  },
  Strict,
);
const ToolEndData = Type.Object(
  {
    toolCallId: NonEmptyString,
    toolName: NonEmptyString,
    isError: Type.Boolean(),
    jobId: Type.Optional(Type.String({ pattern: "^pi-job-[0-9a-f-]{36}$" })),
    stateGoalCheck: Type.Optional(SystemStateGoal),
    goalCheck: Type.Optional(
      Type.Object(
        {
          filePath: NonEmptyString,
          expectedSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
        },
        Strict,
      ),
    ),
  },
  Strict,
);
const ErrorData = Type.Object({ error: ProtocolErrorSchema }, Strict);
const Approval = Type.Object(
  {
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    sessionId: Type.String(),
    createdAt: Type.String({ format: "date-time" }),
    expiresAt: Type.String({ format: "date-time" }),
  },
  Strict,
);

export const EVENT_DATA_SCHEMAS = {
  "state.snapshot": StateSnapshotV1Schema,
  "state.patch": StatePatchV1Schema,
  "message.started": MessageData,
  "message.delta": Type.Union([
    Type.Object({ delta: Type.String() }, Strict),
    Type.Object({ message: PublicMessageSchema }, Strict),
    Type.Object({ delta: Type.String(), message: PublicMessageSchema }, Strict),
  ]),
  "message.completed": MessageData,
  "thinking.started": Empty,
  "thinking.delta": Type.Object({ delta: Type.String() }, Strict),
  "thinking.completed": Empty,
  "tool.started": ToolData,
  "tool.updated": ToolData,
  "tool.completed": ToolEndData,
  "tool.failed": ToolEndData,
  "agent.settled": Type.Object({ aborted: Type.Boolean() }, Strict),
  "session.changed": Type.Object({ id: Type.Optional(NonEmptyString) }, Strict),
  "subagent.changed": Type.Object(
    { runId: NonEmptyString, status: NonEmptyString },
    Strict,
  ),
  "verification.changed": Type.Object({ status: NonEmptyString }, Strict),
  "permission.requested": Type.Object(
    { requestId: NonEmptyString, description: NonEmptyString },
    Strict,
  ),
  "extension-ui.requested": Type.Object(
    {
      id: NonEmptyString,
      method: Type.Union([
        Type.Literal("confirm"),
        Type.Literal("select"),
        Type.Literal("input"),
        Type.Literal("editor"),
      ]),
      title: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
      options: Type.Optional(Type.Array(Type.String())),
      approval: Type.Optional(Approval),
    },
    Strict,
  ),
  "extension-ui.resolved": Type.Object(
    {
      id: NonEmptyString,
      outcome: Type.Union([
        Type.Literal("answered"),
        Type.Literal("expired"),
        Type.Literal("cancelled"),
      ]),
    },
    Strict,
  ),
  notification: Type.Object(
    {
      message: Type.String(),
      level: Type.Union([
        Type.Literal("info"),
        Type.Literal("warning"),
        Type.Literal("error"),
      ]),
    },
    Strict,
  ),
  "core.disconnected": ErrorData,
  "core.reconnected": Empty,
  error: ErrorData,
  "run.created": Type.Object({ run: RunSnapshotSchema }, Strict),
  "run.updated": Type.Object({ run: RunSnapshotSchema }, Strict),
  "run.input_required": Type.Object(
    {
      run: RunSnapshotSchema,
      uiRequestId: NonEmptyString,
    },
    Strict,
  ),
  "run.settled": Type.Object({ run: RunSnapshotSchema }, Strict),
  "run.reconcile_required": Type.Object({ run: RunSnapshotSchema }, Strict),
} as const;

const validators = Object.fromEntries(
  Object.entries(EVENT_DATA_SCHEMAS).map(([event, schema]) => [
    event,
    Schema.Compile(schema),
  ]),
) as Record<EventName, ReturnType<typeof Schema.Compile>>;

export function isValidEventData(event: EventName, data: unknown): boolean {
  return validators[event].Check(data);
}
