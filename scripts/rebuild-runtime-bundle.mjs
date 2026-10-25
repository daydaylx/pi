/** Rebuild pinned published JavaScript artifacts; never replace an installed runtime. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertNoSymlinkComponents,
  EXPECTED_RUNTIME_VERSION,
} from "./apply-runtime-patches.mjs";
import { probeBundledRuntime } from "./check-bundled-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NPM = path.join(ROOT, "npm");
const INPUTS = JSON.parse(
  readFileSync(new URL("./runtime-build-inputs.json", import.meta.url), "utf8"),
);
const digest = (bytes, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");

export function assertBuildOutput(output, base = path.join(ROOT, ".agent")) {
  const target = path.resolve(output);
  if (!target.startsWith(path.resolve(base) + path.sep))
    throw new Error("Build output must be inside the setup's .agent directory");
  assertNoSymlinkComponents(target);
  if (existsSync(target))
    throw new Error("Build output already exists; choose a fresh directory");
  return target;
}

export function verifyIntegrity(bytes, integrity) {
  const match = /^(sha256|sha512)-([A-Za-z0-9+/=]+)$/.exec(integrity ?? "");
  if (
    !match ||
    createHash(match[1]).update(bytes).digest("base64") !== match[2]
  )
    throw new Error("Build input integrity mismatch");
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${program} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`,
    );
  return result.stdout;
}

async function pinnedDownload(url, integrity, cache, filename) {
  const target = path.join(cache, filename);
  assertNoSymlinkComponents(target);
  if (existsSync(target)) {
    const bytes = readFileSync(target);
    verifyIntegrity(bytes, integrity);
    return { target, bytes };
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok)
    throw new Error(`Build input fetch failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyIntegrity(bytes, integrity);
  writeFileSync(target, bytes, { flag: "wx" });
  return { target, bytes };
}

function dependencyManifest(directory) {
  let current = directory;
  while (current !== path.dirname(current)) {
    const file = path.join(current, "package.json");
    if (existsSync(file))
      return { ...JSON.parse(readFileSync(file, "utf8")), root: current };
    current = path.dirname(current);
  }
  throw new Error(`No dependency manifest for ${directory}`);
}

export function bundleInputEvidence(
  metafiles,
  output,
  expected = INPUTS.lockedSecurityDependencies,
) {
  const dependencyRoot = realpathSync(path.join(NPM, "node_modules"));
  const inputs = {},
    securityDependencies = {};
  for (const file of new Set(
    metafiles.flatMap((meta) => Object.keys(meta.inputs)),
  )) {
    // Virtual modules are defined by the checksum-pinned upstream plugins.
    if (
      file.startsWith("lazy-jiti:") ||
      file.startsWith("https-proxy-agent-named-export:")
    )
      continue;
    const absolute = realpathSync(path.resolve(output, file));
    if (
      !absolute.startsWith(output + path.sep) &&
      !absolute.startsWith(dependencyRoot + path.sep)
    )
      throw new Error(`Input outside declared build roots: ${file}`);
    inputs[file] = digest(readFileSync(absolute));
    if (
      Object.keys(expected).some((name) =>
        absolute.includes(`${path.sep}${name}${path.sep}`),
      )
    ) {
      const meta = dependencyManifest(path.dirname(absolute));
      if (Object.hasOwn(expected, meta.name)) {
        if (meta.version !== expected[meta.name])
          throw new Error(`Unexpected bundled ${meta.name}: ${meta.version}`);
        securityDependencies[meta.name] = meta.version;
      }
    }
  }
  for (const name of INPUTS.requiredBundledDependencies)
    if (!securityDependencies[name])
      throw new Error(`No proven bundle input for ${name}`);
  return { inputs, securityDependencies };
}

export async function rebuildRuntimeBundle(requestedOutput) {
  if (INPUTS.runtimeVersion !== EXPECTED_RUNTIME_VERSION)
    throw new Error("Build pin and runtime patch version differ");
  const require = createRequire(path.join(NPM, "package.json"));
  if (require("esbuild").version !== INPUTS.esbuildVersion)
    throw new Error("Unexpected esbuild version");
  command("tar", ["--version"]);
  const output = assertBuildOutput(requestedOutput);
  const pipelineSources = Object.fromEntries(
    [
      "scripts/rebuild-runtime-bundle.mjs",
      "scripts/apply-runtime-patches.mjs",
      "scripts/check-bundled-runtime.mjs",
      "scripts/runtime-build-inputs.json",
      "tests/p1-runtime.mjs",
    ].map((file) => [file, digest(readFileSync(path.join(ROOT, file)))]),
  );
  const lockBytes = readFileSync(path.join(NPM, "package-lock.json"));
  const lock = JSON.parse(lockBytes);
  for (const [name, version] of Object.entries(
    INPUTS.lockedSecurityDependencies,
  )) {
    if (lock.packages[`node_modules/${name}`]?.version !== version)
      throw new Error(`Lockfile must pin ${name} to ${version}`);
  }
  const cache = path.join(ROOT, ".agent", "runtime-build-cache");
  assertNoSymlinkComponents(cache);
  mkdirSync(cache, { recursive: true });
  mkdirSync(output, { recursive: true });
  const nodeModules = path.join(output, "node_modules");
  mkdirSync(path.join(nodeModules, "@earendil-works"), { recursive: true });
  const upstreamFiles = {};
  for (const [file, sha256] of Object.entries(INPUTS.upstreamFiles)) {
    const url = `https://raw.githubusercontent.com/earendil-works/pi/${INPUTS.upstreamCommit}/${file}`;
    const integrity = "sha256-" + Buffer.from(sha256, "hex").toString("base64");
    const { bytes } = await pinnedDownload(url, integrity, cache, sha256);
    const target = path.join(output, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: "wx" });
    upstreamFiles[file] = { url, sha256 };
  }
  const packages = {};
  for (const [name, directory] of Object.entries(INPUTS.packages)) {
    const fullName = `@earendil-works/${name}`;
    const pinned = lock.packages[`node_modules/${fullName}`];
    if (
      pinned?.version !== INPUTS.runtimeVersion ||
      !pinned.resolved?.startsWith(
        "https://registry.npmjs.org/@earendil-works/",
      )
    )
      throw new Error(`Unexpected published input for ${fullName}`);
    const { target } = await pinnedDownload(
      pinned.resolved,
      pinned.integrity,
      cache,
      `${name}-${pinned.version}.tgz`,
    );
    const destination = path.join(output, "packages", directory);
    mkdirSync(destination, { recursive: true });
    // npm integrity is verified before extracting into this fresh staging tree.
    command("tar", [
      "-xzf",
      target,
      "--strip-components=1",
      "--no-same-owner",
      "--no-same-permissions",
      "-C",
      destination,
    ]);
    const installed = path.join(NPM, "node_modules", fullName);
    const installedMeta = JSON.parse(
      readFileSync(path.join(installed, "package.json"), "utf8"),
    );
    const publishedMeta = JSON.parse(
      readFileSync(path.join(destination, "package.json"), "utf8"),
    );
    if (
      installedMeta.name !== fullName ||
      publishedMeta.name !== fullName ||
      installedMeta.version !== pinned.version ||
      publishedMeta.version !== pinned.version
    )
      throw new Error(`Package identity mismatch: ${fullName}`);
    const nested = path.join(installed, "node_modules");
    if (existsSync(path.join(destination, "node_modules")))
      throw new Error("Published workspace contains a sealed dependency tree");
    if (existsSync(nested))
      symlinkSync(nested, path.join(destination, "node_modules"), "dir");
    symlinkSync(
      destination,
      path.join(nodeModules, "@earendil-works", name),
      "dir",
    );
    packages[fullName] = {
      version: pinned.version,
      resolved: pinned.resolved,
      integrity: pinned.integrity,
    };
  }
  for (const name of readdirSync(path.join(NPM, "node_modules"))) {
    if (name.startsWith(".") || name === "@earendil-works") continue;
    symlinkSync(
      path.join(NPM, "node_modules", name),
      path.join(nodeModules, name),
      "dir",
    );
  }
  const buildScript = path.join(
    output,
    "scripts/build-coding-agent-bundle.mjs",
  );
  // Preserve every build option; only persist the upstream build's existing metafiles.
  const originalBuildScript = readFileSync(buildScript, "utf8");
  writeFileSync(
    buildScript,
    originalBuildScript +
      '\nwriteFileSync(join(repoRoot, "metafiles.json"), JSON.stringify(metafiles));\n',
  );
  const buildLog = command(process.execPath, [buildScript], { cwd: output });
  const metafiles = JSON.parse(
    readFileSync(path.join(output, "metafiles.json"), "utf8"),
  );
  const evidence = bundleInputEvidence(metafiles, output);
  if (!readFileSync(path.join(NPM, "package-lock.json")).equals(lockBytes))
    throw new Error("Dependency lock changed during build");
  const runtime = path.join(output, "packages/coding-agent");
  const patchLog = command(process.execPath, [
    path.join(ROOT, "scripts/apply-runtime-patches.mjs"),
    "--apply",
    "--runtime",
    runtime,
  ]);
  const runtimeCheck = command(process.execPath, [
    path.join(ROOT, "tests/p1-runtime.mjs"),
    "--runtime",
    runtime,
  ]);
  const sri = probeBundledRuntime(runtime);
  if (!sri.passed)
    throw new Error("Rebuilt embedded Undici failed SRI regression");
  const outputs = {};
  for (const file of new Set(
    metafiles.flatMap((meta) => Object.keys(meta.outputs)),
  )) {
    const absolute = path.resolve(output, file);
    outputs[file] = {
      sha256: digest(readFileSync(absolute)),
      bytes: statSync(absolute).size,
    };
  }
  const launcher = "packages/coding-agent/dist/bundle/cli.js";
  outputs[launcher] = {
    sha256: digest(readFileSync(path.join(output, launcher))),
  };
  for (const [file, sha256] of Object.entries(pipelineSources)) {
    if (digest(readFileSync(path.join(ROOT, file))) !== sha256)
      throw new Error(`Pipeline changed during build: ${file}`);
  }
  const artifactSha256 = digest(
    JSON.stringify(
      Object.keys(outputs)
        .sort()
        .map((file) => [file, outputs[file].sha256]),
    ),
  );
  const report = {
    schemaVersion: 1,
    artifactSha256,
    pipelineSources,
    status: "prepared",
    runtimeVersion: INPUTS.runtimeVersion,
    esbuildVersion: INPUTS.esbuildVersion,
    upstreamCommit: INPUTS.upstreamCommit,
    upstreamFiles,
    publishedPackages: packages,
    lockSha256: digest(lockBytes),
    builderSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
    executedBuildScriptSha256: digest(readFileSync(buildScript)),
    ...evidence,
    outputs,
    checks: { runtimePatches: "passed", runtimeContract: "passed", sri },
    runtimeRelativePath: "packages/coding-agent",
    activationStatus: "not_installed",
    limitations: [
      "Rebuilt from checksum-verified published JavaScript, not TypeScript source.",
      "External/native dependencies still require the same locked installation.",
      "Build receipt does not identify already-running processes.",
    ],
  };
  writeFileSync(
    path.join(output, "build-receipt.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  writeFileSync(
    path.join(output, "checks.log"),
    [buildLog, patchLog, runtimeCheck].join("\n"),
  );
  return {
    output,
    runtime,
    status: report.status,
    securityDependencies: evidence.securityDependencies,
    sri: sri.passed,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--output"))
    throw new Error(
      "Usage: node scripts/rebuild-runtime-bundle.mjs [--output <fresh .agent directory>]",
    );
  const output =
    args[1] ?? path.join(ROOT, ".agent", "runtime-builds", randomUUID());
  console.log(JSON.stringify(await rebuildRuntimeBundle(output), null, 2));
}
