import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const PI_RUNTIME_PACKAGE = "@earendil-works/pi-coding-agent";

function packageRoot(candidate) {
  let current = path.resolve(candidate);
  if (existsSync(current) && !lstatSync(current).isDirectory()) {
    current = path.dirname(current);
  }
  while (true) {
    const manifest = path.join(current, "package.json");
    if (existsSync(manifest)) {
      try {
        if (
          JSON.parse(readFileSync(manifest, "utf8")).name === PI_RUNTIME_PACKAGE
        )
          return current;
      } catch {
        // Continue walking: an unrelated or malformed package is not Pi.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function executableFromPath(name, env) {
  for (const entry of (env.PATH ?? "").split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Resolve the runtime Pi actually starts. Development dependencies are never
 * candidates: only an explicit root, PI_RUNTIME_ROOT, the `pi` executable on
 * PATH, or the configured user's installed runtime can select a runtime.
 */
export function resolveRuntimeRoot({ runtime, env = process.env } = {}) {
  const explicit = runtime ?? env.PI_RUNTIME_ROOT;
  if (explicit) {
    const root = packageRoot(explicit);
    if (root)
      return { root, source: runtime ? "--runtime" : "PI_RUNTIME_ROOT" };
    throw new Error(
      `Keine Pi-Runtime unter ${path.resolve(explicit)}. Übergib den Paketwurzelpfad mit --runtime oder PI_RUNTIME_ROOT.`,
    );
  }

  const executable = executableFromPath("pi", env);
  if (executable) {
    try {
      const root = packageRoot(realpathSync(executable));
      if (root) return { root, source: "pi auf PATH" };
    } catch {
      // Fall through to the explicit, actionable error below.
    }
  }

  // A `pi` profile launcher can be first on PATH. If it is not itself inside
  // the runtime package, resolve the user's configured installation rather
  // than treating the wrapper as a Pi runtime or selecting development deps.
  const agentDir =
    env.PI_CODING_AGENT_DIR || path.join(env.HOME || homedir(), ".pi", "agent");
  const installedPackage = path.join(
    agentDir,
    "npm",
    "node_modules",
    PI_RUNTIME_PACKAGE,
  );
  try {
    const root = packageRoot(realpathSync(installedPackage));
    if (root) return { root, source: "PI_CODING_AGENT_DIR" };
  } catch {
    // Keep the existing actionable failure below if no installed runtime exists.
  }
  throw new Error(
    "Pi-Runtime konnte nicht eindeutig ermittelt werden. Übergib --runtime <pfad> oder setze PI_RUNTIME_ROOT auf die Wurzel von @earendil-works/pi-coding-agent.",
  );
}
