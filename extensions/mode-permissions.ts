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
import { Type } from "typebox";
import { catalogDescription } from "./shared/command-catalog.ts";
import {
  CONTROL_CENTER_EVENTS,
  type OpenControlCenterMenuEvent,
} from "./shared/control-center-events.ts";
import {
  PERMISSION_LEVEL_LABEL,
  isYoloLevel,
  normalizePermissionLevel,
  parseYoloLevel,
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

  pi.registerTool({
    name: "workspace_add",
    label: "Projektwurzel freigeben",
    description:
      "Bittet den Nutzer um UI-Freigabe, ein zusätzliches Projekt bis zum Ende dieser Sitzung in den Workspace-Scope aufzunehmen. Die Freigabe erweitert nur die Projektwurzel; die aktuelle Berechtigungsstufe, Secret-Grenzen und Planmodus-Regeln gelten weiter.",
    promptSnippet:
      "Request the user's session-only UI approval before working in an additional project root.",
    parameters: Type.Object({ path: Type.String() }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const approved = await session.authorizeWorkspaceRoot(
        (params as { path: string }).path,
        ctx,
      );
      if (!approved.approved) {
        throw new Error(
          `Zusätzliche Projektwurzel nicht freigegeben: ${approved.reason ?? "Nutzer hat abgelehnt."}`,
        );
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Projektwurzel für diese Sitzung freigegeben: ${approved.root}`,
          },
        ],
      };
    },
  });

  pi.registerCommand("yolo", {
    description: catalogDescription("yolo"),
    handler: async (args, ctx) => {
      const raw = args.trim().toLowerCase();
      if (!raw) return session.toggleYolo(ctx, "command");
      if (raw === "off" || raw === "aus" || raw === "0") {
        if (isYoloLevel(session.level()))
          return session.toggleYolo(ctx, "command");
        ctx.ui.notify("YOLO ist nicht aktiv.", "info");
        return;
      }
      const level = parseYoloLevel(raw);
      if (!level) {
        ctx.ui.notify(
          "Nutzung: /yolo [1|2|3|off] — 1 Projekt, 2 mit Rückfrage, 3 Vollzugriff",
          "info",
        );
        return;
      }
      // Explizite Stufe wechselt dorthin; dieselbe Stufe erneut schaltet YOLO aus.
      return session.toggleYolo(ctx, "command", undefined, level);
    },
  });

  pi.registerCommand("permission", {
    description: `${catalogDescription("permission")}: readonly | project-write | confirm-all | yolo | yolo-ask | yolo-full`,
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
          "Nutzung: /permission readonly|project-write|confirm-all|yolo|yolo-ask|yolo-full",
          "info",
        );
        return;
      }
      await session.applyPermissionLevel(level, ctx);
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
