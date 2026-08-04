import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  PERMISSION_LEVEL_LABEL,
  type PermissionLevel,
} from "../shared/workflow-status.ts";
import type { PermissionSession } from "./session-state.ts";

export async function openPermissionMenu(
  session: PermissionSession,
  ctx: ExtensionContext,
): Promise<void> {
  const levels = Object.keys(PERMISSION_LEVEL_LABEL) as PermissionLevel[];
  const choices = levels.map(
    (level) => `${PERMISSION_LEVEL_LABEL[level]} · ${level}`,
  );
  const selected = await ctx.ui.select("Berechtigungen", choices);
  const index = choices.indexOf(selected ?? "");
  if (index >= 0 && index < levels.length)
    await session.applyPermissionLevel(levels[index], ctx);
}
