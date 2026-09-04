/**
 * The eval suite scores plans with the *same* requirement check the product
 * enforces, loaded through the shared jiti loader. Re-implementing it here
 * would let the two drift, and a scoring rule that no longer matches the
 * shipped gate measures nothing.
 */
import { importModule } from "../shared/jiti-loader.mjs";

const quality = await importModule("extensions/plan-mode/plan-quality.ts");

export function assessPlanQuality(mode, plan) {
  if (!quality) return { ok: false, issues: [{ code: "unavailable", message: "plan-quality konnte nicht geladen werden." }] };
  return quality.assessPlanQuality(mode, plan);
}
