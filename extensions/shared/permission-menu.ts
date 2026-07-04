import type { MenuEntry } from "./menu-ui.ts";
import {
  PERMISSION_LEVEL_DESCRIPTION,
  PERMISSION_LEVEL_LABEL,
  WRITE_OVERRIDE_DESCRIPTION,
  WRITE_OVERRIDE_LABEL,
  type PermissionLevel,
  type WriteOverride,
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

export function buildWriteOverrideMenu(
  current: WriteOverride,
): MenuEntry<WriteOverride>[] {
  return (Object.keys(WRITE_OVERRIDE_LABEL) as WriteOverride[]).map(
    (override) => ({
      id: `write-${override}`,
      label: WRITE_OVERRIDE_LABEL[override],
      description: WRITE_OVERRIDE_DESCRIPTION[override],
      value: override,
      current: current === override,
    }),
  );
}
