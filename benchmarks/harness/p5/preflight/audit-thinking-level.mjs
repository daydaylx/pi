#!/usr/bin/env node
// Preflight 1a: confirms that Pi's "high" thinking level, requested for
// openai-codex/gpt-5.6-luna, is actually sent to the API unchanged — not
// silently collapsed by an incomplete thinkingLevelMap. Verified twice
// against the installed Pi runtime's own source (static analysis, not a
// live HTTP capture):
//
// 1. models-store.json's openai-codex/gpt-5.6-luna entry:
//      "thinkingLevelMap": { "xhigh": "xhigh", "max": "max", "minimal": "low" }
//    — "high" has no entry.
// 2. dist/bundle/chunks/chunk-MNAIPA3J.js:
//      getSupportedThinkingLevels(model) treats every level except
//      xhigh/max as supported regardless of whether thinkingLevelMap has an
//      entry for it (only xhigh/max require an explicit, non-undefined
//      mapping; a level mapped to `null` is excluded outright). "high" is
//      therefore always in availableLevels for a reasoning model whose map
//      doesn't set high:null, so clampThinkingLevel(model, "high") returns
//      "high" unchanged instead of falling back to a lower level.
// 3. dist/bundle/chunks/openai-codex-responses-GJVBJXLB.js, buildRequestBody:
//      effort = options.reasoningEffort === "none"
//        ? model.thinkingLevelMap?.off ?? "none"
//        : model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort
//      For "high" (absent from the map, and not "none"), this evaluates to
//      the literal string "high" via the ?? fallback, sent verbatim as
//      body.reasoning.effort to https://chatgpt.com/backend-api.
//
// Codex CLI's own reasoning_effort is read directly from turn_context in
// its rollout JSONL — no equivalent mapping-collapse risk to check there.
import { readFileSync, readdirSync, realpathSync } from "node:fs";

const PI_DIST_ROOT = realpathSync(
  new URL(
    "../../../../../../.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks",
    import.meta.url,
  ).pathname,
);

function findChunk(pattern) {
  const listing = readdirSync(PI_DIST_ROOT);
  const match = listing.find((name) => name.includes(pattern));
  if (!match)
    throw new Error(
      `No bundle chunk matching '${pattern}' found under ${PI_DIST_ROOT}.`,
    );
  return `${PI_DIST_ROOT}/${match}`;
}

function main() {
  const responsesChunkPath = findChunk("openai-codex-responses-");
  const responsesChunk = readFileSync(responsesChunkPath, "utf8");
  const hasExpectedFallback = responsesChunk.includes(
    "model.thinkingLevelMap?.[options.reasoningEffort]??options.reasoningEffort",
  );

  const modelStore = JSON.parse(
    readFileSync(
      new URL("../../../../models-store.json", import.meta.url),
      "utf8",
    ),
  );
  const lunaEntry = modelStore["openai-codex"]?.models?.find(
    (m) => m.id === "gpt-5.6-luna",
  );
  const highInMap = lunaEntry
    ? "high" in (lunaEntry.thinkingLevelMap ?? {})
    : null;

  const report = {
    checkedAt: new Date().toISOString(),
    piBundleChunk: responsesChunkPath,
    fallbackSourceLineConfirmed: hasExpectedFallback,
    lunaThinkingLevelMap: lunaEntry?.thinkingLevelMap ?? null,
    highLevelExplicitlyMapped: highInMap,
    conclusion:
      hasExpectedFallback && highInMap === false
        ? "CONFIRMED: 'high' is not in openai-codex/gpt-5.6-luna's thinkingLevelMap, so the ??-fallback sends the literal string 'high' unchanged to the API. No clamping to a lower level occurs (verified separately against clampThinkingLevel/getSupportedThinkingLevels in chunk-MNAIPA3J.js: only xhigh/max require an explicit map entry)."
        : "UNEXPECTED: re-check manually before trusting 'high' to be sent unchanged.",
    caveat:
      "Static source analysis only, not a live HTTP capture of the actual request body. Cross-checked against two independent code paths (clampThinkingLevel + buildRequestBody) in the installed runtime.",
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!hasExpectedFallback || highInMap !== false) process.exitCode = 1;
}

main();
