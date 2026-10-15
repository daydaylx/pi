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

      // 2. Shift+Tab is free. Pi's runtime binds it to `app.thinking.cycle` by
      // default; keybindings.json moves that action away, and no extension
      // registers the key. It is reserved for a later skill launcher.
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
          false,
          "no active extension registers Shift+Tab",
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
