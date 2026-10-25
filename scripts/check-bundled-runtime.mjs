/** Exercise the embedded Undici on a disposable copy and a loopback server. */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertNoSymlinkComponents } from "./apply-runtime-patches.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHILD = `
import { createHash } from 'node:crypto';
import http from 'node:http';
const { fetch, getGlobalDispatcher } = (await import(process.argv[2])).__securityUndici();
const server = http.createServer((_req, res) => res.end('fixture-response'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/sri';
const digest = text => createHash('sha256').update(text).digest('base64');
const probes = [];
try {
  for (const [name, algorithm, expected, shouldAccept] of [
    ['lowercase-mismatch', 'sha256', 'different-response', false],
    ['uppercase-mismatch', 'SHA256', 'different-response', false],
    ['uppercase-match', 'SHA256', 'fixture-response', true],
  ]) {
    let accepted = false;
    try {
      const response = await fetch(url, { integrity: algorithm + '-' + digest(expected) });
      await response.text();
      accepted = true;
    } catch {}
    probes.push({ name, accepted, shouldAccept, passed: accepted === shouldAccept });
  }
} finally {
  await getGlobalDispatcher().close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ probes, passed: probes.every(probe => probe.passed) }));
`;

export function bundledUndiciBinding(source) {
  const matches = [
    ...source.matchAll(
      /(?:var|,)\s*(require_undici\w*)=__commonJS\(\{"(?:[^"\n]*\/)?undici\/index\.js"/g,
    ),
  ];
  if (matches.length > 1) throw new Error("Ambiguous embedded Undici module");
  return matches[0]?.[1];
}

function assertRegularTree(directory) {
  for (const name of readdirSync(directory)) {
    const absolute = path.join(directory, name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink())
      throw new Error(`Symlink in bundle: ${absolute}`);
    if (stat.isDirectory()) assertRegularTree(absolute);
    else if (!stat.isFile())
      throw new Error(`Non-regular bundle file: ${absolute}`);
  }
}

export function probeBundledRuntime(runtime) {
  const manifest = JSON.parse(
    readFileSync(path.join(runtime, "package.json"), "utf8"),
  );
  if (manifest.name !== "@earendil-works/pi-coding-agent")
    throw new Error("Not a Pi runtime");
  const bundle = path.join(runtime, "dist/bundle");
  assertNoSymlinkComponents(bundle);
  assertRegularTree(bundle);
  const candidates = [];
  for (const name of readdirSync(path.join(bundle, "chunks"))) {
    if (!name.endsWith(".js")) continue;
    const source = readFileSync(path.join(bundle, "chunks", name), "utf8");
    const binding = bundledUndiciBinding(source);
    if (binding) candidates.push({ name, source, binding });
  }
  if (candidates.length !== 1)
    throw new Error(`Expected one embedded Undici, found ${candidates.length}`);
  const selected = candidates[0];
  const scratch = path.join(ROOT, ".agent", "runtime-security-probes");
  assertNoSymlinkComponents(scratch);
  mkdirSync(scratch, { recursive: true });
  const temporary = mkdtempSync(path.join(scratch, "probe-"));
  try {
    cpSync(bundle, path.join(temporary, "dist/bundle"), { recursive: true });
    writeFileSync(
      path.join(temporary, "package.json"),
      JSON.stringify(manifest),
    );
    symlinkSync(
      path.join(ROOT, "npm/node_modules"),
      path.join(temporary, "node_modules"),
      "dir",
    );
    const diagnosticChunk = path.join(
      temporary,
      "dist/bundle/chunks",
      selected.name,
    );
    // Only the disposable copy gains an accessor; the module body is unchanged.
    writeFileSync(
      diagnosticChunk,
      selected.source +
        `\nexport { ${selected.binding} as __securityUndici };\n`,
    );
    const child = path.join(temporary, "probe.mjs");
    writeFileSync(child, CHILD);
    const result = spawnSync(
      process.execPath,
      [child, pathToFileURL(diagnosticChunk).href],
      {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 64_000,
      },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        `Bundle probe did not complete: ${result.error?.message ?? result.stderr}`,
      );
    return {
      runtimeVersion: manifest.version,
      originalChunkSha256: createHash("sha256")
        .update(selected.source)
        .digest("hex"),
      ...JSON.parse(result.stdout),
      scope:
        "Embedded Undici SRI case handling; no claim about all possible vulnerabilities",
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--runtime" || !existsSync(args[1]))
    throw new Error(
      "Usage: node scripts/check-bundled-runtime.mjs --runtime <package-root>",
    );
  const report = probeBundledRuntime(path.resolve(args[1]));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
