/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

import { normalize } from "node:path";
import { isSafeCommand } from "../shared/bash-allowlist.ts";

export { isSafeCommand };

export function isPlanFilePath(rawPath: string): boolean {
  const p = normalize(rawPath);
  return p.endsWith(".agent/plans/current-plan.md");
}

// Truncates long commands for display in error/block messages
export function redactCommand(command: string): string {
  return command.length > 120 ? `${command.slice(0, 117)}...` : command;
}

export interface TodoItem {
  step: number;
  text: string;
  completed: boolean;
}

export function cleanStepText(text: string): string {
  let cleaned = text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
    .replace(/`([^`]+)`/g, "$1") // Remove code
    .replace(
      /^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  if (cleaned.length > 50) {
    cleaned = `${cleaned.slice(0, 47)}...`;
  }
  return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
  const items: TodoItem[] = [];

  // Strategy 1: Numbered list after "Plan:" header (legacy chat format)
  const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
  if (headerMatch) {
    const planSection = message.slice(
      message.indexOf(headerMatch[0]) + headerMatch[0].length,
    );
    const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;
    for (const match of planSection.matchAll(numberedPattern)) {
      const text = match[2]
        .trim()
        .replace(/\*{1,2}$/, "")
        .trim();
      if (
        text.length > 5 &&
        !text.startsWith("`") &&
        !text.startsWith("/") &&
        !text.startsWith("-")
      ) {
        const cleaned = cleanStepText(text);
        if (cleaned.length > 3) {
          items.push({
            step: items.length + 1,
            text: cleaned,
            completed: false,
          });
        }
      }
    }
    if (items.length > 0) return items;
  }

  // Strategy 2: Checkbox format used in plan file template ([ ] and [x])
  // Matches: "* [ ] Text", "- [ ] Text", "* [x] Text", "- [X] Text"
  const checkboxPattern = /^\s*[-*]\s+\[([ xX])\]\s+\*{0,2}(.+?)\*{0,2}\s*$/gm;
  for (const match of message.matchAll(checkboxPattern)) {
    const checked = match[1].trim() !== "";
    const raw = match[2].trim();
    if (raw.length > 3 && !raw.startsWith("~~")) {
      const cleaned = cleanStepText(raw);
      if (cleaned.length > 3) {
        items.push({
          step: items.length + 1,
          text: cleaned,
          completed: checked,
        });
      }
    }
  }

  return items;
}

export function extractDoneSteps(message: string): number[] {
  const steps: number[] = [];
  for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
    const step = Number(match[1]);
    if (Number.isFinite(step)) steps.push(step);
  }
  return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
  const doneSteps = extractDoneSteps(text);
  for (const step of doneSteps) {
    const item = items.find((t) => t.step === step);
    if (item) item.completed = true;
  }
  return doneSteps.length;
}
