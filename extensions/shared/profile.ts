import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** A launch profile describes context and presentation, never authorization. */
export type PiLaunchProfile = "project" | "system";

export function getPiLaunchProfile(
  env: NodeJS.ProcessEnv = process.env,
): PiLaunchProfile {
  return env.PI_LAUNCH_PROFILE === "system" ? "system" : "project";
}

/**
 * True when Pi runs behind a frontend host (pi-system-host, GUI) that forwards
 * extension UI requests to a person. Such a session has a real confirm channel
 * even though `ctx.mode` is not "tui", so risky actions can ask instead of
 * being denied outright as in the channel-less headless level.
 */
export function hasFrontendConfirmChannel(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.PI_FRONTEND_RPC === "1";
}

/**
 * Return the launcher's private System workspace only when the live working
 * directory, launcher marker and configured profile-state path resolve to the
 * same owned, private directory. The profile name on its own is not a grant.
 */
export function resolveSystemWorkspaceRoot(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (getPiLaunchProfile(env) !== "system") return undefined;
  const configuredWorkspace = env.PI_SYSTEM_WORKSPACE;
  if (!configuredWorkspace || !isAbsolute(configuredWorkspace))
    return undefined;

  const agentDir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  if (!isAbsolute(agentDir)) return undefined;
  const expectedWorkspace = join(
    agentDir,
    "profile-state",
    "system",
    "workspace",
  );
  const privateDirectories = [
    join(agentDir, "profile-state"),
    join(agentDir, "profile-state", "system"),
    expectedWorkspace,
  ];
  const expectedUid =
    typeof process.getuid === "function" ? process.getuid() : undefined;

  try {
    for (const directory of privateDirectories) {
      const entry = lstatSync(directory);
      if (
        entry.isSymbolicLink() ||
        !entry.isDirectory() ||
        (entry.mode & 0o077) !== 0 ||
        (expectedUid !== undefined && entry.uid !== expectedUid)
      ) {
        return undefined;
      }
    }
    const canonicalExpected = realpathSync(expectedWorkspace);
    const canonicalConfigured = realpathSync(configuredWorkspace);
    const canonicalCwd = realpathSync(cwd);
    return canonicalExpected === canonicalConfigured &&
      canonicalExpected === canonicalCwd
      ? canonicalExpected
      : undefined;
  } catch {
    return undefined;
  }
}
