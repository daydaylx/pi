import type { MenuEntry } from "./menu-ui.ts";
import {
  PERMISSION_LEVEL_DESCRIPTION,
  PERMISSION_LEVEL_LABEL,
  type PermissionLevel,
} from "./workflow-status.ts";

export function buildPermissionMenu(
  current: PermissionLevel,
): MenuEntry<PermissionLevel>[] {
  return (Object.keys(PERMISSION_LEVEL_LABEL) as PermissionLevel[]).map(
    (level) => ({
      id: `permission-${level}`,
      label: PERMISSION_LEVEL_LABEL[level],
      description: PERMISSION_LEVEL_DESCRIPTION[level],
      value: level,
      current: current === level,
    }),
  );
}
