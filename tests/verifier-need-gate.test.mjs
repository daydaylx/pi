/**
 * Integration-level regression tests for the Need-Gate (Phase 3): both the
 * legacy `agent: "verifier"` path and the `spec.profile: "verify"` rewrite
 * must reach the same assessVerifierNeed decision, and neither can bypass
 * it. Complements tests/verifier-risk.test.mjs (pure function only) and the
 * dedup-fixture updates in tests/permissions.test.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, eq, test, counters as summary } from "./shared/assertions.mjs";
import { importModule as load } from "./shared/jiti-loader.mjs";

const verifierPolicy = await load("extensions/permissions/verifier-policy.ts");
const temporaryAgentPolicy = await load(
  "extensions/permissions/temporary-agent-policy.ts",
);

function initFixtureRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-verifier-need-gate-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.test"], { cwd });
  execFileSync("git", ["config", "user.name", "Test"], { cwd });
  writeFileSync(join(cwd, "README.md"), "docs\n");
  execFileSync("git", ["add", "README.md"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd });
  return cwd;
}

const LOW_RISK_TASK = [
  "## Original User Request\nDen Auftrag umsetzen.",
  "## Delegated Question\nErfüllt der Diff den Auftrag?",
  "## Implementation / Diff to verify\n<relevanter Diff>",
  "## Baseline (Pre-existing workspace state)\nclean",
  "## Acceptance Criteria\nproject_check verify besteht.",
].join("\n\n");

const specVerification = (extra = {}) => ({
  originalRequest: "Den Auftrag umsetzen.",
  delegatedQuestion: "Erfüllt der Diff den Auftrag?",
  diff: "<relevanter Diff>",
  baseline: "clean",
  acceptance: "project_check verify besteht.",
  ...extra,
});

const specCall = (verification, extra = {}) => ({
  toolName: "subagent",
  input: {
    spec: {
      profile: "verify",
      objective: "Diff prüfen",
      delegationReason: "unabhängige Prüfung",
      verification,
    },
    ...extra,
  },
});

await test("T18 — legacy verifier call with no hard path and no trigger is not_needed", async () => {
  const cwd = initFixtureRepo();
  try {
    const result = await verifierPolicy.assessVerifierDelegation(
      {
        toolName: "subagent",
        input: { agent: "verifier", task: LOW_RISK_TASK },
      },
      cwd,
      {},
    );
    assert(result.blocked, "Need-Gate blocks a low-risk legacy delegation");
    assert(
      result.reason.includes("not_needed") ||
        result.reason.includes("no_trigger"),
      "reason names the Need-Gate decision",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("T19 — spec verify call with no hard path and no trigger is not_needed", async () => {
  const cwd = initFixtureRepo();
  try {
    const rewrite = temporaryAgentPolicy.rewriteVerifySpecToVerifier(
      specCall(specVerification()),
    );
    eq(rewrite.kind, "rewritten", "a complete verify spec rewrites cleanly");
    const result = await verifierPolicy.assessVerifierDelegation(
      { toolName: "subagent", input: rewrite.input },
      cwd,
      {},
    );
    assert(
      result.blocked,
      "Need-Gate blocks the rewritten low-risk spec call too",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("T20 — legacy verifier call touching a hard path is allowed", async () => {
  const cwd = initFixtureRepo();
  try {
    execFileSync("mkdir", ["-p", join(cwd, "extensions/permissions")]);
    writeFileSync(
      join(cwd, "extensions/permissions/guards.ts"),
      "// changed\n",
    );
    const result = await verifierPolicy.assessVerifierDelegation(
      {
        toolName: "subagent",
        input: { agent: "verifier", task: LOW_RISK_TASK },
      },
      cwd,
      {},
    );
    assert(
      !result.blocked,
      "a hard-path diff is allowed even without a trigger",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("T21 — spec verify call touching a hard path is allowed", async () => {
  const cwd = initFixtureRepo();
  try {
    execFileSync("mkdir", ["-p", join(cwd, "extensions/permissions")]);
    writeFileSync(
      join(cwd, "extensions/permissions/guards.ts"),
      "// changed\n",
    );
    const rewrite = temporaryAgentPolicy.rewriteVerifySpecToVerifier(
      specCall(specVerification()),
    );
    eq(rewrite.kind, "rewritten", "a complete verify spec rewrites cleanly");
    const result = await verifierPolicy.assessVerifierDelegation(
      { toolName: "subagent", input: rewrite.input },
      cwd,
      {},
    );
    assert(
      !result.blocked,
      "a hard-path diff is allowed via the spec path too",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("T06 — spec verify call with a valid trigger+evidence is allowed (justified)", async () => {
  const cwd = initFixtureRepo();
  try {
    const rewrite = temporaryAgentPolicy.rewriteVerifySpecToVerifier(
      specCall(
        specVerification({
          trigger: "uncovered_behavior",
          triggerEvidence: "LSP range math has no multi-byte offset test.",
        }),
      ),
    );
    eq(rewrite.kind, "rewritten", "a valid trigger still rewrites cleanly");
    assert(
      rewrite.input.task.includes("## Optional verifier trigger"),
      "the rendered task carries the trigger section",
    );
    const result = await verifierPolicy.assessVerifierDelegation(
      { toolName: "subagent", input: rewrite.input },
      cwd,
      {},
    );
    assert(!result.blocked, "a justified trigger permits the run");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("T07 — spec verify call with a trigger but empty evidence is rejected at the schema layer", () => {
  const rewrite = temporaryAgentPolicy.rewriteVerifySpecToVerifier(
    specCall(
      specVerification({
        trigger: "uncovered_behavior",
        triggerEvidence: "   ",
      }),
    ),
  );
  eq(
    rewrite.kind,
    "blocked",
    "empty evidence is rejected before it ever reaches the Need-Gate",
  );
});

await test("T08 — spec verify call with an unknown trigger is rejected fail-closed", () => {
  const rewrite = temporaryAgentPolicy.rewriteVerifySpecToVerifier(
    specCall(
      specVerification({
        trigger: "better_safe_than_sorry",
        triggerEvidence: "just in case",
      }),
    ),
  );
  eq(rewrite.kind, "blocked", "an unrecognized trigger id is fail-closed");
});

await test("legacy path cannot bypass the schema-layer trigger validation the spec path enforces", async () => {
  const cwd = initFixtureRepo();
  try {
    // A legacy caller can hand-write a trigger section directly — but an
    // unrecognized trigger id must still be ignored (fail-closed to
    // not_needed), exactly as a rejected spec never reaches the Need-Gate.
    const task = [
      LOW_RISK_TASK,
      "## Optional verifier trigger\ntrigger: better_safe_than_sorry\nevidence: just in case",
    ].join("\n\n");
    const result = await verifierPolicy.assessVerifierDelegation(
      { toolName: "subagent", input: { agent: "verifier", task } },
      cwd,
      {},
    );
    assert(
      result.blocked,
      "an unknown trigger id never justifies a run, on either path",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Main cannot escalate an optional trigger into required", () => {
  const rewrite = temporaryAgentPolicy.rewriteVerifySpecToVerifier(
    specCall(
      specVerification({
        trigger: "user_requested",
        triggerEvidence: "user asked in the previous turn",
        required: true,
      }),
    ),
  );
  // `required` is not part of the spec.verification contract at all — an
  // extra field is simply ignored by the rewrite, never elevated to REQUIRED.
  eq(rewrite.kind, "rewritten", "the extra field is ignored, not honored");
  assert(
    !("required" in rewrite.input) && rewrite.input.agent === "verifier",
    "the rewritten input carries no required flag the executor could read",
  );
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
