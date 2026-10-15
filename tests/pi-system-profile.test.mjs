import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  applySystemCliLink,
  applyUserCliLink,
  planSystemCliLink,
  planUserCliLink,
} from "../scripts/install-user.mjs";
import { resolveRuntimeRoot } from "../shared/runtime-resolution.mjs";
import { importModule } from "./shared/jiti-loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(path.join(tmpdir(), "pi-system-profile-"));

function restoreEnv(key, previous) {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

try {
  const runtimeRoot = path.join(tempRoot, "runtime");
  const runtimeBin = path.join(runtimeRoot, "dist", "bundle", "cli.js");
  const agentDir = path.join(tempRoot, "agent");
  const home = path.join(tempRoot, "home");
  mkdirSync(path.dirname(runtimeBin), { recursive: true });
  writeFileSync(
    path.join(runtimeRoot, "package.json"),
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version: "1.0.4",
    }),
  );
  writeFileSync(
    runtimeBin,
    `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({argv: process.argv.slice(2), cwd: process.cwd(), profile: process.env.PI_LAUNCH_PROFILE, systemWorkspace: process.env.PI_SYSTEM_WORKSPACE, systemSessions: process.env.PI_SYSTEM_SESSION_DIR, sessionDirEnv: process.env.PI_CODING_AGENT_SESSION_DIR}));\n`,
  );
  chmodSync(runtimeBin, 0o755);

  const normal = spawnSync(
    "bash",
    [path.join(ROOT, "bin", "pi"), "--version", "--", "--approve"],
    {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: agentDir,
        PI_RUNTIME_ROOT: runtimeRoot,
        PI_LAUNCH_PROFILE: "system",
        PI_SYSTEM_WORKSPACE: "/forged/workspace",
        PI_SYSTEM_SESSION_DIR: "/forged/sessions",
        PI_CODING_AGENT_SESSION_DIR: "/forged/sessions",
      },
    },
  );
  assert.equal(normal.status, 0, normal.stderr);
  const normalRun = JSON.parse(normal.stdout);
  assert.deepEqual(normalRun.argv, ["--version", "--", "--approve"]);
  assert.equal(normalRun.cwd, tempRoot);
  assert.equal(normalRun.profile, undefined);
  assert.equal(normalRun.systemWorkspace, undefined);
  assert.equal(normalRun.systemSessions, undefined);
  assert.equal(normalRun.sessionDirEnv, undefined);

  const systemProject = path.join(tempRoot, "some-project");
  mkdirSync(systemProject, { recursive: true });
  const system = spawnSync(
    path.join(ROOT, "bin", "pis"),
    [
      "--continue",
      "--model",
      "local/test",
      "--thinking",
      "high",
      "--",
      "--session-dir bleibt hier Text",
    ],
    {
      cwd: systemProject,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: agentDir,
        PI_RUNTIME_ROOT: runtimeRoot,
      },
    },
  );
  assert.equal(system.status, 0, system.stderr);
  const systemRun = JSON.parse(system.stdout);
  const profileState = path.join(agentDir, "profile-state", "system");
  const systemWorkspace = path.join(profileState, "workspace");
  const systemSessions = path.join(profileState, "sessions");
  assert.deepEqual(systemRun.argv.slice(0, 4), [
    "--session-dir",
    systemSessions,
    "--no-approve",
    "--no-context-files",
  ]);
  assert.deepEqual(systemRun.argv.slice(4), [
    "--continue",
    "--model",
    "local/test",
    "--thinking",
    "high",
    "--",
    "--session-dir bleibt hier Text",
  ]);
  assert.equal(systemRun.cwd, systemWorkspace);
  assert.equal(systemRun.profile, "system");
  assert.equal(systemRun.systemWorkspace, systemWorkspace);
  assert.equal(systemRun.systemSessions, systemSessions);
  assert.equal(systemRun.sessionDirEnv, systemSessions);
  for (const directory of [profileState, systemWorkspace, systemSessions]) {
    assert.equal(statSync(directory).mode & 0o777, 0o700);
  }

  const rejectedApproval = spawnSync(
    path.join(ROOT, "bin", "pi"),
    ["system", "--approve"],
    {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: agentDir,
        PI_RUNTIME_ROOT: runtimeRoot,
      },
    },
  );
  assert.equal(rejectedApproval.status, 64);
  assert.match(rejectedApproval.stderr, /--approve ist in pis gesperrt/);

  const outsideSession = path.join(tempRoot, "project-session.jsonl");
  writeFileSync(outsideSession, "unverändert\n");
  const rejectedSession = spawnSync(
    path.join(ROOT, "bin", "pis"),
    ["--session", outsideSession],
    {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: agentDir,
        PI_RUNTIME_ROOT: runtimeRoot,
      },
    },
  );
  assert.equal(rejectedSession.status, 64);
  assert.match(
    rejectedSession.stderr,
    /keine Sitzung außerhalb seines Profils/,
  );
  assert.equal(readFileSync(outsideSession, "utf8"), "unverändert\n");

  const inProfileSession = path.join(systemSessions, "resume.jsonl");
  writeFileSync(inProfileSession, "{}\n");
  const acceptedSession = spawnSync(
    path.join(ROOT, "bin", "pis"),
    ["--session", inProfileSession],
    {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: agentDir,
        PI_RUNTIME_ROOT: runtimeRoot,
      },
    },
  );
  assert.equal(acceptedSession.status, 0, acceptedSession.stderr);
  assert.ok(JSON.parse(acceptedSession.stdout).argv.includes(inProfileSession));

  const runtimeWrapperAgent = path.join(tempRoot, "runtime-wrapper-agent");
  const wrappedRuntime = spawnSync(
    "bash",
    [path.join(ROOT, "bin", "pi-system-runtime"), "--mode", "rpc"],
    {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: runtimeWrapperAgent,
        PI_RUNTIME_ROOT: runtimeRoot,
        PI_LAUNCH_PROFILE: "project",
        PI_CODING_AGENT_SESSION_DIR: "/forged/sessions",
      },
    },
  );
  assert.equal(wrappedRuntime.status, 0, wrappedRuntime.stderr);
  const wrappedRun = JSON.parse(wrappedRuntime.stdout);
  const wrappedState = path.join(
    runtimeWrapperAgent,
    "profile-state",
    "system",
  );
  const wrappedWorkspace = path.join(wrappedState, "workspace");
  const wrappedSessions = path.join(wrappedState, "sessions");
  assert.deepEqual(wrappedRun.argv, [
    "--no-approve",
    "--no-context-files",
    "--session-dir",
    wrappedSessions,
    "--mode",
    "rpc",
  ]);
  assert.equal(wrappedRun.cwd, wrappedWorkspace);
  assert.equal(wrappedRun.profile, "system");
  assert.equal(wrappedRun.sessionDirEnv, wrappedSessions);

  const hostSessions = path.join(wrappedState, "host-sessions");
  const wrappedHostRuntime = spawnSync(
    "bash",
    [path.join(ROOT, "bin", "pi-system-runtime"), "--mode", "rpc"],
    {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: runtimeWrapperAgent,
        PI_RUNTIME_ROOT: runtimeRoot,
        PI_SYSTEM_SESSION_DIR: hostSessions,
      },
    },
  );
  assert.equal(wrappedHostRuntime.status, 0, wrappedHostRuntime.stderr);
  assert.equal(
    JSON.parse(wrappedHostRuntime.stdout).sessionDirEnv,
    hostSessions,
  );

  const escapedHostRuntime = spawnSync(
    "bash",
    [path.join(ROOT, "bin", "pi-system-runtime"), "--mode", "rpc"],
    {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: runtimeWrapperAgent,
        PI_RUNTIME_ROOT: runtimeRoot,
        PI_SYSTEM_SESSION_DIR: path.join(tempRoot, "outside-sessions"),
      },
    },
  );
  assert.equal(escapedHostRuntime.status, 73);
  assert.match(escapedHostRuntime.stderr, /verwalteten Pi-System-Profil/);

  const runtimeWrapperApproval = spawnSync(
    "bash",
    [path.join(ROOT, "bin", "pi-system-runtime"), "--approve"],
    {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: runtimeWrapperAgent,
        PI_RUNTIME_ROOT: runtimeRoot,
      },
    },
  );
  assert.equal(runtimeWrapperApproval.status, 64);
  assert.match(
    runtimeWrapperApproval.stderr,
    /Approval und Sitzungsverzeichnis/,
  );

  const fallbackRuntimeRoot = path.join(tempRoot, "configured-agent");
  const fallbackPackage = path.join(
    fallbackRuntimeRoot,
    "npm",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  mkdirSync(fallbackPackage, { recursive: true });
  writeFileSync(
    path.join(fallbackPackage, "package.json"),
    JSON.stringify({ name: "@earendil-works/pi-coding-agent" }),
  );
  const wrapperDir = path.join(tempRoot, "wrapper-path");
  mkdirSync(wrapperDir, { recursive: true });
  writeFileSync(path.join(wrapperDir, "pi"), "#!/bin/sh\n");
  assert.deepEqual(
    resolveRuntimeRoot({
      env: {
        PATH: wrapperDir,
        PI_CODING_AGENT_DIR: fallbackRuntimeRoot,
      },
    }),
    { root: fallbackPackage, source: "PI_CODING_AGENT_DIR" },
  );

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousLaunchProfile = process.env.PI_LAUNCH_PROFILE;
  const setupAgentDir = path.join(tempRoot, "setup-agent");
  const projectDir = path.join(tempRoot, "project-config");
  const globalSetupPath = path.join(setupAgentDir, "setup.json");
  const systemSetupPath = path.join(
    setupAgentDir,
    "profile-state",
    "system",
    "setup.json",
  );
  mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
  mkdirSync(path.dirname(systemSetupPath), { recursive: true });
  writeFileSync(
    globalSetupPath,
    JSON.stringify({ ui: { dashboard: "hidden" } }),
  );
  writeFileSync(
    systemSetupPath,
    JSON.stringify({ ui: { dashboard: "compact" } }),
  );
  writeFileSync(
    path.join(projectDir, ".pi", "setup.json"),
    JSON.stringify({ ui: { theme: "aurora-forge", motion: "off" } }),
  );
  process.env.PI_CODING_AGENT_DIR = setupAgentDir;
  process.env.PI_LAUNCH_PROFILE = "system";
  try {
    const setup = await importModule("extensions/setup-core/config.ts");
    const loaded = setup.loadSetupConfig(projectDir, true);
    assert.equal(loaded.config.ui.theme, "aurora-system");
    assert.equal(loaded.config.ui.dashboard, "compact");
    assert.equal(loaded.config.ui.motion, "contextual");
    assert.deepEqual(loaded.sources, [systemSetupPath]);
    await setup.persistUiPreference({ dashboard: "expanded" });
    assert.equal(
      JSON.parse(readFileSync(systemSetupPath, "utf8")).ui.dashboard,
      "expanded",
    );
    assert.equal(
      JSON.parse(readFileSync(globalSetupPath, "utf8")).ui.dashboard,
      "hidden",
    );
  } finally {
    restoreEnv("PI_CODING_AGENT_DIR", previousAgentDir);
    restoreEnv("PI_LAUNCH_PROFILE", previousLaunchProfile);
  }

  const linkHome = path.join(tempRoot, "link-home");
  const linkAgent = path.join(linkHome, ".pi", "agent");
  const linkCommand = path.join(linkHome, ".local", "bin", "pi");
  const installedRuntimeLink = path.join(
    linkAgent,
    "npm",
    "node_modules",
    ".bin",
    "pi",
  );
  const installedRuntime = path.join(tempRoot, "installed-runtime");
  const installedLauncher = path.join(linkAgent, "bin", "pi");
  mkdirSync(path.dirname(installedRuntimeLink), { recursive: true });
  mkdirSync(path.dirname(installedLauncher), { recursive: true });
  mkdirSync(path.dirname(linkCommand), { recursive: true });
  writeFileSync(installedRuntime, "runtime\n");
  writeFileSync(installedLauncher, "#!/bin/sh\n");
  chmodSync(installedLauncher, 0o755);
  symlinkSync(installedRuntime, installedRuntimeLink);
  symlinkSync(installedRuntimeLink, linkCommand);
  const linkPlan = planUserCliLink(linkAgent, linkHome);
  assert.equal(linkPlan.status, "replace");
  assert.equal(applyUserCliLink(linkPlan).status, "linked");
  assert.equal(realpathSync(linkCommand), realpathSync(installedLauncher));
  assert.equal(readlinkSync(linkCommand), installedLauncher);
  assert.equal(planUserCliLink(linkAgent, linkHome).status, "keep");

  const systemCommand = path.join(linkHome, ".local", "bin", "pis");
  const installedSystemLauncher = path.join(linkAgent, "bin", "pis");
  writeFileSync(installedSystemLauncher, "#!/bin/sh\n");
  chmodSync(installedSystemLauncher, 0o755);
  const systemLinkPlan = planSystemCliLink(linkAgent, linkHome);
  assert.equal(systemLinkPlan.status, "create");
  assert.equal(applySystemCliLink(systemLinkPlan).status, "linked");
  assert.equal(
    realpathSync(systemCommand),
    realpathSync(installedSystemLauncher),
  );
  assert.equal(readlinkSync(systemCommand), installedSystemLauncher);
  assert.equal(planSystemCliLink(linkAgent, linkHome).status, "keep");

  const racingSystemHome = path.join(tempRoot, "racing-system-home");
  const racingSystemCommand = path.join(
    racingSystemHome,
    ".local",
    "bin",
    "pis",
  );
  const racingSystemPlan = planSystemCliLink(linkAgent, racingSystemHome);
  assert.equal(racingSystemPlan.status, "create");
  mkdirSync(path.dirname(racingSystemCommand), { recursive: true });
  writeFileSync(racingSystemCommand, "concurrent user command\n");
  assert.throws(
    () => applySystemCliLink(racingSystemPlan),
    /keine verwaltete Symlink-Datei/,
  );
  assert.equal(
    readFileSync(racingSystemCommand, "utf8"),
    "concurrent user command\n",
  );

  const protectedHome = path.join(tempRoot, "protected-home");
  const protectedCommand = path.join(protectedHome, ".local", "bin", "pi");
  mkdirSync(path.dirname(protectedCommand), { recursive: true });
  writeFileSync(protectedCommand, "user command\n");
  assert.throws(
    () => planUserCliLink(linkAgent, protectedHome),
    /keine verwaltete Symlink-Datei/,
  );
  assert.equal(readFileSync(protectedCommand, "utf8"), "user command\n");

  const protectedSystemHome = path.join(tempRoot, "protected-system-home");
  const protectedSystemCommand = path.join(
    protectedSystemHome,
    ".local",
    "bin",
    "pis",
  );
  mkdirSync(path.dirname(protectedSystemCommand), { recursive: true });
  writeFileSync(protectedSystemCommand, "user system command\n");
  assert.throws(
    () => planSystemCliLink(linkAgent, protectedSystemHome),
    /keine verwaltete Symlink-Datei/,
  );
  assert.equal(
    readFileSync(protectedSystemCommand, "utf8"),
    "user system command\n",
  );

  console.log(
    "PASS: pis launch, profile state, theme config and CLI link safety",
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
