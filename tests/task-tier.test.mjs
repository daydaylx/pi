import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, eq, test } from "./shared/assertions.mjs";
import { withHarness } from "./shared/harness.mjs";
import { importModule as load } from "./shared/jiti-loader.mjs";

const classify = await load("extensions/task-tier/classify.ts");
const tracker = await load("extensions/task-tier/read-tracker.ts");
const tier = await load("extensions/task-tier/index.ts");
const capabilities = await load("extensions/shared/workflow-capabilities.ts");

const opts = { planning: false };

await test("task-tier: Klassifikation (Tests A–F)", async () => {
  // A trivialer Config-Fix, C lokale UI-Änderung, B kleiner Bug
  eq(
    classify.classifyPrompt(
      "Setze in settings.json editorPaddingX auf 2",
      opts,
    ),
    "fast",
    "A config",
  );
  eq(
    classify.classifyPrompt(
      "Zeige im Footer den aktuellen Arbeitsordner an",
      opts,
    ),
    "fast",
    "C ui",
  );
  eq(
    classify.classifyPrompt(
      "Fix: parseArgs in extensions/foo/args.ts liefert bei leerem String undefined",
      opts,
    ),
    "fast",
    "B bug",
  );
  // E Security/Permission nie FAST
  eq(
    classify.classifyPrompt("Ändere die Permission-Prüfung für bash", opts),
    "deep",
    "E permission",
  );
  eq(
    classify.classifyPrompt("Sicherheitslücke im Login beheben", opts),
    "deep",
    "E security",
  );
  eq(
    classify.classifyPrompt("Passe extensions/permissions/guards.ts an", opts),
    "deep",
    "E hard path",
  );
  // F Plan Mode / Architektur / breit
  eq(
    classify.classifyPrompt("Kleine Sache", { planning: true }),
    "deep",
    "F plan mode",
  );
  eq(
    classify.classifyPrompt("Refactore das Subsystem komplett", opts),
    "deep",
    "F refactor",
  );
  eq(
    classify.classifyPrompt("Benenne die Funktion in allen Dateien um", opts),
    "normal",
    "broad",
  );
  eq(
    classify.classifyPrompt("a.ts b.ts c.ts d.ts ändern", opts),
    "normal",
    "viele Pfade",
  );
  eq(classify.classifyPrompt("", opts), "normal", "leer");
});

await test("task-tier: Thinking-Ziele", async () => {
  eq(classify.thinkingForTier("fast", "kurz"), "low", "fast kurz");
  eq(classify.thinkingForTier("fast", "x".repeat(200)), "medium", "fast lang");
  eq(classify.thinkingForTier("normal", "x"), undefined, "normal unverändert");
  eq(classify.thinkingForTier("deep", "x"), "high", "deep");
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

await test("task-tier: FAST blockt Subagenten, Duplicate-Reads, eskaliert", async () => {
  await withHarness(
    { extensions: [tier], files: { "a.txt": "x\n" } },
    async ({ harness, context, cwd }) => {
      const [start] = await harness.runHooks(
        "before_agent_start",
        {
          prompt: "Setze editorPaddingX in settings.json",
          systemPrompt: "SYS",
        },
        context,
      );
      assert(start.systemPrompt.includes("FAST"), "FAST-Prompt angehängt");
      eq(harness.api.getThinkingLevel(), "low", "Thinking gesenkt");

      const [sub] = await harness.runHooks(
        "tool_call",
        tc("subagent", { spec: { profile: "verify" } }),
        context,
      );
      assert(sub?.block === true, "Subagent geblockt");

      const read = { path: "a.txt" };
      eq(
        (await harness.runHooks("tool_call", tc("read", read), context))[0],
        undefined,
        "erster Read frei",
      );
      await harness.runHooks("tool_result", tr("read", read), context);
      const [dup] = await harness.runHooks(
        "tool_call",
        tc("read", read),
        context,
      );
      assert(dup?.block === true, "Duplicate-Read geblockt");
      await harness.runHooks("tool_result", tr("edit", read), context);
      eq(
        (await harness.runHooks("tool_call", tc("read", read), context))[0],
        undefined,
        "nach Edit wieder frei",
      );
      writeFileSync(join(cwd, "a.txt"), "y\n");

      // Eskalation: zu viele Searches vor dem ersten Edit (Edit-Flag zurücksetzen über neuen Turn)
      await harness.runHooks("agent_end", { messages: [] }, context);
      eq(harness.api.getThinkingLevel(), "high", "Thinking wiederhergestellt");
      const entry = harness.appended.find(
        (e) => e.customType === "task-tier.turn",
      );
      eq(entry.data.tier, "fast", "Telemetrie Klasse");
      eq(entry.data.dupReadsBlocked, 1, "Telemetrie Duplicate-Reads");
    },
  );

  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    await harness.runHooks(
      "before_agent_start",
      { prompt: "Zeige im Footer den Ordner an", systemPrompt: "SYS" },
      context,
    );
    for (let i = 0; i < 3; i += 1)
      await harness.runHooks(
        "tool_result",
        tr("grep", { pattern: "x" }),
        context,
      );
    const [sub] = await harness.runHooks(
      "tool_call",
      tc("subagent", { spec: { profile: "analyse" } }),
      context,
    );
    eq(sub, undefined, "nach Eskalation Subagent erlaubt");
    assert(
      harness.sent.some((s) => s.message.customType === "task-tier.escalation"),
      "Steering-Hinweis",
    );
    await harness.runHooks("agent_end", { messages: [] }, context);
    const entry = harness.appended.find(
      (e) => e.customType === "task-tier.turn",
    );
    eq(entry.data.escalations.length, 1, "Eskalation protokolliert");
    eq(entry.data.tier, "normal", "Klasse NORMAL");
  });

  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    await harness.runHooks(
      "before_agent_start",
      { prompt: "Kleiner Fix in foo.ts", systemPrompt: "SYS" },
      context,
    );
    await harness.runHooks(
      "tool_result",
      tr("edit", { path: "extensions/permissions/guards.ts" }),
      context,
    );
    await harness.runHooks("agent_end", { messages: [] }, context);
    const entry = harness.appended.find(
      (e) => e.customType === "task-tier.turn",
    );
    eq(entry.data.tier, "deep", "Hard-Pfad → DEEP");
  });
});

await test("task-tier: Plan Mode → DEEP, Subagent erlaubt", async () => {
  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    harness.api.events.on(
      capabilities.WORKFLOW_CAPABILITY_EVENTS.request,
      (request) => request.respond({ mode: "detailed_plan" }),
    );
    const [start] = await harness.runHooks(
      "before_agent_start",
      { prompt: "kurz", systemPrompt: "SYS" },
      context,
    );
    assert(start.systemPrompt.includes("DEEP"), "DEEP im Planmodus");
    const [sub] = await harness.runHooks(
      "tool_call",
      tc("subagent", { spec: { profile: "analyse" } }),
      context,
    );
    eq(sub, undefined, "Subagent nicht geblockt");
  });
});

await test("task-tier: NORMAL lässt Prompt und Thinking unverändert", async () => {
  await withHarness({ extensions: [tier] }, async ({ harness, context }) => {
    const [start] = await harness.runHooks(
      "before_agent_start",
      {
        prompt: "Benenne alles komplett um in allen Modulen",
        systemPrompt: "SYS",
      },
      context,
    );
    eq(start, undefined, "kein Prompt-Zusatz");
    eq(harness.api.getThinkingLevel(), "high", "Thinking unverändert");
  });
});

await test("task-tier: Commit/Push nie FAST, Fortsetzung erbt Klasse", async () => {
  for (const prompt of [
    "commit und push",
    "Bitte pushen",
    "merge den Branch",
    "mach den PR",
  ]) {
    assert(
      classify.classifyPrompt(prompt, opts) !== "fast",
      `release nicht fast: ${prompt}`,
    );
  }
  assert(classify.isContinuationPrompt("weiter"), "weiter");
  assert(classify.isContinuationPrompt("ja, mach das"), "ja");
  assert(
    !classify.isContinuationPrompt(
      "Setze in settings.json editorPaddingX auf 2",
    ),
    "kein Fortsetzungs-Prompt",
  );
  eq(classify.maxTier("fast", "deep"), "deep", "maxTier");
  eq(classify.maxTier("normal", "fast"), "normal", "maxTier2");
});
