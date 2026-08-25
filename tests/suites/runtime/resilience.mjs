import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq } from "../../shared/assertions.mjs";
import {
  assertNoGlobalChrome,
  createHarness,
  latestStatus,
} from "../../shared/harness.mjs";
import { ROOT } from "../../shared/jiti-loader.mjs";

export const resilienceSections = {
  "resilience telemetry and recovery": async (context) => {
    const { section, resilience, modePermissions } = context;

    await section("resilience telemetry and recovery", async () => {
      if (!resilience) return;
      const harness = createHarness();
      resilience.default(harness.api);
      const ctx = harness.makeContext({ cwd: ROOT });
      await harness.runHooks("session_start", {}, ctx);

      await harness.runHooks("before_agent_start", {}, ctx);
      const start = harness.appended.at(-1);
      eq(start?.customType, "resilience.turn-start", "turn start is persisted");
      eq(start?.data.workflowMode, "work", "turn start records workflow mode");
      eq(start?.data.provider, "main-provider", "turn start records provider");
      await harness.runHooks("agent_start", {}, ctx);
      await harness.runHooks("after_provider_response", { status: 503 }, ctx);
      await harness.runHooks(
        "message_update",
        {
          assistantMessageEvent: {
            type: "error",
            error: { errorMessage: "ECONNRESET" },
          },
        },
        ctx,
      );
      await harness.runHooks(
        "message_update",
        {
          assistantMessageEvent: {
            type: "error",
            error: {
              errorMessage:
                'Error: 403: {"message":"Access to model denied","type":"AccessDenied.Unpurchased"}',
            },
          },
        },
        ctx,
      );
      await harness.runHooks(
        "tool_execution_start",
        { toolName: "bash", toolCallId: "tool-1", args: {} },
        ctx,
      );
      await harness.dispatchEvent("subagent:async-started", {});
      await harness.runHooks(
        "session_before_compact",
        { reason: "threshold", willRetry: false },
        ctx,
      );
      await harness.runHooks(
        "session_compact",
        { reason: "threshold", willRetry: false },
        ctx,
      );
      await harness.dispatchEvent("subagent:async-complete", {});
      // A following agent start represents Pi's own retry. The extension only
      // observes it; it does not start a retry or alter retry configuration.
      await harness.runHooks("agent_start", {}, ctx);
      await harness.runHooks("agent_settled", {}, ctx);

      const failures = harness.appended.filter(
        (entry) => entry.customType === "resilience.failure",
      );
      eq(
        failures.length,
        3,
        "HTTP, network, and model access failures are observed separately",
      );
      eq(
        failures[0]?.data.errorCode,
        "HTTP_503",
        "HTTP failure keeps status only",
      );
      eq(
        failures[1]?.data.errorCode,
        "ECONNRESET",
        "network failure keeps code only",
      );
      eq(
        failures[1]?.data.errorMessage,
        "ECONNRESET",
        "the concrete provider error text is preserved for diagnosis",
      );
      eq(
        failures[2]?.data.errorClass,
        "auth",
        "model access denied error is classified as auth",
      );
      eq(
        failures[2]?.data.errorCode,
        "MODEL_ACCESS_DENIED",
        "model access denied error code is MODEL_ACCESS_DENIED",
      );
      const boundaries = harness.appended.filter(
        (entry) => entry.customType === "resilience.compaction-boundary",
      );
      eq(
        boundaries.map((entry) => entry.data.boundary),
        ["started", "completed"],
        "compaction boundaries are persisted",
      );
      const settled = harness.appended.at(-1);
      eq(
        settled?.customType,
        "resilience.turn-settled",
        "settled turn is persisted",
      );
      eq(
        settled?.data.outcome,
        "completed_after_failure",
        "a native retry after observed failures settles as completed_after_failure",
      );
      eq(
        settled?.data.observedFailureCount,
        3,
        "settled turn preserves observed failures",
      );
      eq(
        settled?.data.recoveryPending,
        undefined,
        "a turn that recovered through retry carries no pending recovery",
      );

      // A manual /compact between turns (no open turn) that the runtime patch
      // reports as failed must still be persisted with its error message,
      // even though there is no turn to attach an observed-failure count to.
      const failureCountBeforeCompactFailure = harness.appended.filter(
        (entry) => entry.customType === "resilience.failure",
      ).length;
      await harness.runHooks(
        "session_compact_failed",
        {
          reason: "manual",
          errorMessage: "This model's maximum context length is 200000 tokens",
          willRetry: false,
        },
        ctx,
      );
      const failedBoundary = harness.appended.at(-1);
      eq(
        failedBoundary?.customType,
        "resilience.compaction-boundary",
        "a failed compaction attempt is persisted",
      );
      eq(
        failedBoundary?.data.boundary,
        "failed",
        "the boundary marks the attempt as failed",
      );
      eq(
        failedBoundary?.data.errorMessage,
        "This model's maximum context length is 200000 tokens",
        "the failure reason is preserved for diagnosis",
      );
      eq(
        harness.appended.filter(
          (entry) => entry.customType === "resilience.failure",
        ).length,
        failureCountBeforeCompactFailure,
        "a compaction failure with no open turn does not fabricate a turn failure",
      );

      await harness.runHooks("before_agent_start", {}, ctx);
      await harness.runHooks("agent_start", {}, ctx);
      await harness.runHooks(
        "agent_end",
        {
          messages: [
            {
              role: "assistant",
              stopReason: "error",
              errorMessage: "ETIMEDOUT",
            },
          ],
        },
        ctx,
      );
      await harness.runHooks("agent_settled", {}, ctx);
      const recovery = harness.appended.at(-1);
      eq(
        recovery?.customType,
        "resilience.recovery-required",
        "final failure requests safe recovery",
      );
      eq(recovery?.data.reason, "final_failure", "final failure is classified");

      const nextTurnResults = await harness.runHooks(
        "before_agent_start",
        {},
        ctx,
      );
      eq(
        nextTurnResults.at(-1)?.message?.customType,
        "pi-resilience-recovery",
        "next turn receives a recovery instruction instead of a replay",
      );

      const resumed = createHarness({
        entries: [
          {
            type: "custom",
            customType: "resilience.turn-start",
            data: {
              schemaVersion: 1,
              timestamp: "2026-08-10T20:00:00.000Z",
              workspaceFingerprint: "unavailable",
              workflowMode: "work",
              provider: "provider",
              model: "model",
              contextPercent: 42,
            },
          },
        ],
      });
      resilience.default(resumed.api);
      const resumedCtx = resumed.makeContext({ cwd: ROOT });
      await resumed.runHooks("session_start", {}, resumedCtx);
      eq(
        resumed.appended.at(-1)?.customType,
        "resilience.recovery-required",
        "resumed open turn is marked for inspection once",
      );
      const resumedTurn = await resumed.runHooks(
        "before_agent_start",
        {},
        resumedCtx,
      );
      assert(
        resumedTurn.at(-1)?.message?.content.includes("git status --short"),
        "changed or unavailable workspace requires inspection before mutation",
      );

      const resumedFinalFailure = createHarness({
        entries: [
          {
            type: "custom",
            customType: "resilience.turn-start",
            data: {
              schemaVersion: 1,
              timestamp: "2026-08-10T20:01:00.000Z",
              workspaceFingerprint: "unavailable",
              workflowMode: "work",
              provider: "provider",
              model: "model",
              contextPercent: 42,
            },
          },
          {
            type: "custom",
            customType: "resilience.turn-settled",
            data: {
              schemaVersion: 1,
              timestamp: "2026-08-10T20:01:01.000Z",
              turnStartedAt: "2026-08-10T20:01:00.000Z",
              workspaceFingerprint: "unavailable",
              outcome: "failed",
              observedFailureCount: 1,
            },
          },
          {
            type: "custom",
            customType: "resilience.recovery-required",
            data: {
              schemaVersion: 1,
              timestamp: "2026-08-10T20:01:02.000Z",
              turnStartedAt: "2026-08-10T20:01:00.000Z",
              reason: "final_failure",
              workspaceChangedSinceTurnStart: true,
              toolMayHaveMutatedWorkspace: true,
            },
          },
        ],
      });
      resilience.default(resumedFinalFailure.api);
      const finalFailureCtx = resumedFinalFailure.makeContext({ cwd: ROOT });
      await resumedFinalFailure.runHooks("session_start", {}, finalFailureCtx);
      eq(
        resumedFinalFailure.appended.length,
        0,
        "existing recovery marker is not duplicated on resume",
      );
      const finalFailureTurn = await resumedFinalFailure.runHooks(
        "before_agent_start",
        {},
        finalFailureCtx,
      );
      assert(
        finalFailureTurn
          .at(-1)
          ?.message?.content.includes("git status --short"),
        "resume after a persisted final failure still injects recovery guidance",
      );

      // --- Recovery-Gate: Schreibsperre bis zum recovery_check ---
      const gateHarness = createHarness();
      modePermissions.default(gateHarness.api);
      resilience.default(gateHarness.api);
      const gateCtx = gateHarness.makeContext({ cwd: ROOT });
      await gateHarness.runHooks("session_start", {}, gateCtx);
      await gateHarness.runHooks("before_agent_start", {}, gateCtx);
      await gateHarness.runHooks("agent_start", {}, gateCtx);
      await gateHarness.runHooks(
        "message_update",
        { assistantMessageEvent: { type: "text_start" } },
        gateCtx,
      );
      await gateHarness.runHooks(
        "message_update",
        {
          assistantMessageEvent: { type: "error", error: { errorMessage: "" } },
        },
        gateCtx,
      );
      const streamFailure = gateHarness.appended.at(-1);
      eq(
        streamFailure?.customType,
        "resilience.failure",
        "a streaming error without text is observed",
      );
      eq(
        streamFailure?.data.errorClass,
        "stream",
        "a textless streaming failure is classified as stream, not unknown",
      );
      eq(
        streamFailure?.data.errorCode,
        "STREAM_PHASE",
        "the streaming phase is preserved as error context",
      );
      await gateHarness.runHooks(
        "tool_execution_start",
        { toolName: "edit", toolCallId: "gate-edit", args: {} },
        gateCtx,
      );
      await gateHarness.runHooks("agent_settled", {}, gateCtx);
      const gateSettled = gateHarness.appended
        .filter((entry) => entry.customType === "resilience.turn-settled")
        .at(-1);
      eq(gateSettled?.data.outcome, "failed", "the gate turn settles failed");
      eq(
        gateSettled?.data.recoveryPending,
        true,
        "a failed turn marks its recovery as pending",
      );
      const gateRequired = gateHarness.appended
        .filter((entry) => entry.customType === "resilience.recovery-required")
        .at(-1);
      eq(
        gateRequired?.data.toolMayHaveMutatedWorkspace,
        true,
        "the failed turn may have mutated the workspace",
      );
      eq(
        latestStatus(gateHarness, "recovery"),
        "⚠ Recovery-Check offen",
        "an armed recovery gate stays visible in the TUI",
      );

      const blockedWrite = await gateHarness.runHooks(
        "tool_call",
        { toolName: "write", input: { path: "example.txt", content: "x" } },
        gateCtx,
      );
      assert(
        blockedWrite.some(
          (result) => result?.block && /Recovery-Gate/.test(result.reason),
        ),
        "writes are blocked while the recovery gate is armed",
      );
      const blockedBash = await gateHarness.runHooks(
        "tool_call",
        { toolName: "bash", input: { command: "npm test" } },
        gateCtx,
      );
      assert(
        blockedBash.some(
          (result) => result?.block && /Recovery-Gate/.test(result.reason),
        ),
        "potentially mutating shell calls are blocked while armed",
      );
      const freeRead = await gateHarness.runHooks(
        "tool_call",
        { toolName: "read", input: { path: "README.md" } },
        gateCtx,
      );
      assert(
        freeRead.every((result) => !result?.block),
        "read-only tools stay available while armed",
      );
      const freeDiagnosticBash = await gateHarness.runHooks(
        "tool_call",
        { toolName: "bash", input: { command: "git status --short" } },
        gateCtx,
      );
      assert(
        freeDiagnosticBash.every((result) => !result?.block),
        "diagnostic shell commands stay available while armed",
      );
      const freeRecoveryCall = await gateHarness.runHooks(
        "tool_call",
        { toolName: "recovery_check", input: {} },
        gateCtx,
      );
      assert(
        freeRecoveryCall.every((result) => !result?.block),
        "recovery_check itself is never blocked by its own gate",
      );

      const recoveryTool = gateHarness.tools.get("recovery_check");
      assert(Boolean(recoveryTool), "recovery_check is registered as a tool");
      const recoveryResult = await recoveryTool.execute(
        "check-1",
        {},
        undefined,
        undefined,
        gateCtx,
      );
      assert(
        recoveryResult.content[0]?.text.includes(
          "Recovery-Check abgeschlossen",
        ),
        "recovery_check reports the released gate",
      );
      const checked = gateHarness.appended.filter(
        (entry) => entry.customType === "resilience.recovery-checked",
      );
      eq(checked.length, 1, "the successful check is persisted exactly once");
      eq(
        checked[0]?.data.turnStartedAt,
        gateRequired?.data.turnStartedAt,
        "the check references the failed turn",
      );
      eq(
        latestStatus(gateHarness, "recovery"),
        undefined,
        "a successful check clears the recovery status",
      );
      const unblockedWrite = await gateHarness.runHooks(
        "tool_call",
        { toolName: "write", input: { path: "example.txt", content: "x" } },
        gateCtx,
      );
      assert(
        unblockedWrite.every((result) => !result?.block),
        "writes are released after a successful recovery check",
      );

      // A different workspace fingerprint re-arms the checked gate.
      const otherCwd = mkdtempSync(path.join(tmpdir(), "pi-recovery-gate-"));
      try {
        const otherCtx = gateHarness.makeContext({ cwd: otherCwd });
        await gateHarness.runHooks("before_agent_start", {}, otherCtx);
        const reblockedWrite = await gateHarness.runHooks(
          "tool_call",
          { toolName: "write", input: { path: "example.txt", content: "x" } },
          otherCtx,
        );
        assert(
          reblockedWrite.some(
            (result) => result?.block && /Recovery-Gate/.test(result.reason),
          ),
          "a changed workspace re-arms a checked recovery gate",
        );
      } finally {
        rmSync(otherCwd, { recursive: true, force: true });
      }

      // Persisted recovery survives a restart and unlocks through the check.
      const restarted = createHarness({
        entries: [
          {
            type: "custom",
            customType: "resilience.turn-start",
            data: {
              schemaVersion: 2,
              timestamp: "2026-08-19T00:00:00.000Z",
              workspaceFingerprint: "unavailable",
              workflowMode: "work",
              provider: "provider",
              model: "model",
              contextPercent: 10,
            },
          },
          {
            type: "custom",
            customType: "resilience.turn-settled",
            data: {
              schemaVersion: 2,
              timestamp: "2026-08-19T00:00:01.000Z",
              turnStartedAt: "2026-08-19T00:00:00.000Z",
              workspaceFingerprint: "unavailable",
              outcome: "failed",
              observedFailureCount: 1,
              recoveryPending: true,
            },
          },
          {
            type: "custom",
            customType: "resilience.recovery-required",
            data: {
              schemaVersion: 2,
              timestamp: "2026-08-19T00:00:02.000Z",
              turnStartedAt: "2026-08-19T00:00:00.000Z",
              reason: "final_failure",
              workspaceChangedSinceTurnStart: false,
              toolMayHaveMutatedWorkspace: true,
            },
          },
        ],
      });
      modePermissions.default(restarted.api);
      resilience.default(restarted.api);
      const restartedCtx = restarted.makeContext({ cwd: ROOT });
      await restarted.runHooks("session_start", {}, restartedCtx);
      const restartedBlocked = await restarted.runHooks(
        "tool_call",
        { toolName: "write", input: { path: "example.txt", content: "x" } },
        restartedCtx,
      );
      assert(
        restartedBlocked.some(
          (result) => result?.block && /Recovery-Gate/.test(result.reason),
        ),
        "a persisted recovery gate still blocks writes after a restart",
      );
      const restartedTool = restarted.tools.get("recovery_check");
      await restartedTool.execute(
        "check-2",
        {},
        undefined,
        undefined,
        restartedCtx,
      );
      const restartedUnblocked = await restarted.runHooks(
        "tool_call",
        { toolName: "write", input: { path: "example.txt", content: "x" } },
        restartedCtx,
      );
      assert(
        restartedUnblocked.every((result) => !result?.block),
        "recovery_check unlocks a restored gate after restart",
      );
    });
  },

  "combined production extension stack": async (context) => {
    const {
      section,
      modePermissions,
      planMode,
      controlPlane,
      compactTools,
      diffViewer,
      askUser,
      lspExtensionMod,
      setupCore,
      auroraUi,
      resilience,
      sessionHealth,
    } = context;

    await section("combined production extension stack", async () => {
      if (
        !modePermissions ||
        !planMode ||
        !setupCore ||
        !askUser ||
        !lspExtensionMod ||
        !diffViewer ||
        !controlPlane ||
        !compactTools ||
        !auroraUi ||
        !resilience ||
        !sessionHealth
      )
        return;
      const factoryByExtension = {
        "+extensions/setup-core/index.ts": setupCore.default,
        "+extensions/plan-mode/index.ts": planMode.default,
        "+extensions/mode-permissions.ts": modePermissions.default,
        "+extensions/lsp/index.ts": lspExtensionMod.default,
        "+extensions/ask-user.ts": askUser.default,
        "+extensions/diff-viewer/index.ts": diffViewer.default,
        "+extensions/control-plane.ts": controlPlane.default,
        "+extensions/compact-tools/index.ts": compactTools.default,
        "+extensions/aurora-ui/index.ts": auroraUi.default,
        "+extensions/resilience/index.ts": resilience.default,
        "+extensions/session-health/index.ts": sessionHealth.default,
      };
      const settings = JSON.parse(
        readFileSync(path.join(ROOT, "settings.json"), "utf8"),
      );
      const activeExtensions = settings.extensions.filter(
        (entry) =>
          typeof entry === "string" && entry.startsWith("+extensions/"),
      );
      eq(
        activeExtensions,
        Object.keys(factoryByExtension),
        "combined stack activates exactly the configured local entry points",
      );
      const factories = activeExtensions.map(
        (extension) => factoryByExtension[extension],
      );
      const harness = createHarness();
      for (const factory of factories) factory(harness.api);
      // A dedicated cwd keeps this test isolated from any real .agent/plans/
      // current-plan.md that may exist at ROOT (this repo's own working state),
      // which would otherwise push plan-mode into "draft" and flip the expected
      // "WORK" workflow status below.
      const cwd = mkdtempSync(path.join(tmpdir(), "pi-combined-stack-"));
      const context = harness.makeContext({ cwd });
      await harness.runHooks("session_start", {}, context);
      eq(
        harness.chrome,
        { footer: 1, editor: 0, widget: 1, header: 0 },
        "combined stack gives Aurora exclusive ownership of custom chrome",
      );
      eq(
        harness.duplicateTools,
        [],
        "combined stack has no duplicate local tools",
      );
      eq(
        [...harness.tools.keys()].sort(),
        [
          "ask_user",
          "bash",
          "find",
          "grep",
          "ls",
          "lsp_definition",
          "lsp_diagnostics",
          "lsp_hover",
          "lsp_references",
          "lsp_workspace_symbols",
          "project_check",
          "read",
          "recovery_check",
          "verify",
          "write",
        ],
        "local functional tools plus compact-tools' renderShell overrides register locally",
      );
      eq(
        latestStatus(harness, "permissions"),
        "🛡 DEFAULT · PROJECT WRITE",
        "the workflow default is visible in the shared footer",
      );
      eq(
        latestStatus(harness, "workflow"),
        "Work",
        "combined stack publishes workflow",
      );
      eq(
        harness.workingVisibility.at(-1),
        false,
        "combined stack starts without a permanent activity widget",
      );
      eq(
        latestStatus(harness, "lsp"),
        "leerlauf",
        "combined stack publishes an idle lsp status with no active servers",
      );
      const lspCommand = harness.commands.get("lsp");
      assert(Boolean(lspCommand), "/lsp is registered");
      if (lspCommand) await lspCommand("off", context);
      eq(
        latestStatus(harness, "lsp"),
        "aus",
        "the session-local LSP override can disable LSP",
      );
      await harness.runHooks("session_shutdown", {}, context);
      eq(
        latestStatus(harness, "lsp"),
        undefined,
        "session_shutdown clears the lsp status",
      );
      const nextContext = harness.makeContext({
        cwd,
        sessionId: "next-session",
      });
      await harness.runHooks("session_start", {}, nextContext);
      eq(
        latestStatus(harness, "lsp"),
        "leerlauf",
        "a new session does not inherit the previous LSP override",
      );
      await harness.runHooks("session_shutdown", {}, nextContext);

      for (const mode of ["json", "print", "rpc"]) {
        const nonTui = createHarness();
        for (const factory of factories) factory(nonTui.api);
        const contextForMode = nonTui.makeContext({ mode, hasUI: false });
        await nonTui.runHooks("session_start", {}, contextForMode);
        eq(
          nonTui.statusCalls,
          [],
          "combined stack produces no status output in " + mode + " mode",
        );
        assertNoGlobalChrome(
          nonTui,
          "combined stack installs no chrome in " + mode + " mode",
        );
      }
    });
  },
};
