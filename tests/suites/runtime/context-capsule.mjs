import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";

export const contextCapsuleSections = {
  "context capsule compaction lifecycle": async (context) => {
    const { section, contextCapsule } = context;
    await section("context capsule compaction lifecycle", async () => {
      if (!contextCapsule) return;

      const harness = createHarness();
      contextCapsule.default(harness.api);
      const ctx = harness.makeContext();
      await harness.runHooks("session_start", {}, ctx);
      await harness.runHooks(
        "before_agent_start",
        {
          prompt:
            "Implement the feature; API_KEY=abcd1234; Authorization: Bearer bearer_secret_123; password=plain_secret_456; AWS_SECRET_ACCESS_KEY=aws_secret_789; sk-proj-abcdefghijklmnopqrstuvwxyz123456.",
        },
        ctx,
      );
      await harness.runHooks(
        "tool_result",
        {
          toolName: "write",
          input: { path: "src/new-file.ts", content: "large secret output" },
          isError: false,
        },
        ctx,
      );
      await harness.runHooks(
        "tool_result",
        {
          toolName: "project_check",
          input: { profile: "verify" },
          isError: false,
        },
        ctx,
      );
      await harness.runHooks("session_before_compact", { reason: "threshold" }, ctx);

      const captured = harness.appended.at(-1);
      eq(captured?.customType, "context-capsule.telemetry", "capture writes metadata only");
      eq(captured?.data.phase, "captured", "pre-compaction phase is recorded");
      assert(captured?.data.serializedBytes <= 3 * 1024, "capsule stays within target size");
      eq(JSON.stringify(captured?.data).includes("Implement the feature"), false, "telemetry excludes capsule content");

      await harness.runHooks("session_compact", { reason: "threshold" }, ctx);
      eq(harness.sent.length, 1, "successful compaction restores one message");
      eq(harness.sent[0].options.deliverAs, "steer", "restore is delivered as a steer message");
      assert(harness.sent[0].message.content.includes("Current objective: Implement the feature"), "objective resumes");
      assert(harness.sent[0].message.content.includes("src/new-file.ts"), "observed changed file resumes");
      assert(harness.sent[0].message.content.includes("project_check (verify) completed"), "successful check is recorded");
      assert(!harness.sent[0].message.content.includes("abcd1234"), "credential-shaped text is redacted");
      for (const secret of ["bearer_secret_123", "plain_secret_456", "aws_secret_789", "sk-proj-abcdefghijklmnopqrstuvwxyz123456"]) {
        assert(!harness.sent[0].message.content.includes(secret), `${secret} is redacted`);
      }
      eq(harness.appended.at(-1)?.data.phase, "restored", "successful restore is recorded");

      await harness.runHooks("session_compact", { reason: "threshold" }, ctx);
      eq(harness.sent.length, 1, "duplicate compact event does not restore twice");
      await harness.runHooks(
        "tool_result",
        {
          toolName: "edit",
          input: { path: "src/second-file.ts" },
          isError: false,
        },
        ctx,
      );
      await harness.runHooks("session_before_compact", { reason: "threshold" }, ctx);
      assert(harness.appended.at(-1)?.data.serializedBytes <= 3 * 1024, "repeated capsule stays within target size");
      await harness.runHooks("session_compact", { reason: "threshold" }, ctx);
      eq(harness.sent.length, 2, "a later compaction restores the current turn once again");
      assert(harness.sent[1].message.content.includes("src/second-file.ts"), "later capsule includes newer observed progress");
      await harness.runHooks("agent_end", { messages: [] }, ctx);
      await harness.runHooks("session_before_compact", { reason: "manual" }, ctx);
      eq(harness.sent.length, 2, "completed turn leaves no active capsule");
    });

    if (!contextCapsule) return;

    const shortTurn = createHarness();
    contextCapsule.default(shortTurn.api);
    const shortContext = shortTurn.makeContext();
    await shortTurn.runHooks("session_start", {}, shortContext);
    await shortTurn.runHooks("before_agent_start", { prompt: "Small edit." }, shortContext);
    await shortTurn.runHooks("agent_end", { messages: [] }, shortContext);
    eq(shortTurn.sent.length, 0, "short turn receives no capsule message");
    eq(shortTurn.appended.length, 0, "short turn creates no capsule telemetry");

    const makePending = async () => {
        const harness = createHarness();
        contextCapsule.default(harness.api);
        const ctx = harness.makeContext();
        await harness.runHooks("session_start", {}, ctx);
        await harness.runHooks("before_agent_start", { prompt: "Keep this objective." }, ctx);
        await harness.runHooks("session_before_compact", { reason: "threshold" }, ctx);
        return { harness, ctx };
      };

      const staleTurn = await makePending();
      await staleTurn.harness.runHooks("before_agent_start", { prompt: "New objective." }, staleTurn.ctx);
      await staleTurn.harness.runHooks("session_compact", { reason: "threshold" }, staleTurn.ctx);
      eq(staleTurn.harness.sent.length, 0, "previous-turn capsule is discarded");

      const failed = await makePending();
      await failed.harness.runHooks("session_compact_failed", { reason: "threshold", errorMessage: "failed", willRetry: false }, failed.ctx);
      await failed.harness.runHooks("session_compact", { reason: "threshold" }, failed.ctx);
      eq(failed.harness.sent.length, 0, "failed compaction never restores");
      eq(failed.harness.appended.at(-1)?.data.phase, "discarded", "failed capsule is marked discarded");

      const staleSession = await makePending();
      await staleSession.harness.runHooks("session_shutdown", {}, staleSession.ctx);
      eq(staleSession.harness.appended.at(-1)?.data.phase, "discarded", "shutdown records an un-restored capsule as discarded");
      await staleSession.harness.runHooks("session_start", {}, staleSession.ctx);
      await staleSession.harness.runHooks("session_compact", { reason: "threshold" }, staleSession.ctx);
    eq(staleSession.harness.sent.length, 0, "previous-session capsule is discarded");
  },
};
