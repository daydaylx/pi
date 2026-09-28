import { assert, eq, test, counters as summary } from "./shared/assertions.mjs";
import { importModule as load } from "./shared/jiti-loader.mjs";

const risk = await load("extensions/permissions/verifier-risk.ts");

const assess = (overrides = {}) =>
  risk.assessVerifierNeed({
    changedFiles: [],
    userRequestedVerification: false,
    ...overrides,
  });

// T09-T12 — Hard-Pfad-Kategorien -> required
await test("hard path hit is required, regardless of trigger or request", () => {
  const result = assess({
    changedFiles: ["extensions/permissions/guards.ts"],
  });
  eq(result.need, "required", "guards.ts is a hard path");
  eq(result.reasonCode, "hard_path", "reason code names the hard path");
  assert(
    result.requiredPathHits.length === 1 &&
      result.requiredPathHits[0].path === "extensions/permissions/guards.ts",
    "hit lists the exact path",
  );
});

await test("hard path among several changed files still requires", () => {
  const result = assess({
    changedFiles: [
      "README.md",
      "extensions/plan-mode/plan-tool.ts",
      "src/x.ts",
    ],
  });
  eq(result.need, "required", "plan-mode hit forces required");
  eq(
    result.requiredPathHits.map((hit) => hit.path),
    ["extensions/plan-mode/plan-tool.ts"],
    "only the actual hard-path file is reported as a hit",
  );
});

// T13 — expliziter Nutzerwunsch -> required
await test("explicit user request is required even with no changed files", () => {
  const result = assess({ userRequestedVerification: true });
  eq(result.need, "required", "user request alone is sufficient");
  eq(result.reasonCode, "user_requested", "reason code names the request");
  eq(result.requiredPathHits, [], "no hard-path hits are claimed");
});

await test("user request wins over an absent hard path without needing a trigger", () => {
  const result = assess({
    userRequestedVerification: true,
    changedFiles: ["README.md"],
  });
  eq(result.need, "required", "still required");
  eq(result.reasonCode, "user_requested", "user request is checked first");
});

// T01/T02 — README/CSS/Text-only -> not_needed
await test("README-only change is not needed", () => {
  const result = assess({
    changedFiles: ["README.md", "docs/architecture.md"],
  });
  eq(result.need, "not_needed", "docs are not a hard path");
  eq(result.reasonCode, "no_trigger", "no trigger, no hard path, no request");
});

await test("CSS/text-only change is not needed", () => {
  const result = assess({
    changedFiles: [
      "extensions/aurora-ui/theme.css",
      "extensions/aurora-ui/copy.txt",
    ],
  });
  eq(result.need, "not_needed", "styling/text is not a hard path");
});

// T04/T05 — normaler Bugfix / Refactor ohne Trigger -> not_needed
await test("an ordinary bugfix without a trigger is not needed", () => {
  const result = assess({
    changedFiles: ["extensions/aurora-ui/tool-renderers.ts"],
  });
  eq(result.need, "not_needed", "no hard path, no trigger");
});

// Diffgröße/Dateianzahl dürfen niemals allein triggern (T24/T25)
await test("a large but harmless diff is not required by size alone", () => {
  const manyFiles = Array.from({ length: 500 }, (_, i) => `src/file-${i}.ts`);
  const result = assess({ changedFiles: manyFiles });
  eq(result.need, "not_needed", "file count alone never forces a run");
});

// T06 — gültiger optionaler Trigger mit Evidenz -> justified
await test("a valid optional trigger with evidence is justified", () => {
  const result = assess({
    changedFiles: ["extensions/lsp/range-edit.ts"],
    optionalTrigger: {
      trigger: "uncovered_behavior",
      evidence:
        "LSP WorkspaceEdit range math has no test for multi-byte offsets.",
    },
  });
  eq(
    result.need,
    "justified",
    "trigger with evidence justifies an optional run",
  );
  eq(result.reasonCode, "uncovered_behavior", "reason code is the trigger id");
});

// T07 — optionaler Trigger ohne Evidence -> block (hier: not_needed)
await test("a trigger without evidence does not justify a run", () => {
  const result = assess({
    optionalTrigger: { trigger: "semantic_contract_risk", evidence: "   " },
  });
  eq(result.need, "not_needed", "empty/whitespace evidence is rejected");
  eq(
    result.reasonCode,
    "trigger_without_evidence",
    "reason code distinguishes this from no trigger at all",
  );
});

await test("a hard path overrides a trigger claim instead of merging with it", () => {
  const result = assess({
    changedFiles: ["extensions/permissions/verifier-policy.ts"],
    optionalTrigger: {
      trigger: "cross_boundary_change",
      evidence: "irrelevant",
    },
  });
  eq(result.need, "required", "hard path wins");
  eq(
    result.reasonCode,
    "hard_path",
    "reason code stays hard_path, not the trigger",
  );
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
