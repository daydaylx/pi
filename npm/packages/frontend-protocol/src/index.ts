export * from "./constants.js";
export * from "./schemas.js";
export * from "./state.js";
export * from "./state-schemas.js";
export * from "./params.js";
export * from "./results.js";
export * from "./events.js";

import { ERROR_CODES, PROTOCOL_VERSION, type ErrorCode } from "./constants.js";
import type { ProtocolError } from "./schemas.js";

export function negotiateProtocolVersion(
  supportedProtocolVersions: readonly number[],
): 1 | undefined {
  return supportedProtocolVersions.includes(PROTOCOL_VERSION)
    ? PROTOCOL_VERSION
    : undefined;
}

export function protocolError(
  code: ErrorCode,
  message: string,
  correlationId: string,
  options: { retryable?: boolean; details?: ProtocolError["details"] } = {},
): ProtocolError {
  if (!ERROR_CODES.includes(code)) {
    throw new TypeError(`Unknown protocol error code: ${code}`);
  }
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    correlationId,
    ...(options.details ? { details: options.details } : {}),
  };
}
