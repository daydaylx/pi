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
import { SHORTCUTS } from "./shared/shortcuts.ts";
import {
  buildPermissionMenu,
  buildWriteOverrideMenu,
} from "./shared/permission-menu.ts";
import { buildThinkingMenu } from "./shared/thinking-menu.ts";
import {
  PERMISSION_REQUEST_EVENT,
  PLAN_ACTION_REQUEST_EVENT,
  SKILL_LAUNCHER_REQUEST_EVENT,
  WORKFLOW_MODE_REQUEST_EVENT,
  WORKFLOW_STATUS_EVENT,
  WRITE_OVERRIDE_REQUEST_EVENT,
  type PermissionLevel,
  type PermissionRequest,
  type PlanActionRequest,
  type SkillLauncherRequest,
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
  let deciding = false;

  pi.events.on(WORKFLOW_STATUS_EVENT, (event: WorkflowStatusEvent) => {
    if (event.source === "permission") {
      permissionLevel = event.permissionLevel;
      writeOverride = event.writeOverride;
    } else {
      mode = event.mode;
      deciding = event.phase === "deciding";
    }
  });

  async function openModeMenu(ctx: ExtensionContext): Promise<void> {
    const selected = await runMenu(ctx, "Modus", buildModeMenu(mode, deciding), {
      nonInteractiveHint: "Nutze /plan, um den Modus zu wählen.",
    });
    if (!selected) return;
    if (selected === "skill") {
      pi.events.emit(SKILL_LAUNCHER_REQUEST_EVENT, {
        ctx,
      } satisfies SkillLauncherRequest);
      return;
    }
    if (selected === "decide") {
      // Shift+Tab verhält sich wie die anderen Plan-Modi: nur in den
      // Klär-Modus wechseln, ohne sofort den Intake-Prompt zu triggern.
      // Der Prompt kommt im nächsten Nutzer-Turn (before_agent_start).
      pi.events.emit(PLAN_ACTION_REQUEST_EVENT, {
        action: "decide-mode",
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
    description: "Zentrales Aktionsmenü öffnen",
    handler: async (_args, ctx) => openCommandMenu(ctx),
  });

  pi.registerShortcut(SHORTCUTS.modeMenu.keys, {
    description: SHORTCUTS.modeMenu.description,
    handler: async (ctx) => openModeMenu(ctx),
  });

  pi.registerShortcut(SHORTCUTS.commandMenu.keys, {
    description: SHORTCUTS.commandMenu.description,
    handler: async (ctx) => openCommandMenu(ctx),
  });
}
