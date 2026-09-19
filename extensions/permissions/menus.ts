import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runMenu } from "../shared/menu-ui.ts";
import {
  PERMISSION_LEVEL_DESCRIPTION,
  PERMISSION_LEVEL_LABEL,
  isYoloLevel,
  type PermissionLevel,
} from "../shared/workflow-status.ts";
import type { PermissionSession } from "./session-state.ts";

export async function openPermissionMenu(
  session: PermissionSession,
  ctx: ExtensionContext,
): Promise<void> {
  // "headless" is the fresh-session default outside the TUI (session-state.ts);
  // it has no reason to be a manually toggleable option for a human already
  // sitting in the TUI, which by definition has a confirm dialog available.
  const levels = (
    Object.keys(PERMISSION_LEVEL_LABEL) as PermissionLevel[]
  ).filter((level) => level !== "headless");
  const selected = await runMenu(
    ctx,
    "Permissions",
    levels.map((level) => ({
      id: `permission-${level}`,
      label: PERMISSION_LEVEL_LABEL[level],
      description: PERMISSION_LEVEL_DESCRIPTION[level],
      current: session.level() === level,
      dangerous: isYoloLevel(level),
      tone: isYoloLevel(level) ? "danger" : undefined,
      value: level,
    })),
    { nonInteractiveHint: "Die Berechtigungen benötigen den TUI-Modus." },
  );
  if (selected) await session.applyPermissionLevel(selected, ctx);
}
