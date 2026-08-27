import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, counters, eq, test } from "../../shared/assertions.mjs";
import { importModule as load, ROOT } from "../../shared/jiti-loader.mjs";

const { findModelInCatalog, suggestSimilarModelIds } = await load(
  "extensions/openrouter-doctor/checks/catalog.ts",
);

function fixture(name) {
  const raw = readFileSync(
    path.join(ROOT, "tests", "fixtures", "openrouter-doctor", "mock-responses", `${name}.json`),
    "utf8",
  );
  return JSON.parse(raw).data;
}

await test("findModelInCatalog finds an exact id match", () => {
  const entries = fixture("healthy-model");
  const found = findModelInCatalog(entries, "openai/gpt-oss-120b");
  assert(found !== undefined, "model is found");
  eq(found.id, "openai/gpt-oss-120b", "found the right entry");
});

await test("findModelInCatalog returns undefined for an id that is not in the catalog", () => {
  const entries = fixture("broken-model");
  eq(findModelInCatalog(entries, "stealth/ox-alpha-old"), undefined, "no match for a removed model");
});

await test("findModelInCatalog does not fuzzy-match — only exact ids count as 'found'", () => {
  const entries = fixture("healthy-model");
  eq(findModelInCatalog(entries, "openai/gpt-oss-120"), undefined, "near-miss id is not treated as a match");
});

await test("suggestSimilarModelIds proposes the real id for a close typo", () => {
  const entries = fixture("broken-model");
  const suggestions = suggestSimilarModelIds(entries, "openai/gpt-oss-120");
  assert(suggestions.includes("openai/gpt-oss-120b"), "suggests the close catalog id");
});

await test("suggestSimilarModelIds returns nothing for a wildly different id", () => {
  const entries = fixture("broken-model");
  const suggestions = suggestSimilarModelIds(entries, "completely/unrelated-name-xyz");
  eq(suggestions.length, 0, "no plausible candidates surfaced for an unrelated id");
});

await test("suggestSimilarModelIds respects the requested limit", () => {
  const entries = [
    { id: "vendor/model-a" },
    { id: "vendor/model-b" },
    { id: "vendor/model-c" },
    { id: "vendor/model-d" },
  ];
  const suggestions = suggestSimilarModelIds(entries, "vendor/model-x", 2);
  eq(suggestions.length, 2, "limit is respected");
});

const { passed, failed } = counters();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`PASS: ${passed} passed, 0 failed`);
