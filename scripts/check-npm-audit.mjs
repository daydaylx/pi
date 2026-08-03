#!/usr/bin/env node
/**
 * CI gate: fails on any `npm audit` finding that is not already documented
 * and accepted below. New advisories fail the build immediately instead of
 * silently accumulating; already-known, currently unfixable ones do not
 * block every future PR.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Verified 2026-08-03: both advisory groups originate inside
// @earendil-works/pi-coding-agent and cannot be resolved from this project's
// package.json today:
//  - brace-expansion is pinned by an npm-shrinkwrap.json bundled with that
//    package, which seals its own subtree — root-level `overrides` cannot
//    reach into it (confirmed with a minimal reproduction).
//  - undici's fix requires downgrading @earendil-works/pi-coding-agent to
//    0.75.3, a breaking change to the runtime this project runs on.
// Revisit when upstream publishes a fix; do not silently widen this list.
export const ACCEPTED_ADVISORIES = new Set([
  "https://github.com/advisories/GHSA-mh99-v99m-4gvg",
  "https://github.com/advisories/GHSA-rgw5-rvv9-x895",
  "https://github.com/advisories/GHSA-8xcm-r25x-g524",
  "https://github.com/advisories/GHSA-4cwx-7wf7-3272",
  "https://github.com/advisories/GHSA-m8rv-5g2x-5cg5",
  "https://github.com/advisories/GHSA-jr45-8vmc-qm54",
  "https://github.com/advisories/GHSA-v3r7-h72x-cjcm",
]);

/** Pure so it can be unit tested without shelling out to npm. */
export function findUnexpectedAdvisories(report, acceptedAdvisories) {
  const unexpected = [];
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== "object" || !via.url) continue;
      if (!acceptedAdvisories.has(via.url)) {
        unexpected.push(`${vuln.name}: ${via.title} (${via.url})`);
      }
    }
  }
  return unexpected;
}

function runNpmAudit(cwd) {
  try {
    const output = execFileSync(
      "npm",
      ["audit", "--omit=dev", "--audit-level=high", "--json"],
      { cwd, encoding: "utf8" },
    );
    return JSON.parse(output);
  } catch (error) {
    // npm audit exits non-zero when it finds anything at/above --audit-level;
    // the JSON report is still on stdout and is what we need to inspect.
    if (error.stdout) return JSON.parse(error.stdout.toString());
    throw error;
  }
}

async function main() {
  const npmDir = path.resolve(__dirname, "..", "npm");
  const report = runNpmAudit(npmDir);
  const unexpected = findUnexpectedAdvisories(report, ACCEPTED_ADVISORIES);
  if (unexpected.length > 0) {
    console.error("npm audit found findings outside the accepted allowlist:");
    for (const line of unexpected) console.error(`  - ${line}`);
    console.error(
      "\nIf this is a genuinely new, accepted risk, document it and add its advisory URL to scripts/check-npm-audit.mjs. Otherwise fix the dependency.",
    );
    process.exit(1);
  }
  console.log(
    "npm audit: no findings outside the documented, accepted allowlist.",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
