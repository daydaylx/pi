/**
 * Unit coverage for createVerifierTicket's Need-Gate provenance fields
 * (Phase 4). Uses the shared harness's default cwd (this repo's own root,
 * which genuinely has agents/verifier.md) so readVerifierAgent resolves a
 * real agent config instead of a fabricated fixture.
 */
import { assert, eq, test, counters as summary } from "./shared/assertions.mjs";
import { importModule as load } from "./shared/jiti-loader.mjs";
import { createHarness } from "./shared/harness.mjs";
import { ROOT } from "./shared/jiti-loader.mjs";

const verifierTicket = await load("extensions/setup-core/verifier-ticket.ts");

function makeCtx(overrides = {}) {
  const harness = createHarness({
    models: {
      "main-provider/main-model": {
        provider: "main-provider",
        id: "main-model",
      },
    },
  });
  return harness.makeContext({ cwd: ROOT, ...overrides });
}

function snapshot(changedFiles) {
  return { changedFiles, fingerprint: "fp-test" };
}

function verifierEvent(task, toolCallId = "call-1") {
  return {
    toolCallId,
    toolName: "subagent",
    input: { agent: "verifier", task },
  };
}

const LOW_RISK_TASK = "Original User Request: irrelevant für diesen Test.";
const HARD_PATH_FILE = "extensions/permissions/guards.ts";
const VERIFY_SPEC = {
  objective: "Verify the permission boundary change.",
  delegationReason: "The requested change touches a required verifier path.",
  profile: "verify",
  verification: {
    originalRequest: "Change the permission boundary safely.",
    delegatedQuestion: "Check the implementation against the request.",
    diff: "The permission guard was changed.",
    baseline: "The workspace was clean before the task.",
    acceptance: "The hard-path diff has a bound verifier result.",
  },
};

await test("a low-risk diff produces a not_needed ticket with no path hits", () => {
  const ticket = verifierTicket.createVerifierTicket(
    verifierEvent(LOW_RISK_TASK),
    makeCtx(),
    snapshot(["README.md"]),
    1,
  );
  assert(ticket !== undefined, "a resolvable verifier agent produces a ticket");
  eq(ticket.riskClass, "not_needed", "no hard path, no trigger");
  eq(
    ticket.trigger,
    "no_trigger",
    "reason code names the absence of a trigger",
  );
  eq(ticket.requiredPathHits, [], "no hits recorded");
  eq(
    ticket.triggerEvidence,
    undefined,
    "no evidence without a justified trigger",
  );
});

await test("a temporary verify spec is recognized before policy rewriting", () => {
  const event = {
    toolCallId: "spec-call-1",
    toolName: "subagent",
    input: { spec: VERIFY_SPEC },
  };
  assert(
    verifierTicket.isVerifierSingleCall(event),
    "setup-core must prebind a ticket while the tool input is still spec.profile=verify",
  );
  eq(
    verifierTicket.verifierSingleCallIssue(event),
    undefined,
    "a valid single verify spec is not rejected by the legacy shape check",
  );
});

await test("a hard-path diff produces a required ticket with the hit recorded", () => {
  const ticket = verifierTicket.createVerifierTicket(
    verifierEvent(LOW_RISK_TASK),
    makeCtx(),
    snapshot([HARD_PATH_FILE, "README.md"]),
    1,
  );
  assert(ticket !== undefined);
  eq(ticket.riskClass, "required", "hard path forces required");
  eq(ticket.trigger, "hard_path", "reason code names the hard path");
  eq(
    ticket.requiredPathHits.map((hit) => hit.path),
    [HARD_PATH_FILE],
    "only the actual hard-path file is recorded as a hit",
  );
});

await test("a justified trigger with evidence is recorded, including the evidence text", () => {
  const task = [
    LOW_RISK_TASK,
    "## Optional verifier trigger\ntrigger: uncovered_behavior\nevidence: LSP range math lacks a multi-byte offset test.",
  ].join("\n\n");
  const ticket = verifierTicket.createVerifierTicket(
    verifierEvent(task),
    makeCtx(),
    snapshot(["extensions/lsp/range-edit.ts"]),
    1,
  );
  assert(ticket !== undefined);
  eq(ticket.riskClass, "justified");
  eq(ticket.trigger, "uncovered_behavior");
  eq(
    ticket.triggerEvidence,
    "LSP range math lacks a multi-byte offset test.",
    "evidence text is carried onto the ticket for later provenance lookups",
  );
});

await test("ticketSnapshot() carries every Need-Gate field through unchanged", () => {
  const ticket = verifierTicket.createVerifierTicket(
    verifierEvent(LOW_RISK_TASK),
    makeCtx(),
    snapshot([HARD_PATH_FILE]),
    1,
  );
  const projected = verifierTicket.ticketSnapshot(ticket);
  eq(projected.riskClass, ticket.riskClass);
  eq(projected.trigger, ticket.trigger);
  eq(projected.triggerEvidence, ticket.triggerEvidence);
  eq(projected.requiredPathHits, ticket.requiredPathHits);
  assert(
    projected.requiredPathHits !== ticket.requiredPathHits,
    "the projection copies the array rather than sharing the frozen ticket's reference",
  );
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
