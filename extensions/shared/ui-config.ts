import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type UiProfile = "minimal" | "balanced" | "debug";
export type UiBannerMode = "on" | "compact" | "off";
export type UiActivityMode = "auto" | "on" | "compact" | "off" | "debug";
export type UiSubagentWidgetMode =
  | "active-only"
  | "on"
  | "off"
  | "compact"
  | "debug";
export type UiToolHistoryMode = "compact" | "full";
export type UiFooterMode = "priority" | "full" | "off";
export type UiLanguage = "de" | "en";

export interface UiConfig {
  readonly profile: UiProfile;
  readonly banner: UiBannerMode;
  readonly activity: UiActivityMode;
  readonly subagentWidget: UiSubagentWidgetMode;
  readonly toolHistory: UiToolHistoryMode;
  readonly footer: UiFooterMode;
  readonly language: UiLanguage;
  readonly reducedMotion: boolean;
}

const PROFILE_DEFAULTS: Readonly<Record<UiProfile, UiConfig>> = {
  minimal: Object.freeze({
    profile: "minimal",
    banner: "off",
    activity: "off",
    subagentWidget: "active-only",
    toolHistory: "compact",
    footer: "priority",
    language: "de",
    reducedMotion: true,
  }),
  balanced: Object.freeze({
    profile: "balanced",
    banner: "on",
    activity: "auto",
    subagentWidget: "active-only",
    toolHistory: "compact",
    footer: "priority",
    language: "de",
    reducedMotion: false,
  }),
  debug: Object.freeze({
    profile: "debug",
    banner: "on",
    activity: "debug",
    subagentWidget: "debug",
    toolHistory: "full",
    footer: "full",
    language: "de",
    reducedMotion: false,
  }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

/**
 * Validiert entweder ein direktes `ui`-Objekt oder ein vollständiges
 * settings.json-Objekt. Ungültige Felder fallen einzeln auf das gewählte
 * Profil zurück, damit ein Tippfehler nicht die gesamte Konfiguration verwirft.
 */
export function parseUiConfig(raw: unknown): UiConfig {
  const root = isRecord(raw) ? raw : {};
  const source = isRecord(root.ui) ? root.ui : root;
  const profile = oneOf(
    source.profile,
    ["minimal", "balanced", "debug"] as const,
    "balanced",
  );
  const defaults = PROFILE_DEFAULTS[profile];

  return Object.freeze({
    profile,
    banner: oneOf(
      source.banner,
      ["on", "compact", "off"] as const,
      defaults.banner,
    ),
    activity: oneOf(
      source.activity,
      ["auto", "on", "compact", "off", "debug"] as const,
      defaults.activity,
    ),
    subagentWidget: oneOf(
      source.subagentWidget,
      ["active-only", "on", "off", "compact", "debug"] as const,
      defaults.subagentWidget,
    ),
    toolHistory: oneOf(
      source.toolHistory,
      ["compact", "full"] as const,
      defaults.toolHistory,
    ),
    footer: oneOf(
      source.footer,
      ["priority", "full", "off"] as const,
      defaults.footer,
    ),
    language: oneOf(
      source.language,
      ["de", "en"] as const,
      defaults.language,
    ),
    reducedMotion:
      typeof source.reducedMotion === "boolean"
        ? source.reducedMotion
        : defaults.reducedMotion,
  });
}

const SOURCE_SETTINGS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "settings.json",
);

/**
 * Löst zuerst eine explizite Agent-Konfiguration, dann HOME und zuletzt den
 * Pfad relativ zu dieser Extension auf. Die Parameter machen die Auswahl
 * ohne Änderungen an globalen Prozesswerten testbar.
 */
export function resolveUiSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): string {
  const candidates = [
    env.PI_CODING_AGENT_DIR?.trim()
      ? path.join(env.PI_CODING_AGENT_DIR.trim(), "settings.json")
      : undefined,
    path.join(homeDirectory, ".pi", "agent", "settings.json"),
    SOURCE_SETTINGS_PATH,
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? SOURCE_SETTINGS_PATH;
}

/** Lädt die UI-Konfiguration ohne sie während der Sitzung zu verändern. */
export function loadUiConfig(): UiConfig {
  try {
    return parseUiConfig(
      JSON.parse(readFileSync(resolveUiSettingsPath(), "utf8")),
    );
  } catch {
    return parseUiConfig(undefined);
  }
}
