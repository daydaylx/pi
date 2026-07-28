/**
 * Direct-Task-Schema und sicherer technischer Scope.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, equal, test } from "./assertions.mjs";
import { load } from "./harness.mjs";

const store = await load("extensions/plan-mode/store/index.ts");

await test("direct task schema enforces safe scope", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-direct-"));
  try {
    const task = store.saveDirectTask(cwd, {
      goal: "Fix",
      technicalScope: ["src/**"],
      verification: ["unit"],
      acceptanceCriteria: ["test passes"],
    });
    equal(store.loadDirectTask(cwd).taskId, task.taskId, "direct task roundtrips");
    let unsafe = false;
    try {
      store.saveDirectTask(cwd, {
        goal: "Escape",
        technicalScope: ["../outside"],
        verification: ["unit"],
        acceptanceCriteria: ["done"],
      });
    } catch {
      unsafe = true;
    }
    assert(unsafe, "unsafe direct-task scope is rejected");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
