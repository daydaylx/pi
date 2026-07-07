import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  buildCommandMenu,
  type CommandMenuTarget,
} from "./shared/command-menu.ts";
import { buildModeMenu } from "./shared/mode-menu.ts";
import { runMenu } from "./shared/menu-ui.ts";
import {
  buildPermissionMenu,
  buildWriteOverrideMenu,
} from "./shared/permission-menu.ts";
import { buildThinkingMenu } from "./shared/thinking-menu.ts";
import {
  PERMISSION_REQUEST_EVENT,
  PLAN_ACTION_REQUEST_EVENT,
  STATUS_REQUEST_EVENT,
  TOOLS_ACTION_REQUEST_EVENT,
  WORKFLOW_MODE_REQUEST_EVENT,
  WORKFLOW_STATUS_EVENT,
  WRITE_OVERRIDE_REQUEST_EVENT,
  type PermissionLevel,
  type PermissionRequest,
  type PlanActionRequest,
  type StatusRequest,
  type ToolsActionRequest,
  type WorkflowMode,
  type WorkflowModeRequest,
  type WorkflowStatusEvent,
  type WriteOverride,
  type WriteOverrideRequest,
} from "./shared/workflow-status.ts";

export default function actionsExtension(pi: ExtensionAPI): void {
  let mode: WorkflowMode = "work";
  let permissionLevel: PermissionLevel = "read-write";
  let writeOverride: WriteOverride = "inherit";

  pi.events.on(WORKFLOW_STATUS_EVENT, (event: WorkflowStatusEvent) => {
    if (event.source === "permission") {
      permissionLevel = event.permissionLevel;
      writeOverride = event.writeOverride;
    } else {
      mode = event.mode;
    }
  });

  async function openModeMenu(ctx: ExtensionContext): Promise<void> {
    const selected = await runMenu(ctx, "Modus", buildModeMenu(mode), {
      nonInteractiveHint: "Nutze /plan, um den Modus zu wählen.",
    });
    if (!selected) return;
    if (selected === "decide") {
      pi.events.emit(PLAN_ACTION_REQUEST_EVENT, {
        action: "decide",
        ctx,
      } satisfies PlanActionRequest);
      return;
    }
    pi.events.emit(WORKFLOW_MODE_REQUEST_EVENT, {
      mode: selected,
      ctx,
    } satisfies WorkflowModeRequest);
  }

  async function dispatchCommandTarget(
    target: CommandMenuTarget,
    ctx: ExtensionContext,
  ): Promise<void> {
    switch (target.kind) {
      case "open-plan-picker":
        pi.events.emit(PLAN_ACTION_REQUEST_EVENT, {
          action: "choose",
          ctx,
        } satisfies PlanActionRequest);
        return;
      case "decide":
        pi.events.emit(PLAN_ACTION_REQUEST_EVENT, {
          action: "decide",
          ctx,
        } satisfies PlanActionRequest);
        return;
      case "plan-action":
        pi.events.emit(PLAN_ACTION_REQUEST_EVENT, {
          action: target.action,
          ctx,
        } satisfies PlanActionRequest);
        return;
      case "open-permission-menu": {
        const level = await runMenu(
          ctx,
          "Permissions",
          buildPermissionMenu(permissionLevel),
          { fallbackPrompt: "Permission wählen" },
        );
        if (!level) return;
        pi.events.emit(PERMISSION_REQUEST_EVENT, {
          level,
          ctx,
        } satisfies PermissionRequest);
        return;
      }
      case "open-write-menu": {
        const override = await runMenu(
          ctx,
          "Permissions",
          buildWriteOverrideMenu(writeOverride),
          { fallbackPrompt: "Schreibrechte wählen" },
        );
        if (!override) return;
        pi.events.emit(WRITE_OVERRIDE_REQUEST_EVENT, {
          override,
          ctx,
        } satisfies WriteOverrideRequest);
        return;
      }
      case "toggle-yolo":
        pi.events.emit(PERMISSION_REQUEST_EVENT, {
          level: permissionLevel === "yolo" ? "read-write" : "yolo",
          ctx,
        } satisfies PermissionRequest);
        return;
      case "tools-action":
        pi.events.emit(TOOLS_ACTION_REQUEST_EVENT, {
          action: target.action,
          ctx,
        } satisfies ToolsActionRequest);
        return;
      case "status":
        pi.events.emit(STATUS_REQUEST_EVENT, { ctx } satisfies StatusRequest);
        return;
      case "open-thinking-menu": {
        const level = await runMenu(
          ctx,
          "Thinking",
          buildThinkingMenu(pi.getThinkingLevel()),
          { fallbackPrompt: "Thinking-Level wählen" },
        );
        if (!level) return;
        pi.setThinkingLevel(level);
        ctx.ui.notify(`Thinking-Level: ${level}.`, "info");
        return;
      }
    }
  }

  async function openCommandMenu(ctx: ExtensionContext): Promise<void> {
    const selected = await runMenu(
      ctx,
      "Befehle",
      buildCommandMenu({ permissionLevel }),
      { fallbackPrompt: "Befehl wählen" },
    );
    if (!selected) return;
    await dispatchCommandTarget(selected, ctx);
  }

  pi.registerCommand("actions", {
    description: "Modus-Menü öffnen",
    handler: async (_args, ctx) => openModeMenu(ctx),
  });

  pi.registerShortcut("shift+tab", {
    description: "Modus wählen",
    handler: async (ctx) => openModeMenu(ctx),
  });

  pi.registerShortcut("ctrl+shift+x", {
    description: "Befehlsmenü öffnen",
    handler: async (ctx) => openCommandMenu(ctx),
  });
}
