// P1 regression test for the locally patched Pi 0.84.3 runtime.
// It intentionally targets the executable runtime, not npm/node_modules,
// because that is the Pi instance users actually start.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUNDLE_PATCHES,
  EXPECTED_RUNTIME_VERSION,
  findBundleChunkFile,
} from "../scripts/apply-runtime-patches.mjs";
import { resolveRuntimeForRuntimeTest } from "./shared/runtime-test-resolution.mjs";

const { root: RUNTIME_ROOT, source: runtimeSource } =
  resolveRuntimeForRuntimeTest();
console.log(`Runtime-Ziel: ${RUNTIME_ROOT} (${runtimeSource})`);

const packageJson = JSON.parse(
  readFileSync(`${RUNTIME_ROOT}/package.json`, "utf8"),
);
assert.equal(
  packageJson.version,
  EXPECTED_RUNTIME_VERSION,
  `P1 runtime patch is pinned to Pi ${EXPECTED_RUNTIME_VERSION}`,
);

const loaderSource = readFileSync(
  `${RUNTIME_ROOT}/dist/core/extensions/loader.js`,
  "utf8",
);
const runnerSource = readFileSync(
  `${RUNTIME_ROOT}/dist/core/extensions/runner.js`,
  "utf8",
);
const sessionSource = readFileSync(
  `${RUNTIME_ROOT}/dist/core/agent-session.js`,
  "utf8",
);
const packageManagerSource = readFileSync(
  `${RUNTIME_ROOT}/dist/core/package-manager.js`,
  "utf8",
);
const interactiveSource = readFileSync(
  `${RUNTIME_ROOT}/dist/modes/interactive/interactive-mode.js`,
  "utf8",
);

// Retired in 0.84.0: loader-scoped-events / loader-unsubscriber-list /
// runner-dispose / session-reload-dispose used to scope and drain extension
// event-bus listeners by hand. Upstream now does this natively — a
// generation-scoped set drained by invalidate() — so these assertions check
// that native mechanism instead of the old patch markers.
assert.match(
  loaderSource,
  /trackEventBusSubscription/,
  "loader scopes event-bus listeners to their generation",
);
assert.match(
  runnerSource,
  /invalidate\(message = [\s\S]{0,600}this\.runtime\.invalidate\(message\)/,
  "runner invalidation forwards to the generation-scoped runtime",
);
assert.match(
  sessionSource,
  /await emitSessionShutdownEvent[\s\S]{0,240}oldRunner\.invalidate\(\)/,
  "reload invalidates the replaced runner",
);
assert.match(
  packageManagerSource,
  /applyConfiguredExtensionOrder/,
  "package manager honors explicit extension order",
);
assert.match(
  sessionSource,
  /const builtinCommands = BUILTIN_SLASH_COMMANDS\.map/,
  "command inventory includes Pi built-ins",
);
// Retired in 0.84.3: "agent-session-compaction-failure-manual" and
// "agent-session-compaction-failure-auto" used to hand-emit
// session_compact_failed from compact()'s catch block and from
// _runAutoCompaction(). Upstream now does this natively via a generic
// _emitSessionCompactFailed() helper called from both places, so these
// assertions check that native mechanism instead of the old patch markers.
assert.match(
  sessionSource,
  /async _emitSessionCompactFailed\(event\) \{[\s\S]{0,200}this\._extensionRunner\.hasHandlers\("session_compact_failed"\)/,
  "a generic helper reports failed compaction to extensions",
);
assert.match(
  sessionSource,
  /await this\._emitSessionCompactFailed\(\{\s*\n\s*reason: "manual",/,
  "a failed manual compaction is reported to extensions",
);
assert.match(
  sessionSource,
  /_runAutoCompaction\(reason, willRetry\) \{[\s\S]{0,4000}await this\._emitSessionCompactFailed\(/,
  "a failed auto-compaction is reported to extensions",
);
assert.match(
  interactiveSource,
  /submitSlashCommand: async \(commandLine\)/,
  "interactive UI exposes canonical slash submission",
);
assert.match(
  interactiveSource,
  /onTerminalInput: \(handler\) => this\.addExtensionTerminalInputListener\(\(data\) => this\.ui\.focusedComponent === this\.editor \? handler\(data\) : undefined\)/,
  "extension terminal listeners yield to focused selectors and overlays",
);
assert.match(
  interactiveSource,
  /onExtensionShortcut = \(data\) => \{[\s\S]{0,900}Promise\.resolve\(shortcut\.handler\(createContext\(\)\)\)\.catch/,
  "extension shortcuts launch without awaiting the handler on the input path",
);
assert.match(
  interactiveSource,
  /addChild\(this\.extensionSelector\);[\s\S]{0,120}setFocus\(this\.extensionSelector\)/,
  "native extension selectors explicitly take keyboard focus",
);
assert.match(
  interactiveSource,
  /hideExtensionSelector\(\) \{[\s\S]{0,260}setFocus\(this\.editor\)/,
  "closing a native extension selector restores editor focus",
);

// `pi`'s bin entry (dist/bundle/cli.js) never imports the unbundled dist/
// files checked above — it runs a separately pre-built, minified bundle
// under dist/bundle/chunks/*.js instead. Patching only the unbundled files
// has zero effect on the actual interactive process, and every assertion
// above stayed green through that regardless because it only ever read the
// unbundled sources. Discovered 2026-08-24: see docs/RUNTIME_PATCHES.md.
// Each BUNDLE_PATCHES entry must be present in whichever chunk contains its
// anchor, so this loop is what actually would have caught the gap.
for (const patch of BUNDLE_PATCHES) {
  const chunkRelPath = findBundleChunkFile(RUNTIME_ROOT, patch);
  const chunkContent = readFileSync(`${RUNTIME_ROOT}/${chunkRelPath}`, "utf8");
  assert.ok(
    chunkContent.includes(patch.detect),
    `bundle chunk ${chunkRelPath} has the '${patch.id}' patch applied`,
  );
}

const { createEventBus } = await import(
  `${RUNTIME_ROOT}/dist/core/event-bus.js`
);
const { createExtensionRuntime, loadExtensionFromFactory } = await import(
  `${RUNTIME_ROOT}/dist/core/extensions/loader.js`
);
const { ExtensionRunner } = await import(
  `${RUNTIME_ROOT}/dist/core/extensions/runner.js`
);

const eventBus = createEventBus();
let generation = 0;
let activeRunner;

for (let reload = 1; reload <= 10; reload += 1) {
  activeRunner?.invalidate();
  const runtime = createExtensionRuntime();
  const instance = ++generation;
  const extension = await loadExtensionFromFactory(
    (pi) => {
      pi.events.on("p1:reload-provider", (event) => {
        event.respond(instance);
      });
    },
    process.cwd(),
    eventBus,
    runtime,
    `<p1-reload-${reload}>`,
  );
  activeRunner = new ExtensionRunner(
    [extension],
    runtime,
    process.cwd(),
    {},
    {},
  );

  const responses = [];
  eventBus.emit("p1:reload-provider", {
    respond(value) {
      responses.push(value);
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    responses,
    [instance],
    `reload ${reload} has exactly one current event-bus provider`,
  );
}

activeRunner.invalidate();
const postInvalidateResponses = [];
eventBus.emit("p1:reload-provider", {
  respond(value) {
    postInvalidateResponses.push(value);
  },
});
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(
  postInvalidateResponses,
  [],
  "invalidating the last runner removes its listener",
);

console.log("P1 runtime reload regression passed.");
