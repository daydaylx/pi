import { assert, eq, test, counters as summary } from "./shared/assertions.mjs";
import { importModule as load } from "./shared/jiti-loader.mjs";

const policy = await load("extensions/permissions/temporary-agent-policy.ts");
const renderers = await load("extensions/aurora-ui/tool-renderers.ts");

const spec = {
  objective: "Find the cause",
  profile: "analyse",
  delegationReason: "independent analysis",
};
const call = (input) => ({ toolName: "subagent", input });
const analyseOnly = () => spec;
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

const verification = {
  originalRequest: "Fix the bug",
  delegatedQuestion: "Is the fix correct?",
  diff: "src/a.ts changed",
  baseline: "clean",
  acceptance: "tests pass",
};
const verifySpec = { ...spec, profile: "verify", verification };
const rewrite = (input) => policy.rewriteVerifySpecToVerifier(call(input));

await test("bare verify spec is never passed through unchecked", () => {
  const result = assess({ spec: { ...spec, profile: "verify" } });
  assert(result.blocked, "verify spec blocked by the generic guard");
  assert(/verifier/i.test(result.reason), "points to the verifier chain");
});

await test("verify spec is rewritten into the checked verifier call", async () => {
  const result = rewrite({ spec: verifySpec });
  eq(result.kind, "rewritten", "rewritten");
  eq(result.input.agent, "verifier", "agent");
  assert(!("spec" in result.input), "spec removed");
  const task = result.input.task;
  const verifierPolicy = await load("extensions/permissions/verifier-policy.ts");
  for (const section of verifierPolicy.VERIFIER_REQUIRED_SECTIONS) {
    assert(
      section.patterns.some((p) => p.test(task)),
      `renders required section: ${section.label}`,
    );
  }
  assert(/acceptance/i.test(task), "renders acceptance criteria");
  const complete = await verifierPolicy.assessVerifierDelegation(
    call(result.input),
    "/nonexistent-root",
    { verifierVerdict: undefined },
  );
  assert(!complete.blocked, "rewritten call passes the verifier completeness check");
});

await test("verify rewrite refuses incomplete, widened or model-picking specs", () => {
  eq(rewrite({ spec: analyseOnly() }).kind, "none", "non-verify untouched");
  for (const key of Object.keys(verification)) {
    const partial = { ...verification, [key]: " " };
    eq(rewrite({ spec: { ...verifySpec, verification: partial } }).kind, "blocked", `missing ${key}`);
  }
  eq(rewrite({ spec: { ...spec, profile: "verify" } }).kind, "blocked", "no verification block");
  eq(rewrite({ spec: { ...verifySpec, modelPreference: "strong" } }).kind, "blocked", "model");
  eq(rewrite({ spec: { ...verifySpec, requestedCapabilities: ["write"] } }).kind, "blocked", "capabilities");
  for (const extra of [{ model: "p/m" }, { cwd: "/tmp" }, { output: "o" }, { context: "fork" }, { task: "x" }, { agent: "y" }]) {
    eq(rewrite({ spec: verifySpec, ...extra }).kind, "blocked", `extra ${Object.keys(extra)[0]}`);
  }
  eq(
    rewrite({ spec: { ...verifySpec, verification: { ...verification, reverificationJustification: "" } } }).kind,
    "blocked",
    "empty justification",
  );
});

await test("re-verification justification is carried into the task", () => {
  const result = rewrite({
    spec: { ...verifySpec, verification: { ...verification, reverificationJustification: "new evidence" } },
  });
  assert(/Re-verification justification\nnew evidence/.test(result.input.task), "justification heading");
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
      !planAllowed(mode, "project-write", { spec: verifySpec }),
      `${mode} verify`,
    );
  }
  eq(planAllowed("work", "project-write", { spec }), false, "work mode is not plan-restricted");
});

await test("TUI shows temporary agents by objective and write right, not by role", () => {
  const shown = renderers.temporaryAgentDisplay(spec);
  eq(shown.agent, "TEMP AGENT", "generic label");
  eq(shown.label, "Find the cause · read-only", "objective and read-only");
  const long = renderers.temporaryAgentDisplay({ ...spec, objective: "x".repeat(200) });
  assert(long.label.length < 80, "long objectives are clipped");
  assert(long.label.includes("…"), "clipped objectives are marked");
  eq(
    renderers.temporaryAgentDisplay({ ...spec, objective: "a\n b" }).label,
    "a b · read-only",
    "whitespace collapsed",
  );
  eq(renderers.temporaryAgentDisplay(undefined), undefined, "no spec");
  eq(renderers.temporaryAgentDisplay([]), undefined, "array is no spec");
  assert(
    renderers.temporaryAgentDisplay({}).label.startsWith("ohne Objective"),
    "missing objective is visible, not hidden",
  );
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
