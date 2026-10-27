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
//
// Verified 2026-09-29: the ten undici advisories added last (GHSA-2gqq… to
// GHSA-2jfj…) come from the undici 8.9.0 sealed inside
// pi-coding-agent@0.84.3's npm-shrinkwrap.json.
// The root override `undici: 8.11.2` fixes every other copy (pi-web-access)
// but cannot reach that subtree. The only real fix is upgrading
// pi-coding-agent to a release that ships undici >= 8.10.2 (npm audit
// suggests 0.99.1, a breaking runtime change; handle as its own task).
export const ACCEPTED_ADVISORIES = new Set([
  "https://github.com/advisories/GHSA-mh99-v99m-4gvg",
  "https://github.com/advisories/GHSA-rgw5-rvv9-x895",
  "https://github.com/advisories/GHSA-8xcm-r25x-g524",
  "https://github.com/advisories/GHSA-4cwx-7wf7-3272",
  "https://github.com/advisories/GHSA-m8rv-5g2x-5cg5",
  "https://github.com/advisories/GHSA-jr45-8vmc-qm54",
  "https://github.com/advisories/GHSA-v3r7-h72x-cjcm",
  "https://github.com/advisories/GHSA-2gqq-gqf2-x968",
  "https://github.com/advisories/GHSA-w293-vg96-wgc3",
  "https://github.com/advisories/GHSA-8436-99hf-9mmv",
  "https://github.com/advisories/GHSA-rx4f-c7p8-82vq",
  "https://github.com/advisories/GHSA-3wwx-pv8p-q78v",
  "https://github.com/advisories/GHSA-pmjh-fq2x-6v4x",
  "https://github.com/advisories/GHSA-r53p-7pc4-xj5r",
  "https://github.com/advisories/GHSA-rfgv-xxqx-mfg5",
  "https://github.com/advisories/GHSA-3xpg-4rpp-hhhm",
  "https://github.com/advisories/GHSA-2jfj-6hjv-fm6j",
  // The 2026-10 undici and zod findings are intentionally not allowlisted:
  // the current lockfile uses patched versions; regressions must fail the gate.
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

export function parseNpmAuditReport(text) {
  let report;
  try {
    report = JSON.parse(String(text));
  } catch {
    throw new Error(
      "npm audit returned unreadable JSON; no security verdict available.",
    );
  }
  if (report?.error) {
    const code = report.error.code;
    const label =
      typeof code === "string" && /^[A-Z0-9_-]{1,32}$/.test(code)
        ? ` (${code})`
        : "";
    throw new Error(
      `npm audit registry error${label}; no security verdict available.`,
    );
  }
  const vulnerabilities = report?.vulnerabilities;
  const total = report?.metadata?.vulnerabilities?.total;
  if (
    report?.error ||
    report?.auditReportVersion !== 2 ||
    !vulnerabilities ||
    typeof vulnerabilities !== "object" ||
    Array.isArray(vulnerabilities) ||
    !Number.isInteger(total) ||
    total < 0 ||
    Object.keys(vulnerabilities).length !== total ||
    Object.values(vulnerabilities).some(
      (entry) =>
        !entry ||
        !Array.isArray(entry.via) ||
        entry.via.length === 0 ||
        entry.via.some((via) =>
          typeof via === "string"
            ? !Object.hasOwn(vulnerabilities, via)
            : !via || typeof via.url !== "string" || via.url.length === 0,
        ),
    )
  ) {
    throw new Error(
      "npm audit did not return a complete report; no security verdict available.",
    );
  }
  // Every affected package must trace to an actual advisory source. Pure
  // reference cycles otherwise look like accepted findings to the allowlist.
  const sourced = new Set(
    Object.entries(vulnerabilities)
      .filter(([, entry]) => entry.via.some((via) => typeof via === "object"))
      .map(([name]) => name),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, entry] of Object.entries(vulnerabilities)) {
      if (
        !sourced.has(name) &&
        entry.via.some((via) => typeof via === "string" && sourced.has(via))
      ) {
        sourced.add(name);
        changed = true;
      }
    }
  }
  if (sourced.size !== total)
    throw new Error(
      "npm audit contains findings without advisory sources; no security verdict available.",
    );
  return report;
}

export function runNpmAudit(cwd, execute = execFileSync) {
  let output;
  try {
    output = execute(
      "npm",
      ["audit", "--omit=dev", "--audit-level=high", "--json"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    // Only npm's normal finding exit may carry an authoritative report.
    // Timeouts, signals, buffer failures and unknown exits are infrastructure errors.
    if (
      error.status !== 1 ||
      error.signal ||
      error.killed ||
      (error.code !== undefined && error.code !== 1) ||
      !error.stdout
    ) {
      throw new Error(
        "npm audit did not complete normally; no security verdict available.",
        { cause: error },
      );
    }
    const report = parseNpmAuditReport(error.stdout.toString());
    if (report.metadata.vulnerabilities.total === 0)
      throw new Error(
        "npm audit failed without findings; no security verdict available.",
        { cause: error },
      );
    return report;
  }
  return parseNpmAuditReport(output);
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
  try {
    await main();
  } catch (error) {
    // Do not dump captured registry responses or process arguments via Error.cause.
    console.error(
      error instanceof Error
        ? error.message
        : "npm audit failed; no security verdict available.",
    );
    process.exitCode = 1;
  }
}
