/**
 * The permission selection menu.
 *
 * UI only — the entries come from shared/permission-menu.ts and the decision
 * is applied by session-state. No security rule is evaluated in this module.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runMenu } from "../shared/menu-ui.ts";
import { buildPermissionMenu } from "../shared/permission-menu.ts";
import type { PermissionSession } from "./session-state.ts";

export async function openPermissionMenu(
  session: PermissionSession,
  ctx: ExtensionContext,
): Promise<void> {
  const epoch = session.epoch();
  const level = await runMenu(
    ctx,
    "Berechtigungen",
    buildPermissionMenu(session.level()),
    {
      fallbackPrompt: "Berechtigung wählen",
      nonInteractiveHint:
        "Das Berechtigungsmenü benötigt den TUI-Modus. Nutze /permission <level>.",
    },
  );
  if (!level || !session.isCurrentEpoch(epoch)) return;
  await session.applyPermissionLevel(level, ctx, epoch);
}
