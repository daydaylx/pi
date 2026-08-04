/**
 * Dependency-free per-entry-point coverage gate.
 *
 * Node writes V8 function ranges for the TypeScript source files loaded by
 * jiti. The committed baseline deliberately prevents regressions without
 * pretending that a one-off global percentage is meaningful for every
 * extension.
 */
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(__dirname, "coverage-baseline.json");
const writeBaseline = process.argv.includes("--write-baseline");

function activeExtensionPaths() {
  const settings = JSON.parse(
    readFileSync(path.join(ROOT, "settings.json"), "utf8"),
  );
  return settings.extensions
    .filter(
      (entry) => typeof entry === "string" && entry.startsWith("+extensions/"),
    )
    .map((entry) => entry.slice(1));
}

function coverageFiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(directory, name));
}

function functionCoverage(coverage, relativePath) {
  const sourceUrl = pathToFileURL(path.join(ROOT, relativePath)).href;
  const sources = coverage
    .flatMap((entry) => entry.result ?? [])
    .filter((entry) => entry.url === sourceUrl);
  if (sources.length === 0) return { covered: 0, total: 0, percent: 0 };
  const functions = new Map();
  for (const source of sources) {
    for (const fn of source.functions.filter(
      (candidate) => candidate.functionName,
    )) {
      const range = fn.ranges[0];
      const key = `${fn.functionName}:${range.startOffset}:${range.endOffset}`;
      functions.set(key, Math.max(functions.get(key) ?? 0, range.count ?? 0));
    }
  }
  const covered = [...functions.values()].filter((count) => count > 0).length;
  const total = functions.size;
  return {
    covered,
    total,
    percent: total === 0 ? 100 : (covered / total) * 100,
  };
}

function collectCoverage(directory, extensions) {
  const coverage = coverageFiles(directory).map((file) =>
    JSON.parse(readFileSync(file, "utf8")),
  );
  return Object.fromEntries(
    extensions.map((extension) => [
      extension,
      functionCoverage(coverage, extension),
    ]),
  );
}

function baselineFrom(results, extensions) {
  return {
    version: 1,
    metric: "v8-function",
    activeExtensions: extensions,
    minimumFunctionCoverage: Object.fromEntries(
      extensions.map((extension) => [
        extension,
        Math.floor(results[extension].percent),
      ]),
    ),
  };
}

function printReport(results) {
  for (const [extension, value] of Object.entries(results)) {
    console.log(
      `${extension}: ${value.covered}/${value.total} functions (${value.percent.toFixed(1)}%)`,
    );
  }
}

const extensions = activeExtensionPaths();
const coverageDirectory = mkdtempSync(path.join(tmpdir(), "pi-v8-coverage-"));

try {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "run-all.mjs")],
    {
      cwd: ROOT,
      env: { ...process.env, NODE_V8_COVERAGE: coverageDirectory },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  if (process.exitCode) process.exit(process.exitCode);

  const measurements = collectCoverage(coverageDirectory, extensions);
  printReport(measurements);
  if (writeBaseline) {
    writeFileSync(
      BASELINE_PATH,
      JSON.stringify(baselineFrom(measurements, extensions), null, 2) + "\n",
    );
    console.log(
      `Coverage baseline written: ${path.relative(ROOT, BASELINE_PATH)}`,
    );
    process.exit(0);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const expected = JSON.stringify(baseline.activeExtensions);
  const actual = JSON.stringify(extensions);
  if (
    baseline.version !== 1 ||
    baseline.metric !== "v8-function" ||
    expected !== actual
  ) {
    throw new Error(
      "Coverage baseline does not match the active extension list. Run npm run test:coverage:baseline after reviewing the changed coverage.",
    );
  }
  for (const extension of extensions) {
    const measurement = measurements[extension];
    const minimum = baseline.minimumFunctionCoverage?.[extension];
    if (!measurement || !Number.isInteger(minimum)) {
      throw new Error(
        `Coverage baseline has no valid minimum for ${extension}.`,
      );
    }
    if (measurement.total === 0) {
      throw new Error(
        `${extension} was not activated by the regression suite.`,
      );
    }
    if (measurement.percent < minimum) {
      throw new Error(
        `${extension} regressed to ${measurement.percent.toFixed(1)}%; minimum is ${minimum}%.`,
      );
    }
  }
} finally {
  rmSync(coverageDirectory, { recursive: true, force: true });
}
