/**
 * Preparing the isolated run worktree.
 *
 * Credentials are symlinked, never read or copied, and only for the lifetime of
 * one run. The config fingerprint records what the run actually saw so a score
 * can be traced back to an exact configuration.
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { agentModule, runtimePackagePath } from "./agent.mjs";
import {
  CONFIG_FILES,
  PI_MODEL,
  PI_THINKING,
  REFERENCE,
  SECRET_LINK_NAMES,
  SOURCE_ROOT,
  benchmarkEnvironmentOverrides,
} from "./config.mjs";
import { fail, runGit, sha256File } from "./io.mjs";

export function configFingerprint(
  worktree,
  benchmarkOverlays,
  benchmarkEnvironmentOverrides,
) {
  const files = CONFIG_FILES.map((path) => ({
    path,
    sha256: sha256File(join(worktree, path)),
  }));
  const configHash = createHash("sha256")
    .update(files.map((file) => `${file.path}\0${file.sha256}\n`).join(""))
    .digest("hex");
  const entrypoint = agentModule();
  const runtimePackage = runtimePackagePath(entrypoint);
  const runtime = JSON.parse(readFileSync(runtimePackage, "utf8"));
  return {
    reference: REFERENCE,
    model: PI_MODEL,
    thinking: PI_THINKING,
    configHash,
    configFiles: files,
    benchmarkOverlays,
    benchmarkEnvironmentOverrides,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      piPackageVersion: runtime.version,
      piPackageFingerprint: sha256File(runtimePackage),
      piEntrypointFingerprint: sha256File(entrypoint),
    },
  };
}

export function createCredentialLinks(worktree) {
  for (const name of SECRET_LINK_NAMES) {
    const destination = join(worktree, name);
    if (existsSync(destination))
      fail(`Refusing to replace existing worktree file '${name}'.`);
    // Do not inspect either file: symlink creation is the only credential I/O.
    symlinkSync(join(SOURCE_ROOT, name), destination);
  }
}

export function removeCredentialLinks(worktree) {
  for (const name of SECRET_LINK_NAMES) {
    const destination = join(worktree, name);
    let stat;
    try {
      stat = lstatSync(destination);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink())
      fail(`Refusing to remove non-symlink '${name}' from P3 worktree.`);
    rmSync(destination, { force: true });
  }
}

export function linkRuntimeDependencies(worktree) {
  const sourceModules = join(SOURCE_ROOT, "npm", "node_modules");
  const destination = join(worktree, "npm", "node_modules");
  if (!existsSync(sourceModules))
    fail("P3 requires npm/node_modules in the source checkout.");
  if (existsSync(destination))
    fail("Refusing to replace an existing worktree npm/node_modules path.");
  symlinkSync(sourceModules, destination);
}

export function stageHarnessInput(worktree, path) {
  runGit(["add", "--force", "--", path], { cwd: worktree });
}

export function stageWorktreePackageManifest(worktree) {
  const packagePath = join(worktree, "package.json");
  if (!existsSync(packagePath)) {
    writeFileSync(packagePath, '{"private":true,"type":"module"}\n', {
      encoding: "utf8",
      mode: 0o600,
    });
    stageHarnessInput(worktree, "package.json");
  }
  return { path: "package.json", sha256: sha256File(packagePath) };
}

export function stageWorktreePermissionOverlay(worktree) {
  // P3 measures task completion, so every isolated worktree starts with the
  // same explicit write-capable workflow default. The source checkout is
  // never changed; the effective setup.json hash is recorded with the run.
  const setupPath = join(worktree, "setup.json");
  const setup = JSON.parse(readFileSync(setupPath, "utf8"));
  if (!setup.permissions || typeof setup.permissions !== "object") {
    fail("P3 setup.json is missing its permissions configuration.");
  }
  const defaults = setup.permissions.workflowDefaults;
  if (!defaults || typeof defaults !== "object") {
    fail("P3 setup.json is missing permissions.workflowDefaults.");
  }
  for (const mode of ["work", "simple_plan", "detailed_plan"]) {
    defaults[mode] = "full-access";
  }
  writeFileSync(setupPath, `${JSON.stringify(setup, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  stageHarnessInput(worktree, "setup.json");
  return { path: "setup.json", sha256: sha256File(setupPath) };
}
