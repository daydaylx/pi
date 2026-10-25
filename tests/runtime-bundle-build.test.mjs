import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBuildOutput,
  verifyIntegrity,
  bundleInputEvidence,
} from "../scripts/rebuild-runtime-bundle.mjs";
import {
  bundledUndiciBinding,
  probeBundledRuntime,
} from "../scripts/check-bundled-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(root, ".agent/runtime-build-test-fixtures");
mkdirSync(scratch, { recursive: true });

function fixture(fn) {
  const directory = mkdtempSync(path.join(scratch, "test-"));
  try {
    return fn(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("rebuild cannot overwrite an existing tree or follow an output symlink", () =>
  fixture((directory) => {
    assert.throws(() => assertBuildOutput(directory), /already exists/);
    assert.throws(
      () => assertBuildOutput(path.join(root, "npm/new-runtime")),
      /inside/,
    );
    const external = path.join(directory, "external");
    mkdirSync(external);
    symlinkSync(external, path.join(directory, "link"), "dir");
    assert.throws(
      () => assertBuildOutput(path.join(directory, "link/build")),
      /Symlink/,
    );
    assert.equal(
      assertBuildOutput(path.join(directory, "fresh")),
      path.join(directory, "fresh"),
    );
  }));

test("cached sources require their exact trusted digest", () => {
  const bytes = Buffer.from("trusted source");
  const integrity =
    "sha512-" + createHash("sha512").update(bytes).digest("base64");
  verifyIntegrity(bytes, integrity);
  assert.throws(
    () => verifyIntegrity(Buffer.from("changed source"), integrity),
    /integrity/,
  );
  assert.throws(() => verifyIntegrity(bytes, "md5-AAAA"), /integrity/);
  assert.throws(() => verifyIntegrity(bytes, undefined), /integrity/);
});

test("bundle receipt requires actual safe Undici inputs rather than a clean external audit", () =>
  fixture((directory) => {
    const dependency = path.join(directory, "node_modules/undici");
    mkdirSync(dependency, { recursive: true });
    const manifest = path.join(dependency, "package.json");
    writeFileSync(
      manifest,
      JSON.stringify({ name: "undici", version: "8.12.2" }),
    );
    const source = path.join(dependency, "index.js");
    writeFileSync(source, "exports.fixture = true;\n");
    const metafiles = [
      { inputs: { "node_modules/undici/index.js": { bytes: 24 } } },
    ];
    const report = bundleInputEvidence(metafiles, directory, {
      undici: "8.12.2",
    });
    assert.deepEqual(report.securityDependencies, { undici: "8.12.2" });
    assert.equal(
      report.inputs["node_modules/undici/index.js"],
      createHash("sha256").update(readFileSync(source)).digest("hex"),
    );
    writeFileSync(
      manifest,
      JSON.stringify({ name: "undici", version: "8.10.2" }),
    );
    assert.throws(
      () => bundleInputEvidence(metafiles, directory),
      /Unexpected bundled undici/,
    );
    assert.throws(
      () => bundleInputEvidence([{ inputs: {} }], directory),
      /No proven bundle input/,
    );
  }));

test("bundle evidence rejects inputs outside the build and declared dependency roots", () =>
  fixture((directory) => {
    const build = path.join(directory, "build");
    mkdirSync(build);
    writeFileSync(path.join(directory, "outside.js"), "private fixture");
    assert.throws(
      () => bundleInputEvidence([{ inputs: { "../outside.js": {} } }], build),
      /outside declared/,
    );
  }));

test("diagnostic accessor rejects missing and ambiguous embedded modules", () => {
  const module =
    'var require_undici=__commonJS({"node_modules/undici/index.js"';
  assert.equal(bundledUndiciBinding(module), "require_undici");
  assert.equal(bundledUndiciBinding('var note="undici/index.js";'), undefined);
  assert.throws(() => bundledUndiciBinding(module + module), /Ambiguous/);
});

test("bundle probe refuses to import a symlinked chunk", () =>
  fixture((directory) => {
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: "@earendil-works/pi-coding-agent",
        version: "1.3.0",
      }),
    );
    mkdirSync(path.join(directory, "dist/bundle/chunks"), { recursive: true });
    writeFileSync(
      path.join(directory, "external.js"),
      "throw new Error('must not execute')",
    );
    symlinkSync(
      path.join(directory, "external.js"),
      path.join(directory, "dist/bundle/chunks/link.js"),
    );
    assert.throws(() => probeBundledRuntime(directory), /Symlink/);
  }));

test("declared dependencies are recognized through a worktree node_modules symlink", () =>
  fixture((directory) => {
    const input = path.relative(
      directory,
      path.join(root, "npm/node_modules/undici/index.js"),
    );
    const report = bundleInputEvidence(
      [{ inputs: { [input]: {} } }],
      directory,
    );
    assert.equal(report.securityDependencies.undici, "8.12.2");
  }));
