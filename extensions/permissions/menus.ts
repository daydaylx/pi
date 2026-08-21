import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runMenu } from "../shared/menu-ui.ts";
import {
  PERMISSION_LEVEL_DESCRIPTION,
  PERMISSION_LEVEL_LABEL,
  type PermissionLevel,
} from "../shared/workflow-status.ts";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import { requestWorkflowCapabilities } from "../shared/workflow-capabilities.ts";
import type { PermissionSession } from "./session-state.ts";

export async function openPermissionMenu(
  session: PermissionSession,
  ctx: ExtensionContext,
): Promise<void> {
  const levels = Object.keys(PERMISSION_LEVEL_LABEL) as PermissionLevel[];
  const planning = isPlanningMode(
    requestWorkflowCapabilities(session.pi.events).mode,
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
