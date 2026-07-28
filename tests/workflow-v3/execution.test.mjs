/**
 * Ausführung: /work, Trust-Grenze und ausdrückliche Fortsetzung.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq, test } from "./assertions.mjs";
import { createHarness, latestStatus } from "../shared/harness.mjs";
import { progressPlan, planUtils } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const planMode = await load("extensions/plan-mode/index.ts");

await test(
  "untrusted plans require an explicit interactive work grant",
  async () => {
    if (!planMode || !planUtils) return;
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-untrusted-plan-"));
    try {
      planUtils.writePlanFileAtomic(cwd, progressPlan);
      let allow = false;
      const harness = createHarness({ confirm: () => allow });
      planMode.default(harness.api);
      const context = harness.makeContext({ cwd, trusted: false });
      await harness.runHooks("session_start", {}, context);
      eq(
        latestStatus(harness, "workflow"),
        "ARBEIT",
        "untrusted plan artifacts stay inactive on session restore",
      );
      await harness.commands.get("work")("", context);
      eq(
        harness.sent.length,
        0,
        "refusing the trust prompt does not start work",
      );
      assert(
        Boolean(planUtils.readPlanFile(cwd)),
        "refusal preserves the untrusted plan",
      );

      // v3 turns project trust into a hard boundary: there is no prompt that
      // could grant work in an untrusted project any more.
      allow = true;
      await harness.commands.get("work")("", context);
      eq(
        harness.sent.length,
        0,
        "an untrusted project cannot be unlocked by confirming a prompt",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
);
