import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CommandEffect } from "./command-catalog.ts";

interface SlashCommandUI {
  submitSlashCommand(commandLine: string): Promise<void>;
}

function slashCommandUi(ctx: ExtensionContext): SlashCommandUI | undefined {
  const candidate = ctx.ui as typeof ctx.ui & Partial<SlashCommandUI>;
  return typeof candidate.submitSlashCommand === "function"
    ? (candidate as SlashCommandUI)
    : undefined;
}

export async function submitCanonicalCommand(
  ctx: ExtensionContext,
  commandLine: string,
  effect: CommandEffect = "preserve-draft",
): Promise<boolean> {
  const normalized = commandLine.trim();
  if (!/^\/[^\s/]+(?:\s[^\r\n]*)?$/.test(normalized)) {
    ctx.ui.notify(`Ungültiger Slash-Aufruf: ${commandLine}`, "error");
    return false;
  }
  const ui = slashCommandUi(ctx);
  if (!ui) {
    ctx.ui.notify(
      "Die direkte Command-Ausführung fehlt in der Pi-Runtime. Führe den versionierten Runtime-Patch aus und prüfe /setup-doctor.",
      "error",
    );
    return false;
  }

  const draft = ctx.ui.getEditorText();
  if (
    effect !== "preserve-draft" &&
    draft.trim() &&
    !(await ctx.ui.confirm(
      effect === "starts-turn" ? "Textentwurf verwerfen?" : "Sitzung wechseln?",
      `Im Eingabefeld steht noch Text. Soll er verworfen und ${normalized} ausgeführt werden?`,
    ))
  ) {
    return false;
  }

  await ui.submitSlashCommand(normalized);
  if (effect === "preserve-draft") ctx.ui.setEditorText(draft);
  return true;
}
