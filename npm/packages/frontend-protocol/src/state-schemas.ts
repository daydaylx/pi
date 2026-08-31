import Type from "typebox";
import Schema from "typebox/schema";

const Strict = { additionalProperties: false } as const;
const OptionalString = Type.Optional(Type.String());

const WorkflowModeSchema = Type.Union([
  Type.Literal("work"),
  Type.Literal("simple_plan"),
  Type.Literal("detailed_plan"),
]);

const ActivityKindSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("thinking"),
  Type.Literal("explore"),
  Type.Literal("file_change"),
  Type.Literal("verification"),
  Type.Literal("subagent"),
  Type.Literal("tool"),
  Type.Literal("responding"),
  Type.Literal("other"),
]);

export const StateSnapshotV1Schema = Type.Object(
  {
    session: Type.Object(
      {
        id: OptionalString,
        name: OptionalString,
        cwd: OptionalString,
        connected: Type.Boolean(),
      },
      Strict,
    ),
    workflow: Type.Object(
      {
        mode: WorkflowModeSchema,
        label: Type.String(),
        available: Type.Array(WorkflowModeSchema),
      },
      Strict,
    ),
    task: Type.Object(
      {
        title: Type.String(),
        phaseLabel: Type.String(),
        status: Type.Union([
          Type.Literal("active"),
          Type.Literal("needs_input"),
          Type.Literal("review"),
          Type.Literal("completed"),
        ]),
      },
      Strict,
    ),
    activity: Type.Object({ kind: ActivityKindSchema }, Strict),
    permissions: Type.Object(
      {
        current: OptionalString,
        label: OptionalString,
        options: Type.Array(Type.String()),
        pending: Type.Optional(
          Type.Object(
            { requestId: Type.String(), description: Type.String() },
            Strict,
          ),
        ),
      },
      Strict,
    ),
    lsp: Type.Object({ state: OptionalString, detail: OptionalString }, Strict),
    model: Type.Object(
      { current: OptionalString, available: Type.Array(Type.String()) },
      Strict,
    ),
    thinking: Type.Object(
      { current: OptionalString, available: Type.Array(Type.String()) },
      Strict,
    ),
    changes: Type.Union([
      Type.Null(),
      Type.Object(
        {
          filesCount: Type.Integer({ minimum: 0 }),
          files: Type.Array(
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
    ]),
    verification: Type.Union([
      Type.Null(),
      Type.Object(
        {
          status: OptionalString,
          requiredOutcomes: Type.Record(Type.String(), Type.String()),
          blockingRecommendedIds: Type.Array(Type.String()),
        },
        Strict,
      ),
    ]),
    subagents: Type.Array(
      Type.Object(
        {
          runId: Type.String(),
          agent: Type.String(),
          role: Type.String(),
          status: Type.Union([
            Type.Literal("running"),
            Type.Literal("paused"),
            Type.Literal("needs_attention"),
            Type.Literal("queued"),
          ]),
        },
        Strict,
      ),
    ),
    configuration: Type.Record(
      Type.String(),
      Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
    ),
  },
  Strict,
);

const stateSnapshotValidator = Schema.Compile(StateSnapshotV1Schema);
export const StatePatchV1Schema = Type.Partial(StateSnapshotV1Schema);
const statePatchValidator = Schema.Compile(StatePatchV1Schema);

export const isStateSnapshotV1 = (value: unknown): boolean =>
  stateSnapshotValidator.Check(value);
export const isStatePatchV1 = (value: unknown): boolean =>
  statePatchValidator.Check(value);
