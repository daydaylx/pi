import { strict as assert } from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHarness } from "./shared/harness.mjs";
import { importModule } from "./shared/jiti-loader.mjs";

const collector = await importModule("extensions/system-context/collector.mjs");
const extension = await importModule("extensions/system-context/index.ts");
const repos = await importModule("extensions/system-context/repos.mjs");
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

test("collector strips C0 control characters while preserving valid text", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-context-"));
  try {
    const osReleasePath = path.join(temp, "os-release");
    writeFileSync(
      osReleasePath,
      'ID=nixos\nNAME="Nix\u0000\u0007OS\u001F\u007F-24.11"\nVERSION="24.11\tStable"\n',
    );
    const value = collector.collectSystemContext(["system"], {
      home: temp,
      cwd: temp,
      etcNixos: path.join(temp, "missing"),
      osReleasePath,
      currentSystemPath: path.join(temp, "missing-current"),
      profileSystemPath: path.join(temp, "missing-profile"),
      commandRunner(command) {
        if (command === "nixos-version") {
          return {
            available: true,
            exitCode: 0,
            stdout: "24.11pre\u0001\u0008\u001F\u007F (Vicuna)\t[ok]\n",
          };
        }
        return { available: false, reason: "unavailable" };
      },
      now: () => "2026-10-12T00:00:00.000Z",
    });
    // Befund-Test: C0-Steuerzeichen wurden gefiltert
    assert.equal(value.system.os.NAME, "NixOS-24.11");
    assert.equal(value.system.nixosVersion, "24.11pre (Vicuna)\t[ok]");
    // Gegenprobe: Legitime Tabs bleiben erhalten
    assert.equal(value.system.os.VERSION, "24.11\tStable");
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

test("system skills are native SKILL.md files with routing descriptions", () => {
  const root = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "extensions",
    "system-context",
    "skills",
  );
  for (const name of ["nixos-system", "hyprland-desktop", "system-health"]) {
    const text = readFileSync(path.join(root, name, "SKILL.md"), "utf8");
    assert.match(
      text,
      new RegExp(`^---\\nname: ${name}\\ndescription: .{40,}`),
    );
    assert.ok(text.length < 2500, `${name} bleibt kurz`);
    assert.doesNotMatch(text, /Plan-Gates?|Planmodus/);
  }
  assert.match(
    readFileSync(path.join(root, "nixos-system", "SKILL.md"), "utf8"),
    /Offline-Evaluation/,
  );
  assert.equal(collector.systemSkillContext, undefined);
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
    const discovered = await harness.runHooks(
      "resources_discover",
      { cwd: ctx.cwd, reason: "startup" },
      ctx,
    );
    assert.ok(
      discovered
        .at(-1)
        .skillPaths.some((dir) =>
          dir.endsWith(path.join("system-context", "skills")),
        ),
      "native skill discovery receives the system skill directory",
    );
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
    // Extension-triggered runs have no user prompt: base context only.
    const collected = requests.length;
    configRevision = "revision-3";
    const custom = await harness.runHooks(
      "before_agent_start",
      { messageType: "custom", message: {}, systemPrompt: "base" },
      ctx,
    );
    assert.ok(
      custom
        .at(-1)
        .systemPrompt.includes("[SYSTEM CONTEXT — OBSERVATIONAL DATA]"),
    );
    assert.deepEqual(requests.slice(collected), [["system"]]);
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
  const runPrompt = (profile, prompt, extra = {}) => {
    const harness = createHarness();
    const collected = [];
    extension.registerSystemContext(harness.api, {
      profile: () => profile,
      collect(categories) {
        collected.push(categories);
        return { system: { configuration: { revision: "r" } } };
      },
      discoverConfig: () => ({ revision: "r" }),
      repoContext: () => extra.repos,
    });
    const hook = harness.hooks.get("before_agent_start")?.[0];
    assert.ok(hook, "before_agent_start registered");
    const result = hook(
      { prompt, systemPrompt: "BASE", messageType: "user" },
      { cwd: "/tmp" },
    );
    return { result, collected };
  };
  test("project profile adds no system context to ordinary coding prompts", () => {
    for (const prompt of [
      "Untersuche mein Lager-Projekt auf Fehler",
      "Refactor the log dialog and fix the last failing test",
      "Prüfe die Integration zwischen Pi und QuickPanel",
    ]) {
      const { result, collected } = runPrompt("project", prompt);
      assert.equal(result, undefined, prompt);
      assert.deepEqual(collected, [], prompt);
    }
  });
  test("project profile loads system context only for clear system requests", () => {
    const { result, collected } = runPrompt(
      "project",
      "Zeige mir die aktuelle CPU- und RAM-Auslastung",
    );
    assert.ok(result.systemPrompt.startsWith("BASE"));
    assert.ok(result.systemPrompt.includes("[SYSTEM CONTEXT"));
    assert.ok(!result.systemPrompt.includes("[SYSTEM ACCESS]"));
    assert.deepEqual(collected.flat().sort(), ["health", "system"]);
  });
  test("a repository named in the prompt is added without system context", () => {
    const { result, collected } = runPrompt("project", "Prüfe das Lager", {
      repos: "[KNOWN REPOSITORIES — OBSERVATIONAL DATA]\n- lager: /x/lager",
    });
    assert.ok(result.systemPrompt.includes("- lager: /x/lager"));
    assert.ok(result.systemPrompt.includes("workspace_add once"));
    assert.ok(!result.systemPrompt.includes("[SYSTEM CONTEXT"));
    assert.deepEqual(collected, []);
  });
  test("strict categories need whole system words", () => {
    const strict = collector.strictCategoriesForRequest;
    assert.deepEqual(strict("Fehler im Dialog, log last"), []);
    assert.deepEqual(strict("RAM und CPU?").sort(), ["health"]);
    assert.deepEqual(strict("Hyprland Fenster").sort(), ["desktop"]);
    assert.deepEqual(strict("Meine NixOS-Konfiguration").sort(), [
      "flake",
      "project",
    ]);
    assert.deepEqual(strict("programm"), []);
  });
  test("repo discovery is bounded, cached, finds names and sub-directories", () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "pi-repos-"));
    try {
      const home = path.join(temp, "home");
      for (const repo of [
        "Projekte/lager",
        "Projekte/pi",
        "nixos-config",
        "Downloads/ignored",
      ]) {
        mkdirSync(path.join(home, repo, ".git"), { recursive: true });
      }
      mkdirSync(path.join(home, "nixos-config", "quickpanel"));
      mkdirSync(
        path.join(home, "Projekte", "plain", "deep", "deeper", "x", ".git"),
        {
          recursive: true,
        },
      );
      repos.resetRepoCache();
      const found = repos.discoverRepos({ home, env: {} });
      assert.deepEqual(
        found.map((repo) => repo.name),
        ["nixos-config", "lager", "pi"],
      );
      const options = { home, env: {}, cwd: path.join(home, "Projekte", "pi") };
      const lager = repos.repoContextForRequest(
        "Untersuche mein Lager-Projekt auf Fehler",
        options,
      );
      assert.ok(
        lager.includes(`lager: ${path.join(home, "Projekte", "lager")}`),
      );
      assert.ok(!lager.includes("nixos-config"));
      const panel = repos.repoContextForRequest("Prüfe QuickPanel", options);
      assert.ok(panel.includes("nixos-config"), "matched via top-level dir");
      // The current project is never repeated and unrelated prompts match nothing.
      assert.equal(
        repos.repoContextForRequest("Optimiere pi", options),
        undefined,
      );
      assert.equal(
        repos.repoContextForRequest("Was ist 2+2?", options),
        undefined,
      );
    } finally {
      repos.resetRepoCache();
      rmSync(temp, { recursive: true, force: true });
    }
  });
  const failed = results.filter((result) => result.includes("FAIL"));
  for (const result of results) console.log(result);
  if (failed.length) process.exitCode = 1;
}

await main();
