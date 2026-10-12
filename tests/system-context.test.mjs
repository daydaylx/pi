import { strict as assert } from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHarness } from "./shared/harness.mjs";
import { importModule } from "./shared/jiti-loader.mjs";

const collector = await importModule("extensions/system-context/collector.mjs");
const extension = await importModule("extensions/system-context/index.ts");
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push(`${name}: PASS`);
  } catch (error) {
    results.push(
      `${name}: FAIL — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

test("config root resolves /etc/nixos symlink and preserves candidate precedence", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-context-"));
  try {
    const target = path.join(temp, "actual-config");
    const home = path.join(temp, "home");
    mkdirSync(target, { recursive: true });
    mkdirSync(path.join(home, "nixos-config"), { recursive: true });
    writeFileSync(path.join(target, "flake.nix"), "{}\n");
    writeFileSync(path.join(home, "nixos-config", "configuration.nix"), "{}\n");
    const symlink = path.join(temp, "etc-nixos");
    symlinkSync(target, symlink, "dir");
    const found = collector.discoverConfigRoot({
      home,
      etcNixos: symlink,
      cwd: temp,
    });
    assert.equal(found.path, target);
    assert.equal(found.source, "/etc/nixos");
    assert.equal(found.isFlake, true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("system facts use allowlisted os-release fields and report missing sources", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-context-"));
  try {
    const osReleasePath = path.join(temp, "os-release");
    writeFileSync(
      osReleasePath,
      'ID=nixos\nNAME="NixOS"\nSECRET_KEY=do-not-copy\n',
    );
    const calls = [];
    const value = collector.collectSystemContext(["system"], {
      home: temp,
      cwd: temp,
      etcNixos: path.join(temp, "missing"),
      osReleasePath,
      currentSystemPath: path.join(temp, "missing-current"),
      profileSystemPath: path.join(temp, "missing-profile"),
      commandRunner(command, args) {
        calls.push([command, args]);
        if (command === "nixos-version")
          return { available: false, reason: "unavailable" };
        return { available: true, exitCode: 0, stdout: "nix (Nix) 2.28" };
      },
      now: () => "2026-10-12T00:00:00.000Z",
    });
    assert.deepEqual(value.system.os, { ID: "nixos", NAME: "NixOS" });
    assert.equal(value.system.nixosVersionAvailable, false);
    assert.equal(value.system.nixVersionAvailable, true);
    assert.equal(JSON.stringify(value).includes("do-not-copy"), false);
    assert.deepEqual(calls, [
      ["nixos-version", []],
      ["nix", ["--version"]],
    ]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("collector child environments omit credentials and retain required session values", () => {
  const previous = process.env.SYSTEM_CONTEXT_TEST_SECRET;
  process.env.SYSTEM_CONTEXT_TEST_SECRET = "must-not-be-forwarded";
  try {
    const childEnv = collector.commandEnvironment({
      PATH: "/usr/bin",
      HYPRLAND_INSTANCE_SIGNATURE: "session-signature",
      API_TOKEN: "must-not-be-forwarded",
      NIX_CONFIG: "experimental-features = nix-command flakes",
    });
    assert.equal(childEnv.PATH, "/usr/bin");
    assert.equal(childEnv.HYPRLAND_INSTANCE_SIGNATURE, "session-signature");
    assert.equal(
      childEnv.NIX_CONFIG,
      "experimental-features = nix-command flakes",
    );
    assert.equal(childEnv.SYSTEM_CONTEXT_TEST_SECRET, undefined);
    assert.equal(childEnv.API_TOKEN, undefined);
  } finally {
    if (previous === undefined) delete process.env.SYSTEM_CONTEXT_TEST_SECRET;
    else process.env.SYSTEM_CONTEXT_TEST_SECRET = previous;
  }
});

test("flake evaluation is offline and does not write lock files", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-context-"));
  try {
    writeFileSync(path.join(temp, "flake.nix"), "{}\n");
    const calls = [];
    const value = collector.collectSystemContext(["flake"], {
      home: path.join(temp, "home"),
      cwd: temp,
      etcNixos: path.join(temp, "missing"),
      commandRunner(command, args, options) {
        calls.push({ command, args, options });
        return {
          available: true,
          exitCode: 0,
          stdout: '["nixos","test-host"]',
        };
      },
    });
    assert.equal(value.flake.available, true);
    assert.deepEqual(value.flake.configurations, ["nixos", "test-host"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "nix");
    assert.ok(calls[0].args.includes("--offline"));
    assert.ok(calls[0].args.includes("--no-write-lock-file"));
    assert.equal(calls[0].options.timeout, 3000);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("request classification only selects bounded read-only categories", () => {
  assert.deepEqual(collector.categoriesForRequest("Warum ist WLAN langsam?"), [
    "health",
  ]);
  assert.deepEqual(
    collector.categoriesForRequest("Verschiebe das Fenster in Hyprland"),
    ["desktop"],
  );
  assert.deepEqual(
    collector.categoriesForRequest("Prüfe NixOS Flake und Generation"),
    ["flake", "project"],
  );
  assert.deepEqual(collector.categoriesForRequest("Hallo"), []);
});

test("system skills load only on matching requests and grant no permissions", () => {
  const empty = collector.systemSkillContext([]);
  assert.equal(empty, "");
  const health = collector.systemSkillContext(["health"]);
  assert.match(health, /SYSTEM PROFILE GUIDANCE/);
  assert.match(health, /nicht verfügbar/);
  assert.match(health, /override tool permissions/);
  assert.doesNotMatch(health, /nixos-agent-apply/);
  const nixos = collector.systemSkillContext(["flake"]);
  assert.match(nixos, /Offline-Evaluation/);
  assert.match(nixos, /nixos-agent/);
  assert.ok(health.length < 2500);
});

async function testExtensionLifecycle() {
  const previousProfile = process.env.PI_LAUNCH_PROFILE;
  process.env.PI_LAUNCH_PROFILE = "system";
  try {
    const harness = createHarness();
    let instant = 10;
    let configRevision = "revision-1";
    const requests = [];
    extension.registerSystemContext(harness.api, {
      profile: () => "system",
      now: () => instant,
      discoverConfig: () => ({ revision: configRevision }),
      collect(categories) {
        requests.push([...categories]);
        return {
          contextVersion: 1,
          categories,
          collectedAt: "fixture",
          ...(categories.includes("system")
            ? { system: { configuration: { revision: configRevision } } }
            : {}),
        };
      },
    });
    const ctx = harness.makeContext();
    await harness.runHooks("session_start", {}, ctx);
    const first = await harness.runHooks(
      "before_agent_start",
      { prompt: "Hallo", systemPrompt: "base" },
      ctx,
    );
    assert.ok(
      first
        .at(-1)
        .systemPrompt.includes("[SYSTEM CONTEXT — OBSERVATIONAL DATA]"),
    );
    assert.deepEqual(requests, [["system"]]);
    instant += 1000;
    await harness.runHooks(
      "before_agent_start",
      { prompt: "Warum ist WLAN langsam?", systemPrompt: "base" },
      ctx,
    );
    assert.deepEqual(requests, [["system"], ["health"]]);
    configRevision = "revision-2";
    await harness.runHooks(
      "before_agent_start",
      { prompt: "Hallo", systemPrompt: "base" },
      ctx,
    );
    assert.deepEqual(requests, [["system"], ["health"], ["system"]]);
    instant += 31_000;
    await harness.runHooks(
      "before_agent_start",
      { prompt: "Hallo", systemPrompt: "base" },
      ctx,
    );
    assert.deepEqual(requests, [
      ["system"],
      ["health"],
      ["system"],
      ["system"],
    ]);
    return "system context cache and on-demand collection: PASS";
  } finally {
    if (previousProfile === undefined) delete process.env.PI_LAUNCH_PROFILE;
    else process.env.PI_LAUNCH_PROFILE = previousProfile;
  }
}

async function main() {
  try {
    results.push(await testExtensionLifecycle());
  } catch (error) {
    results.push(`system context cache: FAIL — ${error.message}`);
  }
  test("project profile receives no system context hook", () => {
    const harness = createHarness();
    let collected = false;
    extension.registerSystemContext(harness.api, {
      profile: () => "project",
      collect() {
        collected = true;
        return {};
      },
    });
    assert.equal(collected, false);
    assert.equal(harness.hooks.has("before_agent_start"), false);
  });
  const failed = results.filter((result) => result.includes("FAIL"));
  for (const result of results) console.log(result);
  if (failed.length) process.exitCode = 1;
}

await main();
