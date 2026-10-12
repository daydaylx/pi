/** A launch profile describes context and presentation, never authorization. */
export type PiLaunchProfile = "project" | "system";

export function getPiLaunchProfile(
  env: NodeJS.ProcessEnv = process.env,
): PiLaunchProfile {
  return env.PI_LAUNCH_PROFILE === "system" ? "system" : "project";
}
