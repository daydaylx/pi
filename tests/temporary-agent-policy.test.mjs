import { assert, eq, test, counters as summary } from "./shared/assertions.mjs";
import { importModule as load } from "./shared/jiti-loader.mjs";

const policy = await load("extensions/permissions/temporary-agent-policy.ts");

const spec = {
  objective: "Find the cause",
  profile: "analyse",
  delegationReason: "independent analysis",
};
const call = (input) => ({ toolName: "subagent", input });
const assess = (input) => policy.assessTemporaryAgentSpec(call(input));

await test("spec guard ignores non-spec subagent calls and other tools", () => {
  assert(!assess({ agent: "investigator", task: "x" }).blocked, "role call");
  assert(
    !policy.assessTemporaryAgentSpec({ toolName: "read", input: { spec } })
      .blocked,
    "other tool",
  );
});

await test("spec guard permits a plain analyse/research spec", () => {
  assert(!assess({ spec }).blocked, "analyse");
  assert(!assess({ spec: { ...spec, profile: "research" } }).blocked, "research");
  assert(!assess({ spec, async: true }).blocked, "async run");
});

await test("spec guard refuses widening parameters", () => {
  for (const extra of [
    { agent: "verifier" },
    { task: "do it" },
    { chain: [] },
    { tasks: [] },
    { config: {} },
    { model: "prov/big" },
    { cwd: "/tmp" },
    { output: "out.md" },
    { skill: "x" },
    { context: "fork" },
    { action: "list" },
  ]) {
    const key = Object.keys(extra)[0];
    assert(assess({ spec, ...extra }).blocked, `blocks ${key}`);
  }
  assert(!assess({ spec, context: "fresh" }).blocked, "fresh context is fine");
});

await test("spec guard refuses malformed spec and unknown profile", () => {
  assert(assess({ spec: "nope" }).blocked, "string spec");
  assert(assess({ spec: [] }).blocked, "array spec");
  assert(assess({ spec: { ...spec, profile: "security" } }).blocked, "profile");
  assert(assess({ spec: { objective: "x" } }).blocked, "missing profile");
});

await test("profile verify cannot bypass the verifier ledger", () => {
  const result = assess({ spec: { ...spec, profile: "verify" } });
  assert(result.blocked, "verify spec blocked");
  assert(/verifier/.test(result.reason), "points to the verifier agent");
});

await test("capability requests are not grants: the guard leaves narrowing to the runtime", () => {
  assert(
    !assess({ spec: { ...spec, requestedCapabilities: ["write", "network"] } })
      .blocked,
    "request is passed through and denied by the runtime intersection",
  );
});

const planAllowed = (mode, level, input) =>
  policy.planModeTemporarySpecAllowed({ mode }, level, call(input));

await test("plan mode admits only read-only, artifact-free foreground specs", () => {
  for (const mode of ["simple_plan", "detailed_plan"]) {
    assert(planAllowed(mode, "project-write", { spec }), `${mode} analyse`);
    assert(
      planAllowed(mode, "yolo", {
        spec: { ...spec, profile: "research", requestedCapabilities: ["read", "search"] },
      }),
      `${mode} research`,
    );
    assert(!planAllowed(mode, "readonly", { spec }), `${mode} readonly`);
    assert(
      !planAllowed(mode, "project-write", {
        spec: { ...spec, requestedCapabilities: ["read", "readonly_shell"] },
      }),
      `${mode} shell request`,
    );
    assert(
      !planAllowed(mode, "project-write", {
        spec: { ...spec, requestedCapabilities: ["write"] },
      }),
      `${mode} write request`,
    );
    assert(!planAllowed(mode, "project-write", { spec, async: true }), `${mode} async`);
    assert(
      !planAllowed(mode, "project-write", { spec, artifacts: true }),
      `${mode} artifacts`,
    );
    assert(
      !planAllowed(mode, "project-write", { spec: { ...spec, profile: "implement" } }),
      `${mode} implement`,
    );
    assert(
      !planAllowed(mode, "project-write", { spec: { ...spec, profile: "verify" } }),
      `${mode} verify`,
    );
  }
  eq(planAllowed("work", "project-write", { spec }), false, "work mode is not plan-restricted");
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
