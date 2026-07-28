/**
 * Model control (Super+M and the Hauptmenü "Modelle" entry).
 *
 * Lists what the registry actually offers and applies the choice through
 * pi.setModel. The retired scoped-model overlay is NOT restored here.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export async function openModelMenu(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  // Never swap the model out from under a running turn.
  if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
    ctx.ui.notify(
      "Der Agent arbeitet gerade. Ein Modellwechsel ist erst danach möglich.",
      "warning",
    );
    return;
  }
  const available = [...ctx.modelRegistry.getAvailable()].sort((left, right) =>
    `${left.provider}/${left.id}`.localeCompare(
      `${right.provider}/${right.id}`,
    ),
  );
  if (available.length === 0) {
    ctx.ui.notify("Keine Modelle verfügbar.", "warning");
    return;
  }
  const activeModel = ctx.model
    ? `${ctx.model.provider}/${ctx.model.id}`
    : undefined;
  const labels = available.map((model) => {
    const reference = `${model.provider}/${model.id}`;
    return reference === activeModel ? `● ${reference}` : `  ${reference}`;
  });
  const choice = await ctx.ui.select("Modell wählen", labels);
  if (!choice) return;
  const picked = available.find((model) =>
    choice.endsWith(`${model.provider}/${model.id}`),
  );
  if (picked) pi.setModel(picked);
}
