/**
 * Bash Guard Extension
 *
 * Intercepts potentially destructive or exfiltrating bash tool calls in
 * normal mode and shows a confirmation dialog before executing. Complements
 * git-guard.ts (git write operations) and plan-mode's isSafeCommand() gate
 * (Plan-Mode only, read-only allowlist) — this is the only guard that covers
 * general bash calls outside Plan Mode.
 *
 * Commands:
 *   /bash-guard       - Toggle on/off
 *   /bash-guard on    - Enable
 *   /bash-guard off   - Disable
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DESTRUCTIVE_PATTERNS } from "./shared/bash-allowlist.ts";
import {
  WORKFLOW_STATUS_EVENT,
  type WorkflowStatusEvent,
} from "./shared/workflow-status.ts";

// git-guard.ts already prompts for git write operations and silently allows
// git reads; skip git commands here entirely to avoid double confirmation.
const GIT_COMMAND = /^\s*git\b/i;

export default function bashGuardExtension(pi: ExtensionAPI): void {
  let enabled = true;

  function updateStatus(ctx: ExtensionContext): void {
    if (enabled) {
      ctx.ui.setStatus("bash-guard", undefined);
    } else {
      ctx.ui.setStatus(
        "bash-guard",
        ctx.ui.theme.fg("warning", "BASH GUARD OFF"),
      );
    }
    pi.events.emit(WORKFLOW_STATUS_EVENT, {
      source: "bash-guard",
      enabled,
    } satisfies WorkflowStatusEvent);
  }

  pi.registerCommand("bash-guard", {
    description:
      "Bash-Guard ein-/ausschalten (Bestätigung vor potenziell destruktiven/exfiltrierenden Bash-Befehlen)",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "on") {
        enabled = true;
      } else if (arg === "off") {
        enabled = false;
      } else {
        enabled = !enabled;
      }
      updateStatus(ctx);
      ctx.ui.notify(
        enabled ? "Bash-Guard aktiviert" : "Bash-Guard deaktiviert",
        "info",
      );
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!enabled || event.toolName !== "bash") return;
    if (!ctx.hasUI) return;

    const command = (event.input.command ?? "") as string;
    if (GIT_COMMAND.test(command)) return; // handled by git-guard.ts
    if (!DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) return;

    // Skip confirmation in YOLO mode
    try {
      if (pi.getFlag("yolo") === true) return;
    } catch {
      // yolo flag not registered — proceed with guard
    }

    const preview =
      command.length > 120 ? `${command.slice(0, 117)}...` : command;
    const choice = await ctx.ui.select(
      `Bash-Guard: Diesen Befehl ausführen?\n\n  $ ${preview}`,
      ["Ausführen", "Abbrechen"],
    );

    if (choice !== "Ausführen") {
      return {
        block: true,
        reason: `Bash-Guard: Befehl vom User abgebrochen.\nBefehl: ${command}`,
      };
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
  });
}
