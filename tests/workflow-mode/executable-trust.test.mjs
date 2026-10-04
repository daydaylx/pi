/**
 * Executable trust for Plan Mode shell commands (extensions/shared/
 * permission-policy.ts: resolveExecutableTrust / diagnosePlanModeCommand).
 *
 * The NixOS layout is modelled in a temp dir, so the suite proves the same on
 * every host:
 *
 *   <root>/nix/store/<hash>-coreutils/bin/coreutils        (multicall binary)
 *   <root>/nix/store/<hash>-system-path/bin/ls -> coreutils
 *   <root>/run/current-system/sw -> nix/store/<hash>-system-path
 *   <root>/home/user/.nix-profile -> nix/store/<hash>-user-profile
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { assert, eq, test } from "../shared/assertions.mjs";
import { importModule as load } from "../shared/jiti-loader.mjs";

const permissionPolicy = await load("extensions/shared/permission-policy.ts");
const workflowPolicy = await load("extensions/permissions/workflow-policy.ts");
const { createExecutableTrustPolicy, resolveExecutableTrust } =
  permissionPolicy;

const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-exec-trust-")));
const project = join(root, "project");
const planning = { mode: "detailed_plan" };

function executable(path) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
}

function link(target, path) {
  mkdirSync(join(path, ".."), { recursive: true });
  symlinkSync(target, path);
}

// --- Nix store: one multicall package (coreutils) plus single-binary packages.
const store = join(root, "nix", "store");
const coreutils = join(store, "aaaa-coreutils-9.5", "bin", "coreutils");
executable(coreutils);
const COREUTILS_NAMES = ["ls", "cat", "head", "tail", "wc", "stat", "du", "df"];
const SINGLE_PACKAGES = {
  find: join(store, "bbbb-findutils-4.10", "bin", "find"),
  git: join(store, "cccc-git-2.54", "bin", "git"),
  rg: join(store, "dddd-ripgrep-14", "bin", "rg"),
  tree: join(store, "eeee-tree-2.1", "bin", "tree"),
};
for (const path of Object.values(SINGLE_PACKAGES)) executable(path);

function fillProfile(profileStorePath) {
  for (const name of COREUTILS_NAMES) {
    link(coreutils, join(profileStorePath, "bin", name));
  }
  for (const [name, path] of Object.entries(SINGLE_PACKAGES)) {
    link(path, join(profileStorePath, "bin", name));
  }
}

// System profile (NixOS): /run/current-system/sw -> store path.
const systemPath = join(store, "ffff-system-path");
fillProfile(systemPath);
link(systemPath, join(root, "run", "current-system", "sw"));
const systemBin = join(root, "run", "current-system", "sw", "bin");

// Multi-user default profile: /nix/var/nix/profiles/default -> store path.
const defaultProfile = join(store, "gggg-default-profile");
fillProfile(defaultProfile);
link(defaultProfile, join(root, "nix", "var", "nix", "profiles", "default"));
const defaultBin = join(
  root,
  "nix",
  "var",
  "nix",
  "profiles",
  "default",
  "bin",
);

// User profile: same store targets, but NOT a system profile.
const userProfile = join(store, "hhhh-user-profile");
fillProfile(userProfile);
link(userProfile, join(root, "home", "user", ".nix-profile"));
const userBin = join(root, "home", "user", ".nix-profile", "bin");

// Classic distribution layout.
const classicBin = join(root, "usr", "bin");
for (const name of ["ls", "cat", "git", "find"])
  executable(join(classicBin, name));

// Project-controlled fake binaries.
const fakeBin = join(project, "bin");
for (const name of ["ls", "git", "find", "env", "rg"])
  executable(join(fakeBin, name));
executable(join(project, "ls"));
executable(join(project, "git"));
executable(join(project, "node_modules", ".bin", "ls"));
writeFileSync(join(project, "README.md"), "readme\n");

// A system-profile entry pointing outside the store must not be trusted.
const outside = join(root, "opt", "evil");
executable(outside);
link(outside, join(systemPath, "bin", "evil"));

const policy = createExecutableTrustPolicy({
  classicBinDirs: [classicBin],
  systemProfileBinDirs: [systemBin, defaultBin],
  systemProfileTargetRoots: [store],
  runtimeDiagnosticNames: [],
  path: "",
  cwd: project,
});
const resolveWith = (name, pathEnv) =>
  resolveExecutableTrust(name, project, policy, pathEnv);
const diagnose = (command, pathEnv) =>
  permissionPolicy.diagnosePlanModeCommand(command, project, {
    policy,
    pathEnv,
  });

const SYSTEM_PATH = [systemBin].join(delimiter);

await test("A: classic /usr/bin layout stays trusted, symlink escapes stay untrusted", () => {
  const result = resolveWith("ls", classicBin);
  assert(
    result.trusted && result.source === "classic-system",
    "classic ls is trusted",
  );
  eq(result.name, "ls", "classic name comes from the canonical basename");
  link(outside, join(classicBin, "escape"));
  const escaped = resolveWith("escape", classicBin);
  assert(
    !escaped.trusted && escaped.reason === "untrusted-source",
    "a classic dir entry that resolves outside the classic roots is untrusted",
  );
  assert(
    diagnose("git status --short", classicBin).safe,
    "git status --short passes",
  );
});

await test("B: NixOS system profile is trusted although the target is a store path", () => {
  for (const name of [...COREUTILS_NAMES, ...Object.keys(SINGLE_PACKAGES)]) {
    const result = resolveWith(name, SYSTEM_PATH);
    assert(
      result.trusted && result.source === "system-profile",
      `${name} found through /run/current-system/sw/bin is trusted`,
    );
    eq(result.name, name, `${name} keeps its invoked name (multicall-safe)`);
  }
  const multi = resolveWith("ls", defaultBin);
  assert(
    multi.trusted && multi.source === "system-profile",
    "the multi-user default profile is a system profile too",
  );
  const absolute = resolveWith(join(systemBin, "ls"), "");
  assert(
    absolute.trusted,
    "an absolute path through the system profile is trusted",
  );
});

await test("B: a system-profile entry outside the store is not trusted", () => {
  const result = resolveWith("evil", SYSTEM_PATH);
  assert(
    !result.trusted && result.reason === "invalid-target",
    "profile entry pointing outside the store is rejected",
  );
});

await test("C: a user Nix profile gets no system trust", () => {
  const viaPath = resolveWith("ls", userBin);
  assert(
    !viaPath.trusted && viaPath.reason === "untrusted-source",
    "~/.nix-profile/bin/ls found through PATH is untrusted",
  );
  const absolute = resolveWith(join(userBin, "ls"), SYSTEM_PATH);
  assert(
    !absolute.trusted && absolute.reason === "untrusted-source",
    "an absolute ~/.nix-profile path is untrusted",
  );
});

await test("D: the first PATH hit decides, there is no fallback to a later trusted hit", () => {
  const manipulated = [fakeBin, systemBin].join(delimiter);
  const result = resolveWith("ls", manipulated);
  assert(
    !result.trusted && result.reason === "untrusted-source",
    "project fake-bin/ls shadows the system ls and is rejected",
  );
  eq(result.path, join(fakeBin, "ls"), "the diagnosis names the first hit");
  const relativeEntry = resolveWith("ls", ["bin", systemBin].join(delimiter));
  assert(
    !relativeEntry.trusted,
    "a relative PATH entry resolves into the project",
  );
  const emptyEntry = resolveWith("ls", ["", systemBin].join(delimiter));
  assert(
    !emptyEntry.trusted || emptyEntry.path === undefined,
    "an empty PATH entry does not skip",
  );
  for (const command of [
    "ls",
    "git status --short",
    "find . -maxdepth 2 -type f",
  ]) {
    const diagnosis = diagnose(command, manipulated);
    assert(
      !diagnosis.safe && diagnosis.cause === "executable-untrusted",
      `${command} is blocked as untrusted executable under a manipulated PATH`,
    );
  }
});

await test("E: a /nix/store path alone is never a trust proof", () => {
  for (const path of [
    join(store, "bbbb-findutils-4.10", "bin", "find"),
    coreutils,
    join(systemPath, "bin", "ls"),
  ]) {
    const result = resolveWith(path, SYSTEM_PATH);
    assert(
      !result.trusted && result.reason === "untrusted-source",
      `${path.replace(root, "")} is untrusted when called directly`,
    );
  }
  const storeDirOnPath = resolveWith(
    "find",
    join(store, "bbbb-findutils-4.10", "bin"),
  );
  assert(
    !storeDirOnPath.trusted,
    "a bare store dir on PATH is not a system source",
  );
  assert(
    diagnose(
      `${join(store, "aaaa-coreutils-9.5", "bin", "coreutils")} -h`,
      SYSTEM_PATH,
    ).safe,
    "Plan Mode stays open: a direct store call is not project-planted, so it may read",
  );
});

await test("open Plan Mode: user profiles, dev-shell store paths and user bin dirs may read", () => {
  const userDir = join(root, "home", "user", ".local", "bin");
  executable(join(userDir, "python3"));
  for (const [command, pathEnv] of [
    ["ls", userBin],
    ["git status --short", userBin],
    ["rg foo .", [userBin, systemBin].join(delimiter)],
    ["python3 --version", userDir],
    ["find . -maxdepth 2 -type f", join(store, "bbbb-findutils-4.10", "bin")],
  ]) {
    const diagnosis = diagnose(command, pathEnv);
    assert(
      diagnosis.safe,
      `${command} is allowed (${JSON.stringify(diagnosis)})`,
    );
  }
  for (const command of ["ls > out.txt", "find . -delete"]) {
    assert(
      !diagnose(command, userBin).safe,
      `${command} stays blocked via a user profile`,
    );
  }
});

await test("F: the original regressions and the read-only toolset pass on a NixOS layout", () => {
  for (const command of [
    "ls",
    "ls -la",
    "pwd",
    "tree",
    "cat README.md",
    "head README.md",
    "tail README.md",
    "wc README.md",
    "stat README.md",
    "du -sh .",
    "df -h",
    'rg "foo" .',
    "find . -maxdepth 2 -type f",
    "git status --short",
    "git --no-pager diff --no-ext-diff --no-textconv --stat",
    "git --no-pager log -n 1",
  ]) {
    const diagnosis = diagnose(command, SYSTEM_PATH);
    assert(
      diagnosis.safe,
      `${command} is allowed (${JSON.stringify(diagnosis)})`,
    );
  }
});

await test("G: mutations, composition, fake binaries and secrets stay blocked", () => {
  const notAllowed = [
    "find . -delete",
    "find . -exec touch {} \\;",
    "find . -execdir rm {} \\;",
    "find . -ok rm {} \\;",
    "ls && touch foo",
    "ls ; touch foo",
    "cat README.md | sh",
    "ls > foo",
    "ls >> foo",
    "cat .env",
    "cat .env.local",
    "cat credentials.json",
    "cat auth.json",
    "cat id_rsa",
    "cat id_ed25519",
    "cat server.pem",
  ];
  for (const command of notAllowed) {
    const diagnosis = diagnose(command, SYSTEM_PATH);
    assert(
      !diagnosis.safe && diagnosis.cause === "command-not-allowed",
      `${command} is rejected by the allow policy (${JSON.stringify(diagnosis)})`,
    );
  }
  const untrusted = [
    "./ls",
    "./git status",
    "./bin/ls",
    "bin/ls",
    "../project/ls",
    "node_modules/.bin/ls",
    `${join(project, "ls")}`,
    "PATH=./bin ls",
    "LD_PRELOAD=./evil.so ls",
    "env ls",
  ];
  for (const command of untrusted) {
    const pathEnv =
      command === "env ls" ? [fakeBin, systemBin].join(delimiter) : SYSTEM_PATH;
    const diagnosis = diagnose(command, pathEnv);
    assert(
      !diagnosis.safe && diagnosis.cause === "executable-untrusted",
      `${command} is rejected as untrusted executable (${JSON.stringify(diagnosis)})`,
    );
  }
});

await test("G: a missing bare name is not an executable-trust failure, a missing path is", () => {
  assert(
    diagnose("not-installed-anywhere --version", SYSTEM_PATH).safe,
    "bare unknown name passes the gate",
  );
  const missingPath = diagnose(join(root, "nope", "ls"), SYSTEM_PATH);
  assert(
    missingPath.safe,
    "a missing absolute path outside the project cannot run, so it is not refused",
  );
});

await test("planModeBashGuard reports why a command was refused", () => {
  const original = process.env.PATH;
  try {
    process.env.PATH = [fakeBin, original ?? ""].join(delimiter);
    const untrusted = workflowPolicy.planModeBashGuard(
      planning,
      "project-write",
      "ls",
      project,
    );
    assert(untrusted.blocked, "ls shadowed by a project binary is blocked");
    eq(
      untrusted.planModeCause,
      "executable-untrusted",
      "cause: executable-untrusted",
    );
    assert(
      untrusted.reason.includes("im Projekt"),
      "the message names the project-controlled PATH hit",
    );
    const mutating = workflowPolicy.planModeBashGuard(
      planning,
      "project-write",
      "find . -delete",
      project,
    );
    assert(mutating.blocked, "find -delete is blocked");
    eq(
      mutating.planModeCause,
      "command-not-allowed",
      "cause: command-not-allowed",
    );
    assert(
      !mutating.reason.includes("im Projekt"),
      "the allow-policy message does not mention executable trust",
    );
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  }
});

await test("planModeBashGuard allows the original regression commands on this host", () => {
  // Uses the real PATH and the default trust policy: on classic distributions
  // the tools resolve through /usr/bin, on NixOS through
  // /run/current-system/sw/bin. A tool that is not installed passes the gate
  // (nothing can be started), so this never depends on what the host ships.
  for (const command of [
    "ls",
    "find . -maxdepth 2 -type f",
    "git status --short",
  ]) {
    const result = workflowPolicy.planModeBashGuard(
      planning,
      "project-write",
      command,
      process.cwd(),
    );
    assert(
      !result.blocked,
      `${command} is allowed on this host (${result.reason})`,
    );
  }
});

rmSync(root, { recursive: true, force: true });
