/** Workflow selector exposes plan work and direct tasks as separate paths. */
import { assert, eq, test } from "./assertions.mjs";
import { load } from "./harness.mjs";

const menu = await load("extensions/shared/control-center-menu.ts");

function entry(tab, value) {
  return tab.entries.find((candidate) => candidate.value === value);
}

await test("workflow menu separates plan execution from direct tasks", () => {
  const empty = menu.buildWorkflowTab({
    hasActivePlan: false,
    hasActiveDirectTask: false,
  });
  const planWork = entry(empty, "plan_work");
  const directStart = entry(empty, "direct_task_start");
  assert(
    !planWork?.disabled,
    "plan execution remains selectable without a plan to explain the prerequisite",
  );
  eq(
    directStart?.label,
    "Direktauftrag starten",
    "a plan-less task has its own explicit entry",
  );
  assert(!directStart?.disabled, "a direct task is available without a plan");

  const planned = menu.buildWorkflowTab({
    hasActivePlan: true,
    hasActiveDirectTask: false,
    activeMode: "work",
  });
  const activePlanWork = entry(planned, "plan_work");
  const blockedDirectStart = entry(planned, "direct_task_start");
  assert(!activePlanWork?.disabled, "an active plan can be executed");
  assert(activePlanWork?.current, "plan execution is marked as active work");
  assert(blockedDirectStart?.disabled, "a direct task cannot overlap a plan");

  const direct = menu.buildWorkflowTab({
    hasActivePlan: false,
    hasActiveDirectTask: true,
    activeMode: "work",
  });
  const directContinue = entry(direct, "direct_task_continue");
  assert(
    direct.entries.find((candidate) => candidate.value === "simple_plan")?.disabled,
    "planning is unavailable while a direct task is active",
  );
  eq(
    directContinue?.label,
    "Direktauftrag fortsetzen",
    "an active direct task has an explicit continuation entry",
  );
  assert(directContinue?.current, "direct task continuation is marked as active work");
});
