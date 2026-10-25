import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, eq, test, counters as summary } from "./shared/assertions.mjs";
import { withHarness } from "./shared/harness.mjs";
import { importModule as load } from "./shared/jiti-loader.mjs";

const tracker = await load("extensions/task-tier/read-tracker.ts");
const tier = await load("extensions/task-tier/index.ts");
const hardPaths = await load(
  "extensions/permissions/verifier-required-paths.ts",
);

await test("verifier hard paths include gate dependencies", () => {
  for (const path of [
    "extensions/permissions/verifier-risk.ts",
    "extensions/permissions/temporary-agent-policy.ts",
    "extensions/setup-core/verifier-ticket.ts",
    "shared/workspace-snapshot.mjs",
    "shared/workspace-snapshot.d.mts",
  ]) {
    assert(
      hardPaths.matchingVerifierRequiredPaths([path]).length > 0,
      `${path} requires verification`,
    );
  }
  eq(
    hardPaths.matchingVerifierRequiredPaths(["extensions/aurora-ui/tile.ts"])
      .length,
    0,
    "unrelated UI module remains optional",
  );
});

await test("task-tier: Read-Tracker", async () => {
  const t = tracker.createReadTracker();
  const stamp = { mtimeMs: 1, size: 10 };
  t.record("/a", {}, stamp, false);
  assert(t.isRedundant("/a", {}, stamp), "identisch");
  assert(t.isRedundant("/a", { offset: 5, limit: 10 }, stamp), "Teilbereich");
  assert(!t.isRedundant("/a", {}, { mtimeMs: 2, size: 10 }), "geändert");
  t.invalidate("/a");
  assert(!t.isRedundant("/a", {}, stamp), "nach Invalidierung");
  t.record("/b", {}, stamp, true);
  assert(!t.isRedundant("/b", {}, stamp), "gekürzt zählt nicht");
  t.record("/c", { offset: 1, limit: 50 }, stamp, false);
  assert(!t.isRedundant("/c", { offset: 40, limit: 50 }, stamp), "ragt hinaus");
  assert(!t.isRedundant("/c", {}, stamp), "voller Read nicht abgedeckt");
  t.reset();
  assert(!t.isRedundant("/c", { offset: 1, limit: 10 }, stamp), "reset");
});

const tc = (toolName, input) => ({
  type: "tool_call",
  toolCallId: "t",
  toolName,
  input,
});
const tr = (toolName, input, extra = {}) => ({
  type: "tool_result",
  toolCallId: "t",
  toolName,
  input,
  content: [],
  isError: false,
  ...extra,
});
const turnEntry = (harness) =>
  harness.appended.find((e) => e.customType === "task-tier.turn");

for (const profile of ["project", "system"]) {
  await test(`task-tier: ${profile} erlaubt wiederholte Reads und beobachtet sie nur`, async () => {
    const previous = process.env.PI_LAUNCH_PROFILE;
    process.env.PI_LAUNCH_PROFILE = profile;
    try {
      await withHarness(
        { extensions: [tier], files: { "a.txt": "x\n" } },
        async ({ harness, context, cwd }) => {
          await harness.runHooks("agent_start", {}, context);
          const read = { path: "a.txt" };
          const performRead = async (input = read, extra = {}) => {
            const results = await harness.runHooks(
              "tool_call",
              tc("read", input),
              context,
            );
            assert(
              !results.some((result) => result?.block),
              "Read bleibt frei",
            );
            await harness.runHooks(
              "tool_result",
              tr("read", input, extra),
              context,
            );
          };
          await performRead();
          await performRead();
          await performRead({ path: "a.txt", offset: 1, limit: 1 });
          await harness.runHooks("tool_result", tr("edit", read), context);
          await performRead();
          writeFileSync(join(cwd, "a.txt"), "yy\n");
          await performRead();
          await harness.runHooks("session_compact", {}, context);
          await performRead(read, { isError: true });
          await performRead(read, {
            details: { truncation: { truncated: true } },
          });
          await performRead();
          await harness.runHooks("agent_end", { messages: [] }, context);
          const entry = turnEntry(harness).data;
          eq(
            entry.dupReadsObserved,
            2,
            "nur erfolgreich zuvor gelesene Bereiche zählen",
          );
          assert(!("dupReadsBlocked" in entry), "kein Blockzähler");
          eq(entry.reads, 8, "alle Read-Ergebnisse bleiben in der Telemetrie");
          await harness.runHooks("session_start", {}, context);
          await harness.runHooks("agent_start", {}, context);
          await performRead();
          await harness.runHooks("agent_end", { messages: [] }, context);
          eq(
            harness.appended
              .filter((e) => e.customType === "task-tier.turn")
              .at(-1).data.dupReadsObserved,
            0,
            "neue Sitzung setzt Beobachtung zurück",
          );
        },
      );
    } finally {
      if (previous === undefined) delete process.env.PI_LAUNCH_PROFILE;
      else process.env.PI_LAUNCH_PROFILE = previous;
    }
  });
}

await test("task-tier: ändert weder Prompt, Thinking noch Subagenten", async () => {
  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    const thinking = harness.api.getThinkingLevel();
    const start = await harness.runHooks(
      "before_agent_start",
      { prompt: "Setze editorPaddingX in settings.json", systemPrompt: "SYS" },
      context,
    );
    eq(start[0], undefined, "kein Prompt-Zusatz, auch für kurze Aufträge");
    await harness.runHooks("agent_start", {}, context);
    for (const input of [
      { spec: { profile: "verify" } },
      { agent: "verifier", task: "x" },
    ]) {
      const [sub] = await harness.runHooks(
        "tool_call",
        tc("subagent", input),
        context,
      );
      eq(sub, undefined, "Subagent und Verifier werden nicht blockiert");
    }
    eq(harness.api.getThinkingLevel(), thinking, "Thinking unverändert");
    await harness.runHooks("agent_end", { messages: [] }, context);
    eq(harness.api.getThinkingLevel(), thinking, "Thinking bleibt am Ende");
    const entry = turnEntry(harness).data;
    eq(entry.subagentCalls, 2, "Subagent-Starts gezählt");
    eq(entry.verifierCalls, 2, "Verifier-Starts gezählt");
  });
});

await test("task-tier: Telemetrie zählt Aufrufe, Requests, Tokens und Cache-Verluste", async () => {
  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    await harness.runHooks("agent_start", {}, context);
    await harness.runHooks("tool_result", tr("grep", { path: "." }), context);
    await harness.runHooks(
      "tool_result",
      tr("edit", { path: "src/index.js" }),
      context,
    );
    await harness.runHooks(
      "tool_result",
      tr("bash", { command: "npm test" }),
      context,
    );
    const usage = (input, cacheRead, output) => ({
      input,
      cacheRead,
      output,
      cacheWrite: 0,
    });
    const end = (message) =>
      harness.runHooks(
        "message_end",
        { type: "message_end", message },
        context,
      );
    await end({ role: "user" });
    await end({ role: "assistant", usage: usage(1000, 12000, 50) });
    await end({ role: "toolResult" });
    await end({ role: "assistant", usage: usage(300, 12000, 40) });
    await end({ role: "assistant", usage: usage(13000, 0, 60) });
    await harness.runHooks("agent_end", { messages: [] }, context);
    const entry = turnEntry(harness).data;
    eq(entry.schemaVersion, 3, "Schema");
    eq(entry.searches, 1, "Suchen");
    eq(entry.edits, 1, "Edits");
    eq(entry.editedFiles, 1, "geänderte Dateien");
    eq(entry.commands, 1, "Kommandos");
    eq(entry.requests, 3, "Requests");
    eq(entry.inputTokens, 14300, "frischer Input");
    eq(entry.cacheReadTokens, 24000, "Cache-Lesung");
    eq(entry.outputTokens, 150, "Output");
    eq(entry.cacheMisses, 1, "ein Cache-Verlust");
    assert(entry.slowestRequestMs >= 0, "langsamster Request erfasst");
    assert(!("tier" in entry), "keine Klassenfelder mehr");
  });
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
