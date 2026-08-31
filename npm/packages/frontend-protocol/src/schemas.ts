import Type from "typebox";
import Schema from "typebox/schema";
import {
  CAPABILITIES,
  ERROR_CODES,
  EVENT_NAMES,
  PROTOCOL_VERSION,
  REQUEST_METHODS,
  type ErrorCode,
} from "./constants.js";

const Strict = { additionalProperties: false } as const;
const NonEmptyString = Type.String({ minLength: 1 });

export const CapabilitySchema = Type.Union(
  CAPABILITIES.map((value) => Type.Literal(value)),
);
export const RequestMethodSchema = Type.Union(
  REQUEST_METHODS.map((value) => Type.Literal(value)),
);
export const EventNameSchema = Type.Union(
  EVENT_NAMES.map((value) => Type.Literal(value)),
);
export const ErrorCodeSchema = Type.Union(
  ERROR_CODES.map((value) => Type.Literal(value)),
);

export const ProtocolErrorSchema = Type.Object(
  {
    code: ErrorCodeSchema,
    message: NonEmptyString,
    retryable: Type.Boolean(),
    correlationId: NonEmptyString,
    details: Type.Optional(
      Type.Object(
        {
          reason: Type.Optional(Type.String()),
          supportedProtocolVersions: Type.Optional(Type.Array(Type.Integer())),
        },
        Strict,
      ),
    ),
  },
  Strict,
);

export const ClientHelloSchema = Type.Object(
  {
    kind: Type.Literal("hello"),
    client: Type.Object(
      { name: NonEmptyString, version: NonEmptyString },
      Strict,
    ),
    supportedProtocolVersions: Type.Array(Type.Integer({ minimum: 1 }), {
      minItems: 1,
      uniqueItems: true,
    }),
  },
  Strict,
);

export const AcceptedServerHelloSchema = Type.Object(
  {
    kind: Type.Literal("hello"),
    accepted: Type.Literal(true),
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    serverVersion: NonEmptyString,
    piVersion: NonEmptyString,
    capabilities: Type.Array(NonEmptyString, { uniqueItems: true }),
  },
  Strict,
);

export const RejectedServerHelloSchema = Type.Object(
  {
    kind: Type.Literal("hello"),
    accepted: Type.Literal(false),
    error: ProtocolErrorSchema,
  },
  Strict,
);

export const ServerHelloSchema = Type.Union([
  AcceptedServerHelloSchema,
  RejectedServerHelloSchema,
]);

export const RequestSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    kind: Type.Literal("request"),
    id: NonEmptyString,
    method: NonEmptyString,
    params: Type.Record(Type.String(), Type.Unknown()),
  },
  Strict,
);

export const SuccessResponseSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    kind: Type.Literal("response"),
    id: NonEmptyString,
    ok: Type.Literal(true),
    result: Type.Unknown(),
  },
  Strict,
);

export const ErrorResponseSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    kind: Type.Literal("response"),
    id: NonEmptyString,
    ok: Type.Literal(false),
    error: ProtocolErrorSchema,
  },
  Strict,
);

export const ResponseSchema = Type.Union([
  SuccessResponseSchema,
  ErrorResponseSchema,
]);

export const EventSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    kind: Type.Literal("event"),
    sequence: Type.Integer({ minimum: 1 }),
    event: NonEmptyString,
    sessionId: Type.Optional(NonEmptyString),
    data: Type.Record(Type.String(), Type.Unknown()),
  },
  Strict,
);

export const WireMessageSchema = Type.Union([
  ClientHelloSchema,
  ServerHelloSchema,
  RequestSchema,
  ResponseSchema,
  EventSchema,
]);

const validators = {
  clientHello: Schema.Compile(ClientHelloSchema),
  serverHello: Schema.Compile(ServerHelloSchema),
  request: Schema.Compile(RequestSchema),
  response: Schema.Compile(ResponseSchema),
  event: Schema.Compile(EventSchema),
  wireMessage: Schema.Compile(WireMessageSchema),
};

export const isClientHello = (value: unknown): boolean =>
  validators.clientHello.Check(value);
export const isServerHello = (value: unknown): boolean =>
  validators.serverHello.Check(value);
export const isRequest = (value: unknown): boolean =>
  validators.request.Check(value);
export const isResponse = (value: unknown): boolean =>
  validators.response.Check(value);
export const isEvent = (value: unknown): boolean =>
  validators.event.Check(value);
export const isWireMessage = (value: unknown): boolean =>
  validators.wireMessage.Check(value);

export function assertWireMessage(value: unknown): void {
  if (!isWireMessage(value)) {
    throw new TypeError("Invalid Pi frontend protocol message");
  }
}

export interface ProtocolError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: {
    reason?: string;
    supportedProtocolVersions?: number[];
  };
}
export type ClientHello = Type.Static<typeof ClientHelloSchema>;
export type ServerHello = Type.Static<typeof ServerHelloSchema>;
export type Request = Type.Static<typeof RequestSchema>;
export type Response = Type.Static<typeof ResponseSchema>;
export type Event = Type.Static<typeof EventSchema>;
export type WireMessage = Type.Static<typeof WireMessageSchema>;
