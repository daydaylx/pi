/**
 * Ereignisvertrag: kanonische Protokollereignisse und ihre Quellen im
 * heutigen System. Ein Frontend hängt ausschließlich an dieser Tabelle —
 * niemals direkt an Aurora-Renderer-Interna. "derivedFrom" markiert
 * abgeleitete Ereignisse, für die es kein 1:1-Core-Ereignis gibt (R13:
 * sichtbare Ableitung statt stiller Fallback).
 */
import { FRONTEND_STATE_CHANNELS } from "./state-contract.ts";

export const PROTOCOL_EVENTS = [
  "state.snapshot",
  "state.patch",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "agent.started",
  "agent.settled",
  "verification.changed",
  "session.changed",
] as const;

export type ProtocolEventName = (typeof PROTOCOL_EVENTS)[number];

export interface EventSource {
  rpc?: readonly string[];
  bus?: readonly string[];
  derivedFrom?: string;
}

export const EVENT_SOURCES: Record<ProtocolEventName, EventSource> = {
  "state.snapshot": {
    rpc: ["get_state"],
    bus: [FRONTEND_STATE_CHANNELS.snapshot],
  },
  "state.patch": {
    bus: [FRONTEND_STATE_CHANNELS.patch],
  },
  "tool.started": {
    rpc: ["tool_execution_start"],
  },
  "tool.completed": {
    rpc: ["tool_execution_end"],
  },
  "tool.failed": {
    rpc: ["tool_execution_end"],
    derivedFrom:
      "tool_execution_end mit Fehlerkennung (isError/Exit-Status) als failed klassifiziert.",
  },
  "agent.started": {
    rpc: ["agent_start"],
  },
  "agent.settled": {
    rpc: ["agent_settled"],
  },
  "verification.changed": {
    bus: [FRONTEND_STATE_CHANNELS.patch, FRONTEND_STATE_CHANNELS.snapshot],
    derivedFrom:
      "Ableitung aus dem verification-Feld der Zustandskanäle sowie dem setStatus-UI-Request der setup-core-Extension.",
  },
  "session.changed": {
    rpc: ["new_session", "switch_session"],
    derivedFrom: "Epochenwechsel im nachfolgenden get_state.",
  },
};
