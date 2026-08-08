// P1 regression test for the locally patched Pi 0.84.1 runtime.
// It intentionally targets the executable runtime, not npm/node_modules,
// because that is the Pi instance users actually start.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNTIME_ROOT =
  process.env.PI_RUNTIME_ROOT ??
  "/home/d/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent";

const packageJson = JSON.parse(
  readFileSync(`${RUNTIME_ROOT}/package.json`, "utf8"),
);
assert.equal(
  packageJson.version,
  "0.84.1",
  "P1 runtime patch is pinned to Pi 0.84.1",
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
