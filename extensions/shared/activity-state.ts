/**
 * Geteilter Aktivitäts-Tracker für Tool-Aufrufe.
 *
 * Wird ausschließlich aus den globalen Events tool_execution_start/update/end
 * gespeist (nicht aus renderCall/renderResult — die sind an einzelne
 * ToolExecutionComponents im Hauptbereich gebunden und nicht "umleitbar").
 * activity-panel.ts liest diesen State, um das rechte Activity Panel und den
 * schmalen Inline-Fallback unabhängig vom Haupt-Transkript zu rendern.
 */

import { toolCallLabel } from "./tool-labels.ts";

export type ActivityStatus = "pending" | "running" | "completed" | "failed";

export interface ActivityEntry {
  toolCallId: string;
  toolName: string;
  label: string;
  status: ActivityStatus;
  startedAt: number;
  updatedAt: number;
}

// Deckelt den Speicher; nur die letzten N Events sind für ein Activity Panel
// relevant, ältere werden verworfen statt unbegrenzt zu wachsen.
const MAX_ENTRIES = 50;

interface ActivityState {
  entries: Map<string, ActivityEntry>;
  order: string[];
  listeners: Set<() => void>;
}

function createState(): ActivityState {
  return { entries: new Map(), order: [], listeners: new Set() };
}

let state: ActivityState = createState();

export function resetActivityState(): void {
  state = createState();
}

export function onActivityChange(listener: () => void): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

function notify(): void {
  for (const listener of state.listeners) listener();
}

function touch(toolCallId: string): void {
  const index = state.order.indexOf(toolCallId);
  if (index !== -1) state.order.splice(index, 1);
  state.order.push(toolCallId);
  while (state.order.length > MAX_ENTRIES) {
    const oldest = state.order.shift();
    if (oldest) state.entries.delete(oldest);
  }
}

export function recordToolStart(
  toolCallId: string,
  toolName: string,
  args: unknown,
): void {
  const now = Date.now();
  const existing = state.entries.get(toolCallId);
  state.entries.set(toolCallId, {
    toolCallId,
    toolName,
    label: toolCallLabel(toolName, args),
    status: "running",
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
  });
  touch(toolCallId);
  notify();
}

export function recordToolUpdate(
  toolCallId: string,
  toolName: string,
  args: unknown,
): void {
  const existing = state.entries.get(toolCallId);
  state.entries.set(toolCallId, {
    toolCallId,
    toolName,
    label: toolCallLabel(toolName, args),
    status: "running",
    startedAt: existing?.startedAt ?? Date.now(),
    updatedAt: Date.now(),
  });
  touch(toolCallId);
  notify();
}

export function recordToolEnd(
  toolCallId: string,
  toolName: string,
  isError: boolean,
): void {
  const existing = state.entries.get(toolCallId);
  state.entries.set(toolCallId, {
    toolCallId,
    toolName,
    label: existing?.label ?? toolCallLabel(toolName, undefined),
    status: isError ? "failed" : "completed",
    startedAt: existing?.startedAt ?? Date.now(),
    updatedAt: Date.now(),
  });
  touch(toolCallId);
  notify();
}

/** Neueste zuerst, wie im Activity Panel gewünscht. */
export function getRecentActivity(limit: number): ActivityEntry[] {
  const ids = state.order.slice(-limit).reverse();
  return ids
    .map((id) => state.entries.get(id))
    .filter((entry): entry is ActivityEntry => entry !== undefined);
}

export function getActivityCount(): number {
  return state.order.length;
}
