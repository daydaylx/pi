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
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUNDLE_CHUNKS_DIR,
  BUNDLE_PATCHES,
  EXPECTED_RUNTIME_VERSION,
  PATCHES,
  findBundleChunkFile,
  planPatch,
} from "../scripts/apply-runtime-patches.mjs";
import { resolveRuntimeRoot } from "../shared/runtime-resolution.mjs";
import { resolveRuntimeForRuntimeTest } from "./shared/runtime-test-resolution.mjs";

let checks = 0;
function check(description, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${description}`);
}

console.log(`runtime patches (Pi ${EXPECTED_RUNTIME_VERSION})`);

check(
  "patch and runtime verification resolve the identical explicit target",
  () => {
    const root = path.join(tmpdir(), `pi-runtime-resolution-${process.pid}`);
    const runtime = path.join(root, "runtime");
    rmSync(root, { recursive: true, force: true });
    mkdirSync(runtime, { recursive: true });
    writeFileSync(
      path.join(runtime, "package.json"),
      JSON.stringify({ name: "@earendil-works/pi-coding-agent" }),
    );
    try {
      const env = { PATH: "", PI_RUNTIME_ROOT: path.join(root, "wrong") };
      const patchTarget = resolveRuntimeRoot({ runtime, env });
      const testTarget = resolveRuntimeForRuntimeTest(
        ["--runtime", runtime],
        env,
      );
      assert.deepEqual(testTarget, patchTarget);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

check("every patch is uniquely identified", () => {
  const ids = [...PATCHES, ...BUNDLE_PATCHES].map((patch) => patch.id);
  assert.equal(new Set(ids).size, ids.length, "patch ids must be unique");
  assert.ok(PATCHES.length > 0, "there is at least one patch");
  assert.ok(BUNDLE_PATCHES.length > 0, "there is at least one bundle patch");
});

for (const patch of [...PATCHES, ...BUNDLE_PATCHES]) {
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
  // runtime that still come from a patch. Each one has to come from a patch,
  // otherwise a green patch run could still leave that test red.
  //
  // Not listed here: the retired-in-0.84.0 markers (event-bus listener
  // scoping / disposal) and the retired-in-0.84.3 markers (manual/auto
  // compaction-failure reporting) that p1-runtime.mjs now checks directly
  // against upstream's native mechanism instead of a patch — see the
  // P1-RETIRED comments in scripts/apply-runtime-patches.mjs.
  const runtimeMarkers = [
    "applyConfiguredExtensionOrder",
    "const builtinCommands = BUILTIN_SLASH_COMMANDS.map",
    "submitSlashCommand: async (commandLine)",
    "P1: terminal input listeners are editor-scoped",
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
  // Bundle patches deliberately carry no `file` — their chunk filename is a
  // content hash a rebuild can change, so main() resolves it dynamically via
  // findBundleChunkFile instead of a fixed allowlisted path.
  for (const patch of BUNDLE_PATCHES) {
    assert.ok(
      patch.file === undefined,
      `bundle patch '${patch.id}' must not declare a fixed file`,
    );
  }
});

check(
  "findBundleChunkFile locates the chunk containing a patch's anchor",
  () => {
    const root = path.join(
      tmpdir(),
      `pi-bundle-chunk-resolution-${process.pid}`,
    );
    rmSync(root, { recursive: true, force: true });
    const chunksDir = path.join(root, BUNDLE_CHUNKS_DIR);
    mkdirSync(chunksDir, { recursive: true });
    try {
      const [samplePatch] = BUNDLE_PATCHES;
      writeFileSync(
        path.join(chunksDir, "chunk-A.js"),
        "// unrelated bundle code\n",
      );
      writeFileSync(
        path.join(chunksDir, "chunk-B.js"),
        `// prefix\n${samplePatch.anchor}\n// suffix\n`,
      );
      assert.equal(
        findBundleChunkFile(root, samplePatch),
        path.join(BUNDLE_CHUNKS_DIR, "chunk-B.js"),
        "resolves to the one chunk that actually contains the anchor",
      );

      writeFileSync(
        path.join(chunksDir, "chunk-A.js"),
        "// unrelated bundle code\n",
      );
      writeFileSync(
        path.join(chunksDir, "chunk-B.js"),
        "// no longer has the anchor either\n",
      );
      assert.throws(
        () => findBundleChunkFile(root, samplePatch),
        /kein Bundle-Chunk/,
        "throws when no chunk contains the anchor",
      );

      writeFileSync(
        path.join(chunksDir, "chunk-A.js"),
        `// also has it\n${samplePatch.anchor}\n`,
      );
      writeFileSync(
        path.join(chunksDir, "chunk-B.js"),
        `// prefix\n${samplePatch.anchor}\n// suffix\n`,
      );
      assert.throws(
        () => findBundleChunkFile(root, samplePatch),
        /nicht eindeutig/,
        "throws when more than one chunk contains the anchor",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

console.log(`\nPASS: ${checks} passed, 0 failed`);
