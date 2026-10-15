// Shortcut regression coverage for the UI rework: existing keyboard bindings
// (extensions/shared/shortcuts.ts, extensions/control-plane.ts) must
// keep working exactly as before — the rework is not allowed to touch them
// without a documented reason (see 08_RISKS_AND_NON_GOALS.md in the UI rework
// concept package: "Shortcut-Kompatibilität ist ein Acceptance Criterion").
import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";
import { ROOT } from "../../shared/jiti-loader.mjs";

export const shortcutsSections = {
  "global shortcut regressions": async (context) => {
    const { section, load, controlPlane } = context;

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
            const harness = createHarness({ select: () => undefined });
            controlPlane.default(harness.api);
            const ctx = harness.makeContext();
            // /commands (Super+Q) opens a menu; use the select fallback.
            ctx.ui.custom = async () => {
              throw new Error("use deterministic select fallback");
            };
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

      // 2. Shift+Tab belongs to the skill picker alone. Pi's runtime binds it
      // to `app.thinking.cycle` by default; keybindings.json moves that action
      // to Super+T, so the key is free and exactly one registration owns it.
      {
        const settings = JSON.parse(
          readFileSync(path.join(ROOT, "settings.json"), "utf8"),
        );
        const harness = createHarness();
        for (const entry of settings.extensions.filter((value) =>
          value.startsWith("+"),
        )) {
          const extension = await load(entry.slice(1));
          assert(extension, `${entry} loads`);
          extension.default(harness.api);
        }
        eq(
          harness.shortcuts.has("shift+tab"),
          true,
          "the active extensions register Shift+Tab (skill picker)",
        );
        const registrations = [];
        const original = harness.api.registerShortcut;
        void original;
        for (const entry of settings.extensions.filter((value) =>
          value.startsWith("+"),
        )) {
          const probe = createHarness();
          const base = probe.api.registerShortcut;
          probe.api.registerShortcut = (key, options) => {
            if (key === "shift+tab") registrations.push(entry);
            base(key, options);
          };
          (await load(entry.slice(1))).default(probe.api);
        }
        eq(
          registrations,
          ["+extensions/control-plane.ts"],
          "Shift+Tab is registered once, by the control plane",
        );
        const keybindings = JSON.parse(
          readFileSync(path.join(ROOT, "keybindings.json"), "utf8"),
        );
        assert(
          !Object.values(keybindings).flat().includes("shift+tab"),
          "keybindings.json binds no action to Shift+Tab",
        );
        assert(
          typeof keybindings["app.thinking.cycle"] === "string" &&
            keybindings["app.thinking.cycle"] !== "shift+tab",
          "the runtime's default Shift+Tab thinking cycle is rebound",
        );
      }
    });
  },
};
