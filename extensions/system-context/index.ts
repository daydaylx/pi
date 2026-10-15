import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getPiLaunchProfile } from "../shared/profile.ts";
import {
  categoriesForRequest,
  collectSystemContext,
  discoverConfigRoot,
  formatSystemContext,
  systemSkillContext,
} from "./collector.mjs";

const BASE_CONTEXT_TTL_MS = 30_000;

export function registerSystemContext(
  pi: ExtensionAPI,
  options: {
    profile?: () => "project" | "system";
    collect?: typeof collectSystemContext;
    discoverConfig?: typeof discoverConfigRoot;
    now?: () => number;
  } = {},
): void {
  const profile = options.profile ?? getPiLaunchProfile;
  if (profile() !== "system") return;

  const collect = options.collect ?? collectSystemContext;
  const discoverConfig = options.discoverConfig ?? discoverConfigRoot;
  const now = options.now ?? Date.now;
  let baseContext: ReturnType<typeof collectSystemContext> | undefined;
  let baseContextExpiresAt = 0;

  pi.on("session_start", () => {
    baseContext = undefined;
    baseContextExpiresAt = 0;
  });

  pi.on("before_agent_start", (event, ctx: ExtensionContext) => {
    // Context categories are derived from the user's prompt; a run started by
    // an extension message has none and gets the base context only.
    const request = event.messageType === "custom" ? "" : event.prompt;
    const instant = now();
    const configRevision = discoverConfig({ cwd: ctx.cwd })?.revision;
    const cachedRevision = baseContext?.system?.configuration?.revision;
    if (
      !baseContext ||
      instant >= baseContextExpiresAt ||
      configRevision !== cachedRevision
    ) {
      baseContext = collect(["system"], { cwd: ctx.cwd });
      baseContextExpiresAt = instant + BASE_CONTEXT_TTL_MS;
    }
    const extraCategories = categoriesForRequest(request).filter(
      (category) => category !== "system",
    );
    const extraContext = extraCategories.length
      ? collect(extraCategories, { cwd: ctx.cwd })
      : undefined;
    const merged = extraContext
      ? { ...baseContext, ...extraContext }
      : baseContext;
    const skillContext = systemSkillContext(extraCategories);
    return {
      systemPrompt: [
        event.systemPrompt,
        formatSystemContext(merged),
        skillContext,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  });
}

export default function systemContextExtension(pi: ExtensionAPI): void {
  registerSystemContext(pi);
}
