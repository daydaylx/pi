import Type from "typebox";
import Schema from "typebox/schema";
import type { RequestMethod } from "./constants.js";

const Strict = { additionalProperties: false } as const;
const Empty = Type.Object({}, Strict);
const Id = Type.String({ minLength: 1 });
const Message = Type.String({ minLength: 1, maxLength: 100_000 });

export const REQUEST_PARAM_SCHEMAS = {
  "system.ping": Empty,
  "session.list": Empty,
  "session.create": Empty,
  "session.open": Type.Object({ id: Id }, Strict),
  "session.current": Empty,
  "session.messages": Type.Object({ id: Type.Optional(Id) }, Strict),
  "session.stats": Empty,
  "agent.prompt": Type.Object({ message: Message }, Strict),
  "agent.steer": Type.Object({ message: Message }, Strict),
  "agent.followUp": Type.Object({ message: Message }, Strict),
  "agent.abort": Empty,
  "model.list": Empty,
  "model.set": Type.Object({ provider: Id, modelId: Id }, Strict),
  "model.cycle": Empty,
  "thinking.list": Empty,
  "thinking.set": Type.Object({ level: Id }, Strict),
  "thinking.cycle": Empty,
  "workflow.list": Empty,
  "workflow.set": Type.Object(
    {
      mode: Type.Union([
        Type.Literal("work"),
        Type.Literal("simple_plan"),
        Type.Literal("detailed_plan"),
      ]),
    },
    Strict,
  ),
  "permission.list": Empty,
  "permission.set": Type.Object(
    {
      level: Type.Union([
        Type.Literal("readonly"),
        Type.Literal("project-write"),
        Type.Literal("confirm-all"),
        Type.Literal("yolo"),
      ]),
    },
    Strict,
  ),
  "command.list": Empty,
  "command.invoke": Type.Object(
    { name: Id, args: Type.Optional(Type.String({ maxLength: 10_000 })) },
    Strict,
  ),
  "verification.run": Empty,
  "changes.list": Empty,
  "configuration.get": Empty,
  "ui.respond": Type.Union([
    Type.Object({ id: Id, cancelled: Type.Literal(true) }, Strict),
    Type.Object(
      { id: Id, method: Type.Literal("confirm"), confirmed: Type.Boolean() },
      Strict,
    ),
    Type.Object(
      {
        id: Id,
        method: Type.Union([
          Type.Literal("select"),
          Type.Literal("input"),
          Type.Literal("editor"),
        ]),
        value: Type.String({ maxLength: 2_000 }),
      },
      Strict,
    ),
  ]),
} as const;

const validators = Object.fromEntries(
  Object.entries(REQUEST_PARAM_SCHEMAS).map(([method, schema]) => [
    method,
    Schema.Compile(schema),
  ]),
) as Record<RequestMethod, ReturnType<typeof Schema.Compile>>;

export function isValidRequestParams(
  method: RequestMethod,
  params: unknown,
): boolean {
  return validators[method].Check(params);
}
