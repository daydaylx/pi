/**
 * Regression test for scripts/apply-runtime-patches.mjs.
 *
 * It never touches the installed runtime. Each patch is exercised against a
 * fixture built from its own anchor, which is enough to prove the three
 * properties the script promises: it applies, it is idempotent, and it refuses
 * a runtime it no longer recognises.
 *
 * The last check ties this file to tests/p1-runtime.mjs: every marker that
 * test greps for in the live runtime must be produced by some patch here, so
 * the two cannot drift into disagreeing about what "patched" means.
 */
import assert from "node:assert/strict";
import {
  EXPECTED_RUNTIME_VERSION,
  PATCHES,
  planPatch,
} from "../scripts/apply-runtime-patches.mjs";

let checks = 0;
function check(description, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${description}`);
}

console.log(`runtime patches (Pi ${EXPECTED_RUNTIME_VERSION})`);

check("every patch is uniquely identified", () => {
  const ids = PATCHES.map((patch) => patch.id);
  assert.equal(new Set(ids).size, ids.length, "patch ids must be unique");
  assert.ok(PATCHES.length > 0, "there is at least one patch");
});

for (const patch of PATCHES) {
  check(`${patch.id}: applies to its anchor`, () => {
    const planned = planPatch(patch, patch.anchor);
    assert.equal(planned.state, "pending");
    assert.ok(
      planned.content.includes(patch.detect),
      "the applied patch is detectable afterwards",
    );
    assert.notEqual(planned.content, patch.anchor, "the content changed");
  });

  check(`${patch.id}: is idempotent`, () => {
    const once = planPatch(patch, patch.anchor).content;
    const twice = planPatch(patch, once);
    assert.equal(twice.state, "already", "a patched file is recognised");
    assert.equal(twice.content, once, "a second run changes nothing");
  });

  if (patch.legacyDetect) {
    check(`${patch.id}: upgrades its known legacy form`, () => {
      const planned = planPatch(patch, patch.legacyDetect);
      assert.equal(planned.state, "pending");
      assert.ok(planned.content.includes(patch.detect));
    });
  }

  check(`${patch.id}: refuses a runtime it does not recognise`, () => {
    assert.throws(
      () => planPatch(patch, "// eine Runtime, die diesen Anker nicht kennt\n"),
      /Ankertext nicht gefunden/,
      "a missing anchor aborts instead of guessing",
    );
  });

  check(`${patch.id}: refuses an ambiguous anchor`, () => {
    assert.throws(
      () => planPatch(patch, `${patch.anchor}\n${patch.anchor}`),
      /nicht eindeutig/,
      "an anchor occurring twice aborts",
    );
  });
}

check("the patch set covers what p1-runtime.mjs verifies", () => {
  // These are the markers tests/p1-runtime.mjs asserts against the installed
  // runtime. Each one has to come from a patch, otherwise a green patch run
  // could still leave that test red.
  const runtimeMarkers = [
    "eventUnsubscribers",
    "dispose(message = ",
    "this._extensionRunner.dispose()",
    "applyConfiguredExtensionOrder",
    "const builtinCommands = BUILTIN_SLASH_COMMANDS.map",
    "submitSlashCommand: async (commandLine)",
  ];
  const applied = PATCHES.map((patch) => patch.replacement).join("\n");
  for (const marker of runtimeMarkers) {
    assert.ok(
      applied.includes(marker),
      `no patch produces the marker '${marker}' that p1-runtime.mjs requires`,
    );
  }
});

check("patches stay within the allowlisted runtime files", () => {
  const allowed = new Set([
    "dist/core/agent-session.js",
    "dist/core/extensions/loader.js",
    "dist/core/extensions/runner.js",
    "dist/core/package-manager.js",
    "dist/modes/interactive/interactive-mode.js",
  ]);
  for (const patch of PATCHES) {
    assert.ok(
      allowed.has(patch.file) && !patch.file.includes(".."),
      `patch '${patch.id}' targets an unexpected path: ${patch.file}`,
    );
  }
});

console.log(`\nPASS: ${checks} passed, 0 failed`);
