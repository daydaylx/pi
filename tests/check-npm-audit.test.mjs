import { assert, test, counters as summary } from "./shared/assertions.mjs";
import {
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

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
