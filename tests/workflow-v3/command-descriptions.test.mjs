/**
 * Cross-surface consistency for slash-command descriptions.
 *
 * Autocomplete (native registerCommand), the Command Center menu (the
 * catalog) and the shortcut overlay used to keep independent copies of the
 * same explanation, and they drifted — e.g. /review-plan lost the word
 * "optional" in one of the three. `catalogDescription`/`catalogLabel` in
 * command-catalog.ts are now the single source; this asserts every native
 * registration still starts with its catalog text instead of a stale copy.
 */
import { assert, eq, test } from "./assertions.mjs";
import { createHarness } from "../shared/harness.mjs";
import { load } from "./harness.mjs";

const planMode = await load("extensions/plan-mode/index.ts");
const modePermissions = await load("extensions/mode-permissions.ts");
const diffViewer = await load("extensions/diff-viewer/index.ts");
const setupCore = await load("extensions/setup-core/index.ts");
const lspExtensionMod = await load("extensions/lsp/index.ts");
const commandCatalog = await load("extensions/shared/command-catalog.ts");

await test(
  "every natively registered command starts with its catalog description",
  () => {
    if (
      !planMode ||
      !modePermissions ||
      !diffViewer ||
      !setupCore ||
      !lspExtensionMod ||
      !commandCatalog
    )
      return;
    const harness = createHarness();
    planMode.default(harness.api);
    modePermissions.default(harness.api);
    diffViewer.default(harness.api);
    setupCore.default(harness.api);
    lspExtensionMod.default(harness.api);

    let checked = 0;
    for (const definition of commandCatalog.COMMAND_DEFINITIONS) {
      const registered = harness.commandDescriptions.get(definition.name);
      // Not every catalog entry has a custom registration (e.g. /model is a
      // host-native command); those have nothing to drift and are skipped.
      if (registered === undefined) continue;
      checked += 1;
      const canonical = commandCatalog.catalogDescription(definition.name);
      assert(
        registered.startsWith(canonical),
        `/${definition.name}: native description "${registered}" must start with the catalog description "${canonical}"`,
      );
    }
    eq(
      checked,
      24,
      "the consistency check covered every natively registered catalog command",
    );
  },
);
