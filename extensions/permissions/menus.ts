import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PERMISSION_LEVEL_LABEL, type PermissionLevel } from "../shared/workflow-status.ts";
import type { PermissionGrant, PermissionSession } from "./session-state.ts";

function grantLabel(grant: PermissionGrant): string {
  const target = grant.commandPattern ?? grant.pathPattern ?? grant.action;
  return `${grant.tool}: ${target}`;
}

async function manageGrants(session: PermissionSession, ctx: ExtensionContext): Promise<void> {
  const section = await ctx.ui.select("Freigaben verwalten", [
    "Projektfreigaben anzeigen", "Globale Freigaben anzeigen", "Alle Projektfreigaben zurücksetzen",
  ]);
  if (section === "Alle Projektfreigaben zurücksetzen") {
    if (await ctx.ui.confirm("Alle Projektfreigaben zurücksetzen?", "Die gespeicherten Regeln dieses Projekts werden gelöscht.")) {
      session.clearProjectGrants(ctx.cwd);
      ctx.ui.notify("Projektfreigaben gelöscht.", "info");
    }
    return;
  }
  const scope = section === "Globale Freigaben anzeigen" ? "global" : "project";
  const grants = session.listGrants(scope, ctx.cwd);
  if (grants.length === 0) {
    ctx.ui.notify(scope === "global" ? "Keine globalen Freigaben." : "Keine Projektfreigaben.", "info");
    return;
  }
  const choices = grants.map((grant) => `Löschen · ${grantLabel(grant)}`);
  choices.push("Zurück");
  const selected = await ctx.ui.select(scope === "global" ? "GLOBALE FREIGABEN" : "PROJEKTFREIGABEN", choices);
  const index = choices.indexOf(selected ?? "");
  if (index >= 0 && index < grants.length) {
    session.removeGrant(grants[index].id);
    ctx.ui.notify("Freigabe gelöscht.", "info");
  }
}

export async function openPermissionMenu(session: PermissionSession, ctx: ExtensionContext): Promise<void> {
  const levels = Object.keys(PERMISSION_LEVEL_LABEL) as PermissionLevel[];
  const choices = levels.map((level) => `${PERMISSION_LEVEL_LABEL[level]} · ${level}`);
  choices.push("Freigaben verwalten");
  const selected = await ctx.ui.select("Berechtigungen", choices);
  if (selected === "Freigaben verwalten") {
    await manageGrants(session, ctx);
    return;
  }
  const index = choices.indexOf(selected ?? "");
  if (index >= 0 && index < levels.length) await session.applyPermissionLevel(levels[index], ctx);
}
