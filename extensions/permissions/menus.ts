import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runMenu } from "../shared/menu-ui.ts";
import {
  PERMISSION_LEVEL_DESCRIPTION,
  PERMISSION_LEVEL_LABEL,
  type PermissionLevel,
} from "../shared/workflow-status.ts";
import {
  isPlanRestricted,
  requestWorkflowCapabilities,
} from "../shared/workflow-capabilities.ts";
import type { PermissionSession } from "./session-state.ts";

export async function openPermissionMenu(
  session: PermissionSession,
  ctx: ExtensionContext,
): Promise<void> {
  const levels = Object.keys(PERMISSION_LEVEL_LABEL) as PermissionLevel[];
  // An unknown workflow state disables YOLO too: the same fail-closed rule the
  // guards follow, so the menu never offers what the guard would refuse.
  const planning = isPlanRestricted(
    requestWorkflowCapabilities(session.pi.events),
  );
  const selected = await runMenu(
    ctx,
    "Permissions",
    levels.map((level) => ({
      id: `permission-${level}`,
      label: PERMISSION_LEVEL_LABEL[level],
      description: PERMISSION_LEVEL_DESCRIPTION[level],
      current: session.level() === level,
      dangerous: level === "yolo",
      tone: level === "yolo" ? "danger" : undefined,
      disabled: planning && level === "yolo",
      disabledReason:
        planning && level === "yolo"
          ? "YOLO ist im Planmodus gesperrt — zuerst nach work wechseln."
          : undefined,
      value: level,
    })),
    { nonInteractiveHint: "Die Berechtigungen benötigen den TUI-Modus." },
  );
  if (selected) await session.applyPermissionLevel(selected, ctx);
}
