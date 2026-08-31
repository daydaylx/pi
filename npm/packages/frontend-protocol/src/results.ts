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
  "session.current": CurrentSession,
  "session.messages": Type.Object(
    { messages: Type.Array(PublicMessageSchema) },
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
  "permission.list": Type.Object({ levels: Type.Array(Type.String()) }, Strict),
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
