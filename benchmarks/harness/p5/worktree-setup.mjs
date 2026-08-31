/**
 * P5-specific worktree setup, layered on top of the reused, unmodified
 * `prepareP4Worktree`/`disposeP4Worktree` isolation primitives from
 * p4-controller.mjs.
 *
 * Two additions, both harness-relevant:
 *
 * 1. `linkNpmNodeModules` — `prepareP4Worktree`'s independent shallow-fetch
 *    worktree has no `npm/node_modules` (unlike the older `git worktree add`
 *    path in reset-task.sh, which symlinks it in). Every fixture task's
 *    `benchmark-fixture/run-fixture-test.mjs` resolves `npm/node_modules/jiti`
 *    by walking up from its own location (see the fixture script itself),
 *    and both harnesses may run `npm run verify`/the fixture test themselves
 *    while working the task — so this must exist from the very start of the
 *    worktree, for both harnesses, not only at final evaluation time.
 *    `npm/node_modules` is gitignored (see npm/.gitignore's `*` rule with no
 *    `!node_modules` exception), so the symlink never shows up in
 *    `collectWorkspaceSnapshot`'s git-status-based diff.
 *
 * 2. `applyP5PiOverlay` — pins the Pi harness's `settings.json` (main model,
 *    investigator/debugger overrides, disabled verifier, modelScope allow-
 *    list, no pi-web-access package) inside the isolated worktree only. The
 *    real `/home/d/.pi/agent/settings.json` is never touched. Because
 *    `settings.json` is a tracked file, an uncommitted overlay edit would
 *    otherwise show up as an "agent change" in `inspectAgentChanges` on
 *    every single run — so, exactly like `prepareP4Worktree`'s own internal
 *    setup commit, this overlay is folded into one additional P5 setup
 *    commit rather than left staged or unstaged.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function linkNpmNodeModules(worktree, sourceRoot) {
  const target = join(sourceRoot, "npm", "node_modules");
  if (!existsSync(target)) {
    process.stderr.write(
      `Warnung: ${target} fehlt — vorher 'npm ci --prefix npm' im Haupt-Checkout ausführen. Fixture-Tests, die jiti benötigen, schlagen sonst fehl.\n`,
    );
    return false;
  }
  mkdirSync(join(worktree, "npm"), { recursive: true });
  symlinkSync(target, join(worktree, "npm", "node_modules"), "dir");
  return true;
}

export function applyP5PiOverlay(worktree, manifest) {
  const settingsPath = join(worktree, "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const pi = manifest.harnesses.pi;
  const modelId = `${pi.provider}/${pi.model}`;

  settings.defaultProvider = pi.provider;
  settings.defaultModel = pi.model;
  settings.defaultThinkingLevel = pi.thinking;

  settings.subagents = settings.subagents ?? {};
  settings.subagents.agentOverrides = {
    ...settings.subagents.agentOverrides,
    investigator: { model: modelId, thinking: pi.thinking },
    debugger: { model: modelId, thinking: pi.thinking },
    verifier: { enabled: false },
  };
  const existingAllow = settings.subagents.modelScope?.allow ?? [];
  settings.subagents.modelScope = {
    enforce: true,
    allow: existingAllow.includes(modelId)
      ? existingAllow
      : [...existingAllow, modelId],
  };

  // Core-Parity (Modus A) requires no web access on either side; Codex's
  // workspace-write sandbox blocks it at the OS level, Pi only via the
  // absence of this extension package (see METHODOLOGY.md, known confounder).
  settings.packages = (settings.packages ?? []).filter(
    (pkg) => !pkg.startsWith("npm:pi-web-access"),
  );

  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  git(worktree, ["add", "settings.json"]);
  const staged = git(worktree, ["diff", "--cached", "--name-only"]);
  if (staged.trim().length > 0) {
    git(worktree, [
      "-c",
      "user.email=p5-benchmark@localhost",
      "-c",
      "user.name=P5 Benchmark Setup",
      "commit",
      "--quiet",
      "-m",
      "P5 setup: pin Pi harness to gpt-5.6-luna, disable verifier, drop web access",
    ]);
  }
}

/**
 * @param {object} prepareWorktree the reused prepareP4Worktree function
 * @param {object} disposeWorktree the reused disposeP4Worktree function
 */
export function prepareP5Worktree({
  prepareWorktree,
  disposeWorktree,
  root,
  reference,
  taskId,
  harness,
  manifest,
}) {
  const prepared = prepareWorktree({ root, reference, taskId });
  try {
    linkNpmNodeModules(prepared.worktree, root);
    if (harness === "pi") applyP5PiOverlay(prepared.worktree, manifest);
  } catch (error) {
    disposeWorktree(prepared);
    throw error;
  }
  return prepared;
}
