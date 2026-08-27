/** Model picker: lists the OpenRouter models Pi is actually configured to use. */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { runMenu, type MenuEntry } from "../../shared/menu-ui.ts";
import { STRINGS } from "./strings.ts";

function isOpenRouterModel(model: Model<Api>): boolean {
  return model.provider === "openrouter";
}

function collectOpenRouterModels(ctx: ExtensionCommandContext): Model<Api>[] {
  const scoped = ctx.scopedModels
    .map((scopedModel) => scopedModel.model)
    .filter(isOpenRouterModel);
  if (scoped.length > 0) return scoped;
  return ctx.modelRegistry.getAvailable().filter(isOpenRouterModel);
}

/** Shows the configured-OpenRouter-models picker. Returns undefined if none exist or the user cancels. */
export async function pickOpenRouterModel(
  ctx: ExtensionCommandContext,
): Promise<Model<Api> | undefined> {
  const models = collectOpenRouterModels(ctx);
  if (models.length === 0) {
    ctx.ui.notify(STRINGS.noModelsConfigured, "error");
    return undefined;
  }
  const entries: MenuEntry<Model<Api>>[] = models.map((model) => ({
    id: model.id,
    label: model.id,
    value: model,
  }));
  return runMenu(ctx, STRINGS.pickerTitle, entries, {
    nonInteractiveHint: STRINGS.pickerNonInteractiveHint,
  });
}
