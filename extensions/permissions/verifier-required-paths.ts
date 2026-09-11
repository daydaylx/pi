/**
 * Small, conservative set of paths for the automatic HARD_VERIFIER_REQUIRED
 * commit gate.
 *
 * An empty match is VERIFIER_OPTIONAL: the main agent still may choose an
 * independent check when the actual diff or the user's request makes it wise.
 * The list intentionally names security/state/contract entry points instead of
 * treating every file in a broad subsystem as critical. In particular,
 * package manifests and the RPC process manager are not reliable indicators of
 * install or trust-boundary risk by path alone.
 *
 * This is deliberately not a semantic diff classifier. The main agent remains
 * responsible for risk that cannot be established from a changed path, such as
 * a runtime dependency change inside a package manifest or a public contract
 * added outside the known protocol modules.
 */

interface RequiredPathRule {
  category: string;
  test: (relativePath: string) => boolean;
}

function oneOf(...paths: string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

const RULES: RequiredPathRule[] = [
  {
    category: "Permission-, Workflow- oder Plan-Mode-Logik",
    test: oneOf(
      "extensions/mode-permissions.ts",
      "extensions/permissions/guards.ts",
      "extensions/permissions/session-state.ts",
      "extensions/permissions/tool-event.ts",
      "extensions/permissions/tool-policy.ts",
      "extensions/permissions/web-tools.ts",
      "extensions/permissions/workflow-policy.ts",
      "extensions/shared/permission-policy.ts",
      "extensions/shared/recovery-capabilities.ts",
      "extensions/shared/verification-capabilities.ts",
      "extensions/shared/workflow-capabilities.ts",
      "extensions/shared/workflow-mode.ts",
      "extensions/shared/workflow-status.ts",
    ),
  },
  {
    category: "Kritischer Workflow-/Recovery-State",
    test: oneOf(
      "extensions/plan-mode/command-center.ts",
      "extensions/plan-mode/commands.ts",
      "extensions/plan-mode/events.ts",
      "extensions/plan-mode/index.ts",
      "extensions/plan-mode/plan-context.ts",
      "extensions/plan-mode/plan-editor.ts",
      "extensions/plan-mode/plan-store.ts",
      "extensions/plan-mode/plan-tool.ts",
      "extensions/plan-mode/session.ts",
      "extensions/resilience/index.ts",
      "extensions/resilience/recovery-state.ts",
      "extensions/resilience/types.ts",
    ),
  },
  {
    category: "Verifikations- oder Completion-Logik",
    test: oneOf(
      "extensions/permissions/verifier-policy.ts",
      "extensions/permissions/verifier-required-paths.ts",
      "extensions/setup-core/config.ts",
      "extensions/setup-core/index.ts",
      "extensions/setup-core/verification-status.ts",
      "extensions/setup-core/subagent-output-guard.ts",
      "extensions/setup-core/verify-profiles.ts",
      ".pi/verify.json",
    ),
  },
  {
    category: "Sicherheitsverhalten (Electron-Trust-Grenze)",
    test: oneOf(
      "gui/main/index.js",
      "gui/main/ipc-handlers.js",
      "gui/main/preload.cjs",
    ),
  },
  {
    category: "Öffentlicher API-/Protokollvertrag",
    test: oneOf(
      "extensions/frontend-protocol/commands.ts",
      "extensions/frontend-protocol/compatibility.ts",
      "extensions/frontend-protocol/events.ts",
      "extensions/frontend-protocol/state-bus.ts",
      "extensions/frontend-protocol/state-contract.ts",
      "extensions/frontend-protocol/state-helpers.ts",
    ),
  },
  {
    category: "Installations- oder Upgrade-Verhalten",
    test: oneOf(
      "bin/pi",
      "bin/pi-gui",
      "extensions/setup-core/dependency-prepare.ts",
      "scripts/apply-runtime-patches.mjs",
      "scripts/install-user.mjs",
      "scripts/package-gui.mjs",
    ),
  },
];

/** The first matching category for one path, if any. */
export function matchesVerifierRequiredPath(
  relativePath: string,
): string | undefined {
  return RULES.find((rule) => rule.test(relativePath))?.category;
}

export interface VerifierRequiredPathHit {
  path: string;
  category: string;
}

/** All changed paths that hit a mandatory category, each with its category. */
export function matchingVerifierRequiredPaths(
  relativePaths: readonly string[],
): VerifierRequiredPathHit[] {
  const hits: VerifierRequiredPathHit[] = [];
  for (const path of relativePaths) {
    const category = matchesVerifierRequiredPath(path);
    if (category) hits.push({ path, category });
  }
  return hits;
}
