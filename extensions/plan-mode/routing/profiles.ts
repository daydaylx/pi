/**
 * Routing profile resolution.
 *
 * Profile identifiers only — never model names. The mapping from a profile
 * label to a concrete model from settings.enabledModels stays Pi-native and
 * global. Reviewpflicht/Planungsbedarf are NOT part of a profile: they are
 * derived in decide.ts, so a missing or invalid profile can never silently
 * drop a required review.
 */
import type {
  RoutingLevel,
  RoutingProfileConfig,
  RoutingProfilesConfig,
} from "./types.ts";

/**
 * Dokumentierte Built-in-Profile (Bezeichner, keine Modellnamen). Greifen als
 * letzter dokumentierter Fallback, wenn setup.json keine routingProfiles
 * deklariert oder ein Eintrag ungültig ist.
 */
export const DEFAULT_ROUTING_PROFILES: RoutingProfilesConfig = {
  levels: {
    low: { worker: "coding-schnell" },
    standard: {
      planner: "planung",
      worker: "coding",
      reviewer: "review",
    },
    high: {
      planner: "planung-premium",
      worker: "coding",
      reviewer: "review-premium",
    },
  },
};

/**
 * Liefert die Profil-Bezeichner für eine Stufe. Fällt dokumentiert auf die
 * Built-in-Profile zurück, wenn die Konfiguration fehlt oder der Eintrag
 * ungültig ist (worker-Bezeichner muss vorhanden und nichtleer sein).
 */
export function resolveProfiles(
  level: RoutingLevel,
  config: RoutingProfilesConfig | undefined,
): RoutingProfileConfig {
  const configured = config?.levels?.[level];
  if (
    configured &&
    typeof configured.worker === "string" &&
    configured.worker.trim().length > 0
  ) {
    return configured;
  }
  return DEFAULT_ROUTING_PROFILES.levels[level];
}
