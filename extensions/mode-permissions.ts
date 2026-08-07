/**
 * Central permission decision layer, independent from the workflow mode.
 *
 * This is intentionally the only extension that intercepts tool_call and
 * user_bash. Workflow extensions do not make access decisions themselves.
 *
 * The file stays the registered entry point (settings.json, coverage baseline,
 * installer); the logic lives in extensions/permissions/:
 *
 *   tool-event.ts       reading the path out of a tool call
 *   workflow-policy.ts  workflow-scoped decisions   [pure]
 *   tool-policy.ts      permission-level decisions  [pure]
 *   session-state.ts    mode, YOLO, persistence, audit
 *   thinking-control.ts thinking depth and its menu
 *   menus.ts            permission selection menu
 *   guards.ts           the tool_call / user_bash interceptors
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { catalogDescription } from "./shared/command-catalog.ts";
import {
  CONTROL_CENTER_EVENTS,
  type OpenControlCenterMenuEvent,
} from "./shared/control-center-events.ts";
import { isSelectableThinkingLevel } from "./shared/thinking-menu.ts";
import {
  PERMISSION_LEVEL_LABEL,
  normalizePermissionLevel,
  type PermissionLevel,
} from "./shared/workflow-status.ts";
import { registerPermissionGuards } from "./permissions/guards.ts";
import { openPermissionMenu } from "./permissions/menus.ts";
import { createPermissionSession } from "./permissions/session-state.ts";
import { createThinkingControl } from "./permissions/thinking-control.ts";

export default function modePermissionsExtension(pi: ExtensionAPI): void {
  const thinking = createThinkingControl(pi);
  const session = createPermissionSession(pi, thinking);
  // Permission and thinking share one persisted record, so a thinking change
  // has to write the whole record rather than a partial one.
  thinking.onPersist = () => session.persist();

  pi.registerCommand("yolo", {
    description: catalogDescription("yolo"),
    handler: async (_args, ctx) => session.toggleYolo(ctx, "command"),
  });

  pi.registerCommand("permission", {
    description: `${catalogDescription("permission")}: readonly | project-write | confirm-all | yolo`,
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (!raw) {
        await openPermissionMenu(session, ctx);
        return;
      }
      const level = Object.hasOwn(PERMISSION_LEVEL_LABEL, raw)
        ? (raw as PermissionLevel)
        : normalizePermissionLevel(raw);
      if (!level) {
        ctx.ui.notify(
          "Nutzung: /permission readonly|project-write|confirm-all|yolo",
          "info",
        );
        return;
      }
      await session.applyPermissionLevel(level, ctx);
    },
  });

  pi.registerCommand("thinking", {
    description: `${catalogDescription("thinking")}: off | minimal | low | medium | high | xhigh`,
    handler: async (args, ctx) => {
      const epoch = session.epoch();
      const value = args.trim().toLowerCase();
      if (!value) {
        await thinking.openMenu(ctx, () => session.isCurrentEpoch(epoch));
        return;
      }
      if (isSelectableThinkingLevel(value)) {
        thinking.applySelection(value, ctx, () =>
          session.isCurrentEpoch(epoch),
        );
        return;
      }
      ctx.ui.notify(
        "Nutzung: /thinking off|minimal|low|medium|high|xhigh",
        "info",
      );
    },
  });

  pi.events.on(CONTROL_CENTER_EVENTS.openPermissions, async (event) => {
    await openPermissionMenu(
      session,
      (event as OpenControlCenterMenuEvent).ctx,
    );
  });
  pi.events.on(CONTROL_CENTER_EVENTS.openThinking, async (event) => {
    const ctx = (event as OpenControlCenterMenuEvent).ctx;
    const epoch = session.epoch();
    await thinking.openMenu(ctx, () => session.isCurrentEpoch(epoch));
  });

  registerPermissionGuards(pi, session);

  pi.on("session_start", async (_event, ctx) => {
    session.beginSession(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    session.endSession(ctx);
  });
}
