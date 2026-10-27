import strictAssert from "node:assert/strict";
import { assert, test, counters as summary } from "./shared/assertions.mjs";
import {
  parseNpmAuditReport,
  runNpmAudit,
  ACCEPTED_ADVISORIES,
  findUnexpectedAdvisories,
} from "../scripts/check-npm-audit.mjs";

await test("findUnexpectedAdvisories ignores documented advisories and flags new ones", () => {
  const known = [...ACCEPTED_ADVISORIES][0];
  const report = {
    vulnerabilities: {
      "brace-expansion": {
        name: "brace-expansion",
        via: [{ url: known, title: "known issue" }],
      },
      "some-new-package": {
        name: "some-new-package",
        via: [
          {
            url: "https://github.com/advisories/GHSA-new-new-new",
            title: "brand new issue",
          },
        ],
      },
      "transitive-only": {
        // `via` entries can be plain package-name strings for indirect
        // linkage rather than advisory objects; those must be ignored.
        name: "transitive-only",
        via: ["some-new-package"],
      },
    },
  };
  const unexpected = findUnexpectedAdvisories(report, ACCEPTED_ADVISORIES);
  assert(
    unexpected.length === 1,
    "exactly one unexpected advisory is reported",
  );
  assert(
    unexpected[0].includes("GHSA-new-new-new"),
    "the unexpected advisory names the new GHSA id",
  );
});

await test("findUnexpectedAdvisories reports nothing when every advisory is accepted", () => {
  const report = {
    vulnerabilities: {
      "brace-expansion": {
        name: "brace-expansion",
        via: [...ACCEPTED_ADVISORIES]
          .slice(0, 2)
          .map((url) => ({ url, title: "known" })),
      },
    },
  };
  assert(
    findUnexpectedAdvisories(report, ACCEPTED_ADVISORIES).length === 0,
    "no findings when every advisory URL is on the allowlist",
  );
});

await test("patched undici and zod advisories remain unexpected on regression", () => {
  const urls = [
    "https://github.com/advisories/GHSA-4qv8-2p9j-2685",
    "https://github.com/advisories/GHSA-f72v-6w45-q472",
    "https://github.com/advisories/GHSA-xjj6-f33q-929c",
    "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5",
  ];
  const report = {
    vulnerabilities: {
      regression: {
        name: "regression",
        via: urls.map((url) => ({ url, title: "regression" })),
      },
    },
  };
  strictAssert.equal(
    findUnexpectedAdvisories(report, ACCEPTED_ADVISORIES).length,
    urls.length,
  );
});

await test("npm registry errors cannot be reported as a clean audit", () => {
  const response = JSON.stringify({
    error: { code: "E400", summary: "Bad Request" },
  });
  strictAssert.throws(
    () =>
      runNpmAudit("unused", () => {
        throw Object.assign(new Error("npm failed"), {
          status: 1,
          stdout: Buffer.from(response),
        });
      }),
    /no security verdict/,
  );
  strictAssert.throws(
    () => runNpmAudit("unused", () => response),
    /no security verdict/,
  );
  strictAssert.throws(() => parseNpmAuditReport("not json"), /unreadable JSON/);
  assert(true, "registry errors and unreadable output fail closed");
});

await test("missing or truncated audit data never passes as zero findings", () => {
  for (const value of [
    null,
    {},
    { auditReportVersion: 2, vulnerabilities: {} },
    {
      auditReportVersion: 2,
      vulnerabilities: {},
      metadata: { vulnerabilities: { total: 1 } },
    },
    {
      auditReportVersion: 2,
      vulnerabilities: { broken: {} },
      metadata: { vulnerabilities: { total: 1 } },
    },
    {
      auditReportVersion: 2,
      vulnerabilities: { broken: { via: [] } },
      metadata: { vulnerabilities: { total: 1 } },
    },
    {
      auditReportVersion: 2,
      vulnerabilities: { broken: { via: [{}] } },
      metadata: { vulnerabilities: { total: 1 } },
    },
    {
      auditReportVersion: 2,
      vulnerabilities: { broken: { via: ["missing-package"] } },
      metadata: { vulnerabilities: { total: 1 } },
    },
  ])
    strictAssert.throws(
      () => parseNpmAuditReport(JSON.stringify(value)),
      /no security verdict/,
    );
  assert(true, "incomplete audit responses are rejected");
});

await test("valid clean and nonzero-exit advisory reports remain usable", () => {
  const clean = {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { total: 0 } },
  };
  strictAssert.deepEqual(
    runNpmAudit("unused", () => JSON.stringify(clean)),
    clean,
  );
  const finding = {
    auditReportVersion: 2,
    vulnerabilities: {
      package: {
        via: [
          {
            url: "https://github.com/advisories/GHSA-new-new-new",
            title: "new",
          },
        ],
      },
    },
    metadata: { vulnerabilities: { total: 1 } },
  };
  const report = runNpmAudit("unused", () => {
    throw Object.assign(new Error("findings"), {
      status: 1,
      stdout: JSON.stringify(finding),
    });
  });
  strictAssert.equal(
    findUnexpectedAdvisories(report, ACCEPTED_ADVISORIES).length,
    1,
  );
  const linked = structuredClone(finding);
  linked.vulnerabilities.consumer = { via: ["package"] };
  linked.metadata.vulnerabilities.total = 2;
  strictAssert.deepEqual(parseNpmAuditReport(JSON.stringify(linked)), linked);
  assert(true, "a valid finding is preserved despite npm's nonzero exit");
});

await test("abnormal process exits never turn partial stdout into a security verdict", () => {
  const clean = JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { total: 0 } },
  });
  for (const state of [
    { status: 1 },
    { status: null, signal: "SIGTERM", code: "ETIMEDOUT" },
    { status: 1, code: "ETIMEDOUT" },
    { status: 1, signal: "SIGTERM" },
    { status: 1, code: "ENOBUFS" },
    { status: 2 },
    { status: 1, killed: true },
  ])
    strictAssert.throws(
      () =>
        runNpmAudit("unused", () => {
          throw Object.assign(new Error("infrastructure failure"), state, {
            stdout: clean,
          });
        }),
      /no security verdict/,
    );
  assert(
    true,
    "signals, timeouts and unexplained clean nonzero exits fail closed",
  );
});

await test("reference cycles need a real advisory source in every component", () => {
  for (const vulnerabilities of [
    { a: { via: ["a"] } },
    { a: { via: ["b"] }, b: { via: ["a"] } },
    {
      a: { via: ["a"] },
      source: { via: [{ url: "https://example.test/advisory" }] },
    },
  ])
    strictAssert.throws(
      () =>
        parseNpmAuditReport(
          JSON.stringify({
            auditReportVersion: 2,
            vulnerabilities,
            metadata: {
              vulnerabilities: { total: Object.keys(vulnerabilities).length },
            },
          }),
        ),
      /without advisory sources/,
    );
  const anchored = {
    auditReportVersion: 2,
    vulnerabilities: {
      a: { via: ["b"] },
      b: { via: ["a", { url: "https://example.test/advisory" }] },
    },
    metadata: { vulnerabilities: { total: 2 } },
  };
  strictAssert.deepEqual(
    parseNpmAuditReport(JSON.stringify(anchored)),
    anchored,
  );
  assert(true, "sourced cycles remain valid but unsourced components do not");
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
