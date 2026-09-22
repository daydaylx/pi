import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importModule } from "./shared/jiti-loader.mjs";

const { discoverDependencyTargets } = await importModule(
  "extensions/setup-core/dependency-prepare.ts",
);

function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), "dependency-discovery-"));
  const addPackage = (relative) => {
    const dir = path.join(root, relative);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { fixture: "1.0.0" },
      }),
    );
  };
  try {
    run(root, addPackage);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("host session history does not consume the package search budget", () => {
  fixture((root, addPackage) => {
    for (let i = 0; i < 520; i++) {
      mkdirSync(path.join(root, "sessions", String(i)), { recursive: true });
    }
    addPackage("npm");
    addPackage("z-last");
    addPackage("nested/sessions");
    assert.deepEqual(
      discoverDependencyTargets(root, root).map(
        (target) => target.relativeDirectory,
      ),
      ["nested/sessions", "npm", "z-last"],
    );
    assert.throws(() => discoverDependencyTargets(root), /Limit von 512/);
    assert.throws(
      () => discoverDependencyTargets(root, path.join(root, "elsewhere")),
      /Limit von 512/,
    );
  });
});

test("ordinary project sessions remains a discoverable package root", () => {
  fixture((root, addPackage) => {
    addPackage("sessions");
    assert.deepEqual(
      discoverDependencyTargets(root).map((target) => target.relativeDirectory),
      ["sessions"],
    );
  });
});

test("unbounded non-runtime directories still fail closed", () => {
  fixture((root) => {
    for (let i = 0; i < 520; i++) mkdirSync(path.join(root, String(i)));
    assert.throws(() => discoverDependencyTargets(root, root), /Limit von 512/);
  });
});
