/**
 * Compact footer status for the LSP extension (issue #97).
 *
 * The status key is defined locally, not added to the shared
 * `ZENTUI_STATUS_KEYS` in `shared/workflow-status.ts` — an existing test
 * there pins that object to exactly `{permissions, workflow}`, and LSP has
 * no reason to share that registry.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setTuiStatus } from "../shared/workflow-status.ts";
import type { LspClientState } from "./client.ts";
import type { LspConfig } from "./types.ts";

export const LSP_STATUS_KEY = "lsp";

export type LspFooterState =
  "aus" | "leerlauf" | "eingeschränkt" | `${number} aktiv`;

export interface RegistryEntrySnapshot {
  state: LspClientState;
}

/**
 * Pure derivation from config + a registry snapshot — no side effects, so it
 * is trivially unit-testable without a fake `pi`/`ctx`.
 */
export function computeLspStatus(
  config: LspConfig,
  entries: RegistryEntrySnapshot[],
): LspFooterState {
  if (!config.enabled || config.mode === "off") return "aus";
  if (entries.some((e) => e.state === "degraded")) return "eingeschränkt";
  const active = entries.filter((e) => e.state === "ready").length;
  return active > 0 ? (`${active} aktiv` as const) : "leerlauf";
}

/** TUI-only, like every other footer status key in this repo. */
export function publishLspStatus(
  ctx: ExtensionContext,
  state: LspFooterState | undefined,
): void {
  setTuiStatus(ctx, LSP_STATUS_KEY, state);
}
