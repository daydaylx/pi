import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";

export const contextCapsuleSections = {
  "context capsule compaction lifecycle": async (context) => {
    const { section, contextCapsule } = context;
    await section("context capsule compaction lifecycle", async () => {
      if (!contextCapsule) return;
      const capsuleHelpers = await context.load(
        "extensions/context-capsule/capsule.ts",
      );
      if (!capsuleHelpers) return;

      const extractedCriteria = capsuleHelpers.extractAcceptanceCriteria(
        [
          "## Abnahmekriterien",
          "- Waybar öffnet das native Menü",
          "- [ ] Build und Live-Prüfung sind erfolgreich",
          "## Hinweise",
          "- Dieser Hinweis ist kein Abnahmekriterium",
        ].join("\n"),
      );
      eq(
        extractedCriteria,
        [
          "Waybar öffnet das native Menü",
          "Build und Live-Prüfung sind erfolgreich",
        ],
        "only explicitly grouped acceptance criteria are extracted",
      );

      const oversizedCapsule = capsuleHelpers.createContextCapsule({
        objective: "O".repeat(1200),
        acceptanceCriteria: Array.from(
          { length: 8 },
          (_, index) => `Criterion ${index + 1}: ${"界".repeat(150)}`,
        ),
        changedFiles: Array.from(
          { length: 12 },
          (_, index) => `src/${index}/${"path/".repeat(18)}file.ts`,
        ),
        openRisks: Array.from(
          { length: 4 },
          (_, index) => `Risk ${index + 1}: ${"r".repeat(145)}`,
        ),
        progress: Array.from({ length: 6 }, (_, index) => `Step ${index + 1}`),
      });
      const boundedJson =
        capsuleHelpers.serializeContextCapsule(oversizedCapsule);
      assert(
        Buffer.byteLength(boundedJson, "utf8") <= 3 * 1024,
        "oversized capsules are reduced to the target size",
      );
      eq(
        JSON.parse(boundedJson).acceptanceCriteria.length,
        8,
        "acceptance criteria survive size reduction",
      );
      eq(
        oversizedCapsule.changedFiles.length,
        12,
        "serialization does not mutate the active work state",
      );

      const harness = createHarness();
      contextCapsule.default(harness.api);
      const ctx = harness.makeContext();
      await harness.runHooks("session_start", {}, ctx);
      await harness.runHooks(
        "before_agent_start",
        {
          prompt: [
            "Implement the feature; API_KEY=abcd1234; Authorization: Bearer bearer_secret_123; password=plain_secret_456; AWS_SECRET_ACCESS_KEY=aws_secret_789; sk-proj-abcdefghijklmnopqrstuvwxyz123456.",
            "",
            "## Acceptance Criteria",
            "- The native menu opens from Waybar",
            "- Build and live verification pass",
          ].join("\n"),
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
      await harness.runHooks(
        "session_before_compact",
        { reason: "threshold" },
        ctx,
      );

      const captured = harness.appended.at(-1);
      eq(
        captured?.customType,
        "context-capsule.telemetry",
        "capture writes metadata only",
      );
      eq(captured?.data.phase, "captured", "pre-compaction phase is recorded");
      assert(
        captured?.data.serializedBytes <= 3 * 1024,
        "capsule stays within target size",
      );
      eq(
        JSON.stringify(captured?.data).includes("Implement the feature"),
        false,
        "telemetry excludes capsule content",
      );

      await harness.runHooks("session_compact", { reason: "threshold" }, ctx);
      eq(harness.sent.length, 1, "successful compaction restores one message");
      eq(
        harness.sent[0].options.deliverAs,
        "steer",
        "restore is delivered as a steer message",
      );
      assert(
        harness.sent[0].message.content.includes(
          "Current objective: Implement the feature",
        ),
        "objective resumes",
      );
      assert(
        harness.sent[0].message.content.includes(
          "The native menu opens from Waybar",
        ),
        "acceptance criteria resume",
      );
      assert(
        harness.sent[0].message.content.includes(
          "Continue the original request",
        ),
        "resume message identifies the original task as active",
      );
      assert(
        harness.sent[0].message.content.includes(
          "prior user-provided task data",
        ),
        "resumed task context is explicitly treated as user data",
      );
      assert(
        harness.sent[0].message.content.includes("src/new-file.ts"),
        "observed changed file resumes",
      );
      assert(
        harness.sent[0].message.content.includes(
          "project_check (verify) completed",
        ),
        "successful check is recorded",
      );
      assert(
        !harness.sent[0].message.content.includes("abcd1234"),
        "credential-shaped text is redacted",
      );
      for (const secret of [
        "bearer_secret_123",
        "plain_secret_456",
        "aws_secret_789",
        "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      ]) {
        assert(
          !harness.sent[0].message.content.includes(secret),
          `${secret} is redacted`,
        );
      }
      eq(
        harness.appended.at(-1)?.data.phase,
        "restored",
        "successful restore is recorded",
      );

      await harness.runHooks("session_compact", { reason: "threshold" }, ctx);
      eq(
        harness.sent.length,
        1,
        "duplicate compact event does not restore twice",
      );
      await harness.runHooks(
        "tool_result",
        {
          toolName: "edit",
          input: { path: "src/second-file.ts" },
          isError: false,
        },
        ctx,
      );
      await harness.runHooks(
        "session_before_compact",
        { reason: "threshold" },
        ctx,
      );
      assert(
        harness.appended.at(-1)?.data.serializedBytes <= 3 * 1024,
        "repeated capsule stays within target size",
      );
      await harness.runHooks("session_compact", { reason: "threshold" }, ctx);
      eq(
        harness.sent.length,
        2,
        "a later compaction restores the current turn once again",
      );
      assert(
        harness.sent[1].message.content.includes("src/second-file.ts"),
        "later capsule includes newer observed progress",
      );
      await harness.runHooks("agent_end", { messages: [] }, ctx);
      await harness.runHooks(
        "session_before_compact",
        { reason: "manual" },
        ctx,
      );
      eq(harness.sent.length, 2, "completed turn leaves no active capsule");
    });

    if (!contextCapsule) return;

    const shortTurn = createHarness();
    contextCapsule.default(shortTurn.api);
    const shortContext = shortTurn.makeContext();
    await shortTurn.runHooks("session_start", {}, shortContext);
    await shortTurn.runHooks(
      "before_agent_start",
      { prompt: "Small edit." },
      shortContext,
    );
    await shortTurn.runHooks("agent_end", { messages: [] }, shortContext);
    eq(shortTurn.sent.length, 0, "short turn receives no capsule message");
    eq(shortTurn.appended.length, 0, "short turn creates no capsule telemetry");

    const continuation = createHarness();
    contextCapsule.default(continuation.api);
    const continuationContext = continuation.makeContext();
    await continuation.runHooks("session_start", {}, continuationContext);
    await continuation.runHooks(
      "before_agent_start",
      {
        prompt: [
          "Implement the network popup.",
          "## Abnahmekriterien",
          "- Waybar starts the native popup",
          "- The running UI is verified",
        ].join("\n"),
      },
      continuationContext,
    );
    await continuation.runHooks(
      "agent_end",
      { messages: [] },
      continuationContext,
    );
    const resumed = await continuation.runHooks(
      "before_agent_start",
      { prompt: "Dann weiter mit den offenen Punkten." },
      continuationContext,
    );
    assert(
      resumed
        .at(-1)
        ?.systemPrompt.includes(
          "Current objective: Implement the network popup.",
        ),
      "short continuation restores the original objective",
    );
    assert(
      resumed.at(-1)?.systemPrompt.includes("Waybar starts the native popup"),
      "short continuation restores acceptance criteria",
    );
    await continuation.runHooks(
      "session_before_compact",
      { reason: "threshold" },
      continuationContext,
    );
    await continuation.runHooks(
      "session_compact",
      { reason: "threshold" },
      continuationContext,
    );
    assert(
      continuation.sent
        .at(-1)
        ?.message.content.includes("The running UI is verified"),
      "acceptance criteria remain available after a continuation and compaction",
    );

    const newObjective = await continuation.runHooks(
      "before_agent_start",
      { prompt: "Investigate a separate backup issue." },
      continuationContext,
    );
    eq(
      newObjective.at(-1),
      undefined,
      "a substantive new prompt starts a new task instead of inheriting old criteria",
    );
    await continuation.runHooks(
      "session_before_compact",
      { reason: "threshold" },
      continuationContext,
    );
    await continuation.runHooks(
      "session_compact",
      { reason: "threshold" },
      continuationContext,
    );
    assert(
      continuation.sent
        .at(-1)
        ?.message.content.includes(
          "Current objective: Investigate a separate backup issue.",
        ),
      "new task context replaces the prior objective",
    );
    assert(
      !continuation.sent
        .at(-1)
        ?.message.content.includes("Waybar starts the native popup"),
      "new task context excludes previous acceptance criteria",
    );

    const guiContinuation = createHarness();
    contextCapsule.default(guiContinuation.api);
    const guiContext = guiContinuation.makeContext();
    await guiContinuation.runHooks("session_start", {}, guiContext);
    await guiContinuation.runHooks(
      "before_agent_start",
      {
        prompt: [
          "Halve the PiSystem chat font and show the result in the running GUI.",
          "## Acceptance Criteria",
          "- The new binary is built",
          "- The running GUI visibly uses the smaller font",
        ].join("\n"),
      },
      guiContext,
    );
    await guiContinuation.runHooks("agent_end", { messages: [] }, guiContext);
    const restartFollowup = await guiContinuation.runHooks(
      "before_agent_start",
      { prompt: "Bitte die aktuelle Sitzung neustarten von PiSystem." },
      guiContext,
    );
    assert(
      restartFollowup
        .at(-1)
        ?.systemPrompt.includes("Halve the PiSystem chat font"),
      "live restart follow-up retains the original GUI task",
    );
    assert(
      restartFollowup
        .at(-1)
        ?.systemPrompt.includes("visibly uses the smaller font"),
      "live restart follow-up retains visual acceptance criteria",
    );

    const makePending = async () => {
      const harness = createHarness();
      contextCapsule.default(harness.api);
      const ctx = harness.makeContext();
      await harness.runHooks("session_start", {}, ctx);
      await harness.runHooks(
        "before_agent_start",
        { prompt: "Keep this objective." },
        ctx,
      );
      await harness.runHooks(
        "session_before_compact",
        { reason: "threshold" },
        ctx,
      );
      return { harness, ctx };
    };

    const staleTurn = await makePending();
    await staleTurn.harness.runHooks(
      "before_agent_start",
      { prompt: "New objective." },
      staleTurn.ctx,
    );
    await staleTurn.harness.runHooks(
      "session_compact",
      { reason: "threshold" },
      staleTurn.ctx,
    );
    eq(staleTurn.harness.sent.length, 0, "previous-turn capsule is discarded");

    const customRun = await makePending();
    await customRun.harness.runHooks(
      "before_agent_start",
      { messageType: "custom", message: {} },
      customRun.ctx,
    );
    await customRun.harness.runHooks(
      "session_compact",
      { reason: "threshold" },
      customRun.ctx,
    );
    eq(
      customRun.harness.sent.length,
      1,
      "extension-triggered run keeps the pending capsule",
    );
    assert(
      customRun.harness.sent[0].message.content.includes(
        "Current objective: Keep this objective.",
      ),
      "objective survives an extension-triggered run",
    );

    const failed = await makePending();
    await failed.harness.runHooks(
      "session_compact_failed",
      { reason: "threshold", errorMessage: "failed", willRetry: false },
      failed.ctx,
    );
    await failed.harness.runHooks(
      "session_compact",
      { reason: "threshold" },
      failed.ctx,
    );
    eq(failed.harness.sent.length, 0, "failed compaction never restores");
    eq(
      failed.harness.appended.at(-1)?.data.phase,
      "discarded",
      "failed capsule is marked discarded",
    );

    const staleSession = await makePending();
    await staleSession.harness.runHooks(
      "session_shutdown",
      {},
      staleSession.ctx,
    );
    eq(
      staleSession.harness.appended.at(-1)?.data.phase,
      "discarded",
      "shutdown records an un-restored capsule as discarded",
    );
    await staleSession.harness.runHooks("session_start", {}, staleSession.ctx);
    await staleSession.harness.runHooks(
      "session_compact",
      { reason: "threshold" },
      staleSession.ctx,
    );
    eq(
      staleSession.harness.sent.length,
      0,
      "previous-session capsule is discarded",
    );
  },
};
