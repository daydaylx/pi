// Shortcut regression coverage for the UI rework: existing keyboard bindings
// (extensions/shared/shortcuts.ts, extensions/plan-mode/commands.ts) must
// keep working exactly as before — the rework is not allowed to touch them
// without a documented reason (see 08_RISKS_AND_NON_GOALS.md in the UI rework
// concept package: "Shortcut-Kompatibilität ist ein Acceptance Criterion").
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";

export const shortcutsSections = {
  "global shortcut regressions": async (context) => {
    const { section, load, controlPlane, planMode } = context;

    await section("global shortcut regressions", async () => {
      // 1. Every binding in the shared SHORTCUTS table submits exactly its
      // own canonical command — guards against the key, the registered
      // handler and the submitted command silently drifting apart.
      if (controlPlane) {
        const shortcutsMod = await load("extensions/shared/shortcuts.ts");
        if (shortcutsMod) {
          for (const [name, binding] of Object.entries(
            shortcutsMod.SHORTCUTS,
          )) {
            const harness = createHarness();
            controlPlane.default(harness.api);
            const ctx = harness.makeContext();
            const handler = harness.shortcuts.get(binding.keys);
            assert(
              typeof handler === "function",
              `${binding.keys} is registered (${name})`,
            );
            await handler(ctx);
            eq(
              harness.submittedCommands,
              [binding.command],
              `${binding.keys} submits its canonical command ${binding.command} (${name})`,
            );
          }
        }
      }

      // 2. Shift+Tab still opens exactly the three existing workflow
      // entries. Direct regression guard against the UI rework concept
      // package's original proposal of a Workflow/Tasks/Skills tab overlay —
      // the real implementation deliberately keeps the native 3-entry
      // selector instead (see docs/decisions/013-aurora-keeps-the-native-editor.md
      // and extensions/shared/control-center-menu.ts).
      if (planMode) {
        let capturedLabels;
        const harness = createHarness({
          select: (labels) => {
            capturedLabels = labels;
            return "Work";
          },
        });
        planMode.default(harness.api);
        const ctx = harness.makeContext();
        await harness.runHooks("session_start", {}, ctx);
        const openWorkflowMenu = harness.shortcuts.get("shift+tab");
        assert(
          typeof openWorkflowMenu === "function",
          "Shift+Tab is registered by plan-mode",
        );
        await openWorkflowMenu(ctx);
        eq(
          capturedLabels,
          ["Work", "Schnellplan", "Architekturplan"],
          "Shift+Tab still opens exactly the three existing workflow entries, not a Workflow/Tasks/Skills tab overlay",
        );
      }
    });
  },
};
