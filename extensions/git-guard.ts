/**
 * Git Guard Extension
 *
 * Intercepts bash tool calls that contain git write operations and shows a
 * confirmation dialog before executing. Prevents accidental commits, pushes,
 * or destructive git commands during agent turns.
 *
 * Commands:
 *   /git-guard       - Toggle on/off
 *   /git-guard on    - Enable
 *   /git-guard off   - Disable
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { GIT_WRITE_PATTERN } from "./shared/bash-allowlist.ts";
import {
  WORKFLOW_STATUS_EVENT,
  type WorkflowStatusEvent,
} from "./shared/workflow-status.ts";

export default function gitGuardExtension(pi: ExtensionAPI): void {
  let enabled = true;

  function updateStatus(ctx: ExtensionContext): void {
    if (enabled) {
      ctx.ui.setStatus("git-guard", undefined);
    } else {
      ctx.ui.setStatus(
        "git-guard",
        ctx.ui.theme.fg("warning", "GIT GUARD OFF"),
      );
    }
    pi.events.emit(WORKFLOW_STATUS_EVENT, {
      source: "git-guard",
      enabled,
    } satisfies WorkflowStatusEvent);
  }

  pi.registerCommand("git-guard", {
    description:
      "Git-Guard ein-/ausschalten (verhindert unbeabsichtigte git-Aktionen)",
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
        enabled ? "Git-Guard aktiviert" : "Git-Guard deaktiviert",
        "info",
      );
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!enabled || event.toolName !== "bash") return;
    if (!ctx.hasUI) return;

    const command = (event.input.command ?? "") as string;
    if (!GIT_WRITE_PATTERN.test(command)) return;

    const preview =
      command.length > 120 ? `${command.slice(0, 117)}...` : command;
    const choice = await ctx.ui.select(
      `Git-Guard: Diesen Befehl ausführen?\n\n  $ ${preview}`,
      ["Ausführen", "Abbrechen"],
    );

    if (choice !== "Ausführen") {
      return {
        block: true,
        reason: `Git-Guard: Befehl vom User abgebrochen.\nBefehl: ${command}`,
      };
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
  });
}
