#!/usr/bin/env node
// Preflight 1f: for every task referenced by the P5 manifest, checks that
// every file path mentioned in its public PROMPT.md/TASK.md still exists at
// the pinned reference commit. This is the automated form of the manual
// check that found 01-single-file-change broken at dd00b33 (extensions/git-
// header.ts was removed) — run it again whenever the reference commit
// changes, not just once by hand.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadP5Manifest } from "../../p5-manifest.mjs";

const ROOT = new URL("../../../..", import.meta.url).pathname;
const PATH_PATTERN =
  /`((?:extensions|benchmarks|tests|shared|schemas|docs)\/[a-zA-Z0-9._/-]+\.[a-zA-Z0-9]+)`/g;

function extractPaths(text) {
  const found = new Set();
  for (const match of text.matchAll(PATH_PATTERN)) found.add(match[1]);
  return [...found];
}

function existsAtReference(reference, path) {
  const result = execFileSync(
    "git",
    ["cat-file", "-e", `${reference}:${path}`],
    { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] },
  );
  return result !== null; // execFileSync throws on non-zero exit
}

function checkExists(reference, path) {
  try {
    existsAtReference(reference, path);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const manifest = loadP5Manifest();
  const reference = manifest.reference;
  const taskIds = [...new Set(manifest.runs.map((run) => run.task))];
  const report = [];
  let anyInvalid = false;

  for (const taskId of taskIds) {
    const promptPath = join(
      ROOT,
      "benchmarks",
      "v2",
      "tasks",
      taskId,
      "PROMPT.md",
    );
    const taskMdPath = join(ROOT, "benchmarks", "tasks", taskId, "TASK.md");
    const texts = [promptPath, taskMdPath]
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, "utf8"));
    const referencedPaths = [...new Set(texts.flatMap(extractPaths))];
    // Fixture-isolated tasks (benchmarks/tasks/<id>/fixture/) reference
    // benchmark-fixture/... paths that are runtime-relative, not real repo
    // paths — filter those out, they never resolve against `git cat-file`.
    const realPaths = referencedPaths.filter(
      (p) => !p.startsWith("benchmark-fixture/"),
    );
    const missing = realPaths.filter((p) => !checkExists(reference, p));
    if (missing.length > 0) anyInvalid = true;
    report.push({
      taskId,
      referencedPaths: realPaths,
      missing,
      valid: missing.length === 0,
    });
  }

  process.stdout.write(`${JSON.stringify({ reference, report }, null, 2)}\n`);
  if (anyInvalid) process.exitCode = 1;
}

main();
