// P1 regression test for the locally patched Pi 0.82.0 runtime.
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
  "0.82.0",
  "P1 runtime patch is pinned to Pi 0.82.0",
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

assert.match(loaderSource, /eventUnsubscribers/, "loader scopes event-bus listeners");
assert.match(runnerSource, /dispose\(message = /, "runner disposes scoped listeners");
assert.match(sessionSource, /await emitSessionShutdownEvent[\s\S]{0,240}this\._extensionRunner\.dispose\(\)/, "reload disposes the replaced runner");
assert.match(packageManagerSource, /applyConfiguredExtensionOrder/, "package manager honors explicit extension order");

const { createEventBus } = await import(`${RUNTIME_ROOT}/dist/core/event-bus.js`);
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
  activeRunner?.dispose();
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
  activeRunner = new ExtensionRunner([extension], runtime, process.cwd(), {}, {});

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

activeRunner.dispose();
const postDisposeResponses = [];
eventBus.emit("p1:reload-provider", {
  respond(value) {
    postDisposeResponses.push(value);
  },
});
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(postDisposeResponses, [], "disposing the last runner removes its listener");

console.log("P1 runtime reload regression passed.");
