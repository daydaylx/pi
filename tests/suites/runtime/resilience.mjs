import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq } from "../../shared/assertions.mjs";
import {
  assertNoGlobalChrome,
  createHarness,
  latestStatus,
} from "../../shared/harness.mjs";
import { ROOT } from "../../shared/jiti-loader.mjs";

// Session entries as Pi writes them: messages with role, stopReason and tool calls.
let entrySeq = 0;
const message = (role, fields = {}) => ({
  type: "message",
  id: `e${(entrySeq += 1)}`,
  message: { role, ...fields },
});
const user = (text = "weiter") =>
  message("user", { content: [{ type: "text", text }] });
const assistantCalls = (calls, stopReason = "toolUse") =>
  message("assistant", {
    stopReason,
    content: calls.map(([id, name, args]) => ({
      type: "toolCall",
      id,
      name,
      arguments: args,
    })),
  });
const toolResult = (id, isError = false) =>
  message("toolResult", {
    toolCallId: id,
    isError,
    content: [{ type: "text", text: "x" }],
  });
const finalAnswer = () =>
  message("assistant", {
    stopReason: "stop",
    content: [{ type: "text", text: "fertig" }],
  });

export const resilienceSections = {
  "resilience telemetry and recovery": async (context) => {
    const { section, resilience } = context;

    await section("resilience telemetry and recovery", async () => {
      if (!resilience) return;

      const harness = createHarness();
      resilience.default(harness.api);
      const ctx = harness.makeContext({ cwd: ROOT });
      await harness.runHooks("session_start", {}, ctx);

      await harness.runHooks("before_agent_start", {}, ctx);
      const start = harness.appended.at(-1);
      eq(start?.customType, "resilience.turn-start", "turn start is persisted");
      eq(
        "workflowMode" in (start?.data ?? {}),
        false,
        "turn start no longer records a workflow mode",
      );
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
        "recoveryPending" in (settled?.data ?? {}),
        false,
        "a settled turn carries no recovery gate state anymore",
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

      // --- Kein Gate mehr: ein Fehlturn schreibt nur Telemetrie (ADR 041) ---
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
      eq(
        harness.appended.at(-1)?.customType,
        "resilience.turn-settled",
        "a final failure only settles the turn",
      );
      eq(harness.appended.at(-1)?.data.outcome, "failed", "outcome is failed");
      eq(
        harness.appended.some(
          (entry) => entry.customType === "resilience.recovery-required",
        ),
        false,
        "no recovery gate marker is written",
      );
      eq(
        harness.tools.has("recovery_check"),
        false,
        "the recovery_check tool no longer exists",
      );
      let answered = false;
      await harness.dispatchEvent("recovery-status:request", {
        respond() {
          answered = true;
        },
      });
      eq(answered, false, "no recovery status provider answers anymore");
      const nextTurn = await harness.runHooks("before_agent_start", {}, ctx);
      eq(
        nextTurn.at(-1)?.message,
        undefined,
        "a failed turn without any mutating call needs no notice",
      );
    });
  },

  "resilience interruption notice": async (context) => {
    const { section, load, resilience, modePermissions } = context;

    await section("resilience interruption notice", async () => {
      if (!resilience) return;
      const interruption = await load("extensions/resilience/interruption.ts");
      const { findInterruptedRun, formatInterruptionNotice, toolEffect } =
        interruption;
      const cwd = ROOT;
      const reasons = (entries) => findInterruptedRun(entries, cwd);

      // --- Klassifikation: nur bekannte lesende Werkzeuge gelten als lesend ---
      for (const [toolName, input, expected] of [
        ["read", {}, "read_only"],
        ["grep", {}, "read_only"],
        ["project_check", {}, "read_only"],
        ["wait", {}, "read_only"],
        ["bash", { command: "git status --short 2>&1 | head" }, "read_only"],
        ["bash", { command: "npm test" }, "potentially_mutating"],
        ["bash", { command: "git status > out.txt" }, "potentially_mutating"],
        ["bash", { command: "sed -n 'w out' f" }, "potentially_mutating"],
        ["interactive_shell", { command: "ls" }, "read_only"],
        ["interactive_shell", { command: "rm -rf x" }, "potentially_mutating"],
        ["edit", {}, "potentially_mutating"],
        ["write", {}, "potentially_mutating"],
        ["unknown_tool", {}, "potentially_mutating"],
        ["subagent", { spec: { profile: "research" } }, "read_only"],
        ["subagent", { spec: { profile: "analyse" } }, "read_only"],
        ["subagent", { spec: { profile: "verify" } }, "potentially_mutating"],
        ["system_job", { action: "status" }, "read_only"],
        ["system_job", { action: "start" }, "potentially_mutating"],
        ["system_unit_status", {}, "read_only"],
      ]) {
        eq(
          toolEffect({ toolName, input }, cwd),
          expected,
          `${toolName} ${JSON.stringify(input)} is ${expected}`,
        );
      }

      // --- Erkennung aus den nativen Session-Einträgen ---
      eq(reasons([]), undefined, "an empty session has no interruption");
      eq(
        reasons([
          user(),
          assistantCalls([["c1", "edit", { path: "a.ts" }]]),
          toolResult("c1"),
          finalAnswer(),
        ]),
        undefined,
        "a regularly finished run is not an interruption",
      );
      const failedAfterEdit = reasons([
        user(),
        assistantCalls([["c1", "edit", { path: "a.ts" }]]),
        toolResult("c1"),
        message("assistant", {
          stopReason: "error",
          errorMessage: "ECONNRESET",
          content: [],
        }),
      ]);
      eq(
        failedAfterEdit?.reason,
        "error",
        "an errored last message is an interruption",
      );
      eq(
        failedAfterEdit?.errorMessage,
        "ECONNRESET",
        "the provider error is kept",
      );
      eq(
        failedAfterEdit?.calls,
        [{ name: "edit", summary: "a.ts", outcome: "ok" }],
        "the completed mutating call is listed with its outcome",
      );
      eq(
        reasons([
          user(),
          assistantCalls([["c1", "grep", {}]]),
          toolResult("c1"),
          message("assistant", { stopReason: "error", content: [] }),
        ]),
        undefined,
        "an interrupted read-only run needs no notice",
      );
      eq(
        reasons([
          user(),
          message("assistant", {
            stopReason: "error",
            content: [
              {
                type: "toolCall",
                id: "c9",
                name: "write",
                arguments: { path: "x" },
              },
            ],
          }),
        ]),
        undefined,
        "tool calls of an errored message never ran and are not reported",
      );
      const aborted = reasons([
        user(),
        assistantCalls([["c1", "bash", { command: "npm install" }]]),
        toolResult("c1", true),
        message("assistant", { stopReason: "aborted", content: [] }),
      ]);
      eq(aborted?.reason, "aborted", "Esc is its own reason");
      eq(
        aborted?.calls[0]?.outcome,
        "error",
        "a failed result is reported as error",
      );
      const crashed = reasons([
        user(),
        assistantCalls([
          ["c1", "write", { path: "a.ts" }],
          ["c2", "bash", { command: "git commit -am x" }],
        ]),
        toolResult("c1"),
      ]);
      eq(
        crashed?.reason,
        "no-result",
        "a call without any result means the session ended mid-tool",
      );
      eq(
        crashed?.calls.map((call) => call.outcome),
        ["ok", "none"],
        "only the call without a result has an unknown outcome",
      );
      const noFollowUp = reasons([
        user(),
        assistantCalls([["c1", "edit", { path: "a.ts" }]]),
        toolResult("c1"),
      ]);
      eq(
        noFollowUp?.reason,
        "no-follow-up",
        "tool results without an answer are an interruption",
      );
      eq(
        reasons([
          user(),
          assistantCalls([["c1", "edit", { path: "a.ts" }]]),
          toolResult("c1"),
          message("assistant", { stopReason: "error", content: [] }),
          user("noch einmal"),
        ])?.reason,
        "error",
        "a trailing, not yet answered user prompt belongs to the new run",
      );
      eq(
        reasons([
          user("alt"),
          assistantCalls([["c0", "edit", { path: "old.ts" }]]),
          toolResult("c0"),
          message("assistant", { stopReason: "error", content: [] }),
          user("neu"),
          assistantCalls([["c1", "grep", {}]]),
          toolResult("c1"),
          finalAnswer(),
        ]),
        undefined,
        "a later regular run supersedes an older interruption",
      );
      const many = reasons([
        user(),
        assistantCalls(
          Array.from({ length: 12 }, (_, index) => [
            `m${index}`,
            "bash",
            { command: `touch file${index} ${"x".repeat(300)}` },
          ]),
        ),
        ...Array.from({ length: 12 }, (_, index) => toolResult(`m${index}`)),
      ]);
      eq(many?.calls.length, 8, "the notice lists at most the last 8 calls");
      assert(
        many.calls.every((call) => call.summary.length <= 141),
        "call summaries are truncated",
      );
      const withNotice = [
        user(),
        assistantCalls([["c1", "edit", { path: "a.ts" }]]),
        toolResult("c1"),
        message("assistant", { stopReason: "error", content: [] }),
      ];
      const lastId = withNotice.at(-1).id;
      eq(
        reasons([
          ...withNotice,
          {
            type: "custom",
            customType: "resilience.interruption-notice",
            data: { entryId: lastId },
          },
        ]),
        undefined,
        "an interruption that was already reported is not reported twice",
      );
      eq(
        reasons([
          { type: "message", message: { role: "user", content: [] } },
          {
            type: "message",
            message: {
              role: "assistant",
              stopReason: "aborted",
              content: [
                {
                  type: "toolCall",
                  id: "x",
                  name: "bash",
                  arguments: { command: "make" },
                },
                { type: "text" },
              ],
            },
          },
          "not an entry",
          { type: "message" },
        ]),
        undefined,
        "malformed entries and ids are tolerated",
      );
      const noId = findInterruptedRun(
        [
          { type: "message", message: { role: "user" } },
          {
            type: "message",
            message: {
              role: "assistant",
              stopReason: "toolUse",
              content: [
                {
                  type: "toolCall",
                  id: "x",
                  name: "bash",
                  arguments: { command: "make" },
                },
              ],
            },
          },
        ],
        cwd,
      );
      eq(noId?.reason, "no-result", "entries without ids are still analysed");
      assert(
        /^index-/.test(noId.entryId),
        "entries without ids fall back to their index",
      );

      // --- Wortlaut des Hinweises ---
      const text = formatInterruptionNotice(crashed, "Workspace x:\nM a.ts");
      assert(
        /endete während eines Tool-Aufrufs/.test(text) &&
          /write: a\.ts — Ergebnis: ok/.test(text) &&
          /bash: git commit -am x — kein Ergebnis — Ausgang unbekannt/.test(
            text,
          ) &&
          /möglicherweise ausgeführt/.test(text),
        "the notice names the reason, each call with its outcome and what to do",
      );
      assert(
        !/recovery_check|gesperrt/.test(text),
        "the notice neither blocks nor refers to a tool",
      );

      // --- Integration: der nächste Lauf bekommt genau einen Hinweis ---
      function gitFixture(prefix) {
        const dir = mkdtempSync(path.join(tmpdir(), prefix));
        const env = {
          ...process.env,
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: "Resilience Fixture",
          GIT_AUTHOR_EMAIL: "resilience-fixture@example.test",
          GIT_COMMITTER_NAME: "Resilience Fixture",
          GIT_COMMITTER_EMAIL: "resilience-fixture@example.test",
        };
        const git = (args) =>
          execFileSync("git", args, { cwd: dir, encoding: "utf8", env });
        git(["init", "--quiet"]);
        return { dir, git };
      }
      const interrupted = () => [
        user(),
        assistantCalls([["c1", "edit", { path: "fixture.txt" }]]),
        toolResult("c1"),
        message("assistant", {
          stopReason: "error",
          errorMessage: "503",
          content: [],
        }),
      ];

      const { dir: repo, git } = gitFixture("pi-resilience-notice-");
      try {
        writeFileSync(path.join(repo, "fixture.txt"), "base\n");
        git(["add", "-A"]);
        git([
          "-c",
          "user.email=a@b.c",
          "-c",
          "user.name=x",
          "commit",
          "-q",
          "-m",
          "base",
        ]);
        writeFileSync(path.join(repo, "fixture.txt"), "changed\n");
        const harness = createHarness({ entries: interrupted() });
        resilience.default(harness.api);
        const ctx = harness.makeContext({ cwd: repo });
        await harness.runHooks("session_start", {}, ctx);
        const results = await harness.runHooks("before_agent_start", {}, ctx);
        const injected = results.at(-1)?.message;
        eq(
          injected?.customType,
          "pi-resilience-recovery",
          "the next run gets a hidden message",
        );
        eq(
          injected?.display,
          false,
          "the message is hidden from the transcript",
        );
        assert(
          /edit: fixture\.txt — Ergebnis: ok/.test(injected.content),
          "it lists the mutating call",
        );
        assert(
          /M fixture\.txt/.test(injected.content),
          "it carries git status --short",
        );
        assert(
          !/diff --stat/.test(injected.content),
          "it no longer depends on git diff --stat",
        );
        const notice = harness.appended.find(
          (entry) => entry.customType === "resilience.interruption-notice",
        );
        eq(
          notice?.data.reason,
          "error",
          "the notice is counted for /session-health",
        );
        eq(notice?.data.mutatingCalls, 1, "the marker counts mutating calls");
        eq(
          notice?.data.unconfirmedCalls,
          0,
          "the marker counts unconfirmed calls",
        );
        assert(
          harness.appended.some(
            (entry) => entry.customType === "resilience.turn-start",
          ),
          "the turn start marker is still written",
        );
        eq(
          harness.appended.some(
            (entry) => "workspaceFingerprint" in (entry.data ?? {}),
          ),
          false,
          "no workspace snapshot is taken per turn anymore",
        );

        // Ein bereits gemeldeter Abbruch bleibt still.
        const reported = interrupted();
        const again = createHarness({
          entries: [
            ...reported,
            {
              type: "custom",
              customType: "resilience.interruption-notice",
              data: { entryId: reported.at(-1).id },
            },
          ],
        });
        resilience.default(again.api);
        const againCtx = again.makeContext({ cwd: repo });
        const quiet = await again.runHooks("before_agent_start", {}, againCtx);
        eq(
          quiet.at(-1)?.message,
          undefined,
          "an already reported interruption stays quiet",
        );
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }

      // Ohne Git: der Hinweis nennt es offen, statt zu sperren.
      const plain = mkdtempSync(path.join(tmpdir(), "pi-resilience-nogit-"));
      try {
        const noGit = createHarness({ entries: interrupted() });
        resilience.default(noGit.api);
        const noGitCtx = noGit.makeContext({ cwd: plain });
        const results = await noGit.runHooks(
          "before_agent_start",
          {},
          noGitCtx,
        );
        const content = results.at(-1)?.message?.content ?? "";
        assert(
          /Zustand nicht prüfbar/.test(content),
          "a missing Git repository is reported as not checkable",
        );
        assert(
          /edit: fixture\.txt/.test(content),
          "the call list still reaches the model",
        );
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }

      // Viele geänderte Dateien bleiben begrenzt (frühere ENOBUFS-Klasse).
      const { dir: bigRepo, git: bigGit } = gitFixture("pi-resilience-many-");
      try {
        mkdirSync(path.join(bigRepo, "d"), { recursive: true });
        for (let index = 0; index < 4000; index += 1) {
          writeFileSync(
            path.join(bigRepo, "d", `file-${index}-${"n".repeat(40)}.txt`),
            "x\n",
          );
        }
        void bigGit;
        const bigHarness = createHarness({ entries: interrupted() });
        resilience.default(bigHarness.api);
        const bigCtx = bigHarness.makeContext({ cwd: bigRepo });
        const results = await bigHarness.runHooks(
          "before_agent_start",
          {},
          bigCtx,
        );
        const content = results.at(-1)?.message?.content ?? "";
        assert(
          content.length < 120_000,
          "a huge untracked tree does not blow up the notice",
        );
        assert(
          /\?\? d\//.test(content),
          "the notice still shows the beginning of the status",
        );
      } finally {
        rmSync(bigRepo, { recursive: true, force: true });
      }

      // Alte Sitzungen mit einem offenen Gate des früheren Recovery-Modells
      // sperren nichts mehr: weder Schreibwerkzeuge noch Shell.
      if (modePermissions) {
        const legacy = createHarness({
          entries: [
            ...interrupted(),
            {
              type: "custom",
              customType: "resilience.recovery-required",
              data: {
                schemaVersion: 2,
                timestamp: "2026-10-01T10:00:00.000Z",
                turnStartedAt: "2026-10-01T09:59:00.000Z",
                reason: "final_failure",
                workspaceChangedSinceTurnStart: true,
                toolMayHaveMutatedWorkspace: true,
              },
            },
          ],
        });
        modePermissions.default(legacy.api);
        resilience.default(legacy.api);
        const legacyCtx = legacy.makeContext({ cwd: ROOT });
        await legacy.runHooks("session_start", {}, legacyCtx);
        for (const call of [
          { toolName: "write", input: { path: "legacy-ok.txt", content: "x" } },
          { toolName: "bash", input: { command: "touch legacy-ok.txt" } },
        ]) {
          const blocked = await legacy.runHooks("tool_call", call, legacyCtx);
          assert(
            blocked.every((result) => !result?.block),
            `an unchecked legacy gate no longer blocks ${call.toolName}`,
          );
        }
      }

      // Eine Sitzung, die währenddessen wechselt, bekommt keinen Hinweis des alten Laufs.
      const raceHarness = createHarness({ entries: interrupted() });
      resilience.default(raceHarness.api);
      const raceCtx = raceHarness.makeContext({ cwd: ROOT });
      const racing = raceHarness.runHooks("before_agent_start", {}, raceCtx);
      await raceHarness.runHooks("session_shutdown", {}, raceCtx);
      const raced = await racing;
      eq(
        raced.at(-1)?.message,
        undefined,
        "a notice is dropped when the session ended meanwhile",
      );
      eq(
        raceHarness.appended.some(
          (entry) => entry.customType === "resilience.interruption-notice",
        ),
        false,
        "no marker is written for a dropped notice",
      );
    });
  },

  "combined production extension stack": async (context) => {
    const {
      section,
      load,
      modePermissions,
      controlPlane,
      compactTools,
      interactivePty,
      askUser,
      lspExtensionMod,
      setupCore,
      auroraUi,
      resilience,
      sessionHealth,
      contextCapsule,
      openrouterDoctor,
    } = context;
    const frontendBridge = await load("extensions/frontend-bridge/index.ts");
    const taskTierExtension = await load("extensions/task-tier/index.ts");
    const systemContextExtension = await load(
      "extensions/system-context/index.ts",
    );
    const systemControlExtension = await load(
      "extensions/system-control/index.ts",
    );
    const skillSelect = await load("extensions/skill-select/index.ts");

    await section("combined production extension stack", async () => {
      if (
        !modePermissions ||
        !setupCore ||
        !askUser ||
        !lspExtensionMod ||
        !controlPlane ||
        !compactTools ||
        !interactivePty ||
        !auroraUi ||
        !resilience ||
        !sessionHealth ||
        !contextCapsule ||
        !systemContextExtension ||
        !systemControlExtension ||
        !openrouterDoctor
      )
        return;
      const factoryByExtension = {
        "+extensions/setup-core/index.ts": setupCore.default,
        "+extensions/mode-permissions.ts": modePermissions.default,
        "+extensions/interactive-pty/index.ts": interactivePty.default,
        "+extensions/lsp/index.ts": lspExtensionMod.default,
        "+extensions/ask-user.ts": askUser.default,
        "+extensions/control-plane.ts": controlPlane.default,
        "+extensions/skill-select/index.ts": skillSelect?.default,
        "+extensions/compact-tools/index.ts": compactTools.default,
        "+extensions/aurora-ui/index.ts": auroraUi.default,
        "+extensions/resilience/index.ts": resilience.default,
        "+extensions/context-capsule/index.ts": contextCapsule.default,
        "+extensions/system-context/index.ts": systemContextExtension.default,
        "+extensions/system-control/index.ts": systemControlExtension.default,
        "+extensions/session-health/index.ts": sessionHealth.default,
        "+extensions/frontend-bridge/index.ts": frontendBridge.default,
        "+extensions/openrouter-doctor/index.ts": openrouterDoctor.default,
        "+extensions/task-tier/index.ts": taskTierExtension.default,
      };
      const settings = JSON.parse(
        readFileSync(path.join(ROOT, "settings.json"), "utf8"),
      );
      const activeExtensions = settings.extensions.filter(
        (entry) =>
          typeof entry === "string" && entry.startsWith("+extensions/"),
      );
      const builtInExtensions = activeExtensions.filter((extension) =>
        Object.hasOwn(factoryByExtension, extension),
      );
      const additionalExtensions = activeExtensions.filter(
        (extension) => !Object.hasOwn(factoryByExtension, extension),
      );
      eq(
        builtInExtensions,
        Object.keys(factoryByExtension),
        "combined stack activates every supported local entry point",
      );
      for (const extension of additionalExtensions) {
        const module = await load(extension.slice(1));
        assert(
          typeof module?.default === "function",
          `additional local extension exports a factory: ${extension.slice(1)}`,
        );
      }
      const factories = builtInExtensions.map(
        (extension) => factoryByExtension[extension],
      );
      const harness = createHarness();
      for (const factory of factories) factory(harness.api);
      // A dedicated cwd keeps this test isolated from the repository's own
      // working state at ROOT.
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
          "audio_set_volume",
          "audio_status",
          "bash",
          "desktop_focus_window",
          "desktop_state",
          "desktop_switch_workspace",
          "find",
          "grep",
          "interactive_shell",
          "ls",
          "lsp_diagnostics",
          "nixos_apply",
          "nixos_build",
          "nixos_status",
          "notify",
          "project_check",
          "read",
          "system_job",
          "system_journal",
          "system_unit_status",
          "user_service",
          "verify",
          "workspace_add",
          "write",
        ],
        // The typed system tools are registered in every profile but stay
        // inactive in the project profile until a prompt asks for system work.
        "local functional tools plus compact-tools' renderShell overrides register locally",
      );
      eq(
        latestStatus(harness, "permissions"),
        "🛡 DEFAULT · PROJECT WRITE",
        "the workflow default is visible in the shared footer",
      );
      eq(
        latestStatus(harness, "workflow"),
        undefined,
        "combined stack publishes no workflow status",
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
        const contextForMode = nonTui.makeContext({ mode, hasUI: false, cwd });
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
        const blockedAsk = await nonTui.runHooks(
          "tool_call",
          { toolName: "ask_user", input: { question: "continue?" } },
          contextForMode,
        );
        assert(
          blockedAsk.some(
            (result) =>
              result?.block &&
              result?.terminate === undefined &&
              /nicht verfügbar/.test(result.reason) &&
              /lokale Alternative/.test(result.reason),
          ),
          "ask_user is capability-blocked before execution in " +
            mode +
            " mode",
        );
        const blockedBuilds = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          blockedBuilds.push(
            ...(await nonTui.runHooks(
              "tool_call",
              { toolName: "bash", input: { command: "sudo id" } },
              contextForMode,
            )),
          );
        }
        const blockedBuildDecisions = blockedBuilds.filter(
          (result) => result?.block,
        );
        assert(
          blockedBuildDecisions.length === 2 &&
            blockedBuildDecisions[0].terminate === undefined &&
            blockedBuildDecisions[1].terminate === true,
          "the soft-block budget ends non-interactive batches on the third block in " +
            mode +
            " mode",
        );
        const blockedProfile = await nonTui.runHooks(
          "tool_call",
          { toolName: "project_check", input: { profile: "verify" } },
          contextForMode,
        );
        assert(
          blockedProfile.some(
            (result) =>
              result?.block &&
              result?.terminate === true &&
              /Kein Projekt-Prüfprofil definiert/.test(result.reason),
          ),
          "missing project profiles are reported before execution in " +
            mode +
            " mode",
        );
        const tuiContext = nonTui.makeContext({
          mode: "tui",
          hasUI: true,
          cwd,
        });
        const tuiProfile = await nonTui.runHooks(
          "tool_call",
          { toolName: "project_check", input: { profile: "verify" } },
          tuiContext,
        );
        assert(
          tuiProfile.some(
            (result) =>
              result?.block &&
              result?.terminate === undefined &&
              /nicht über project_check verifiziert/.test(result.reason),
          ),
          "missing project profile blocks only the call in tui mode (" +
            mode +
            " run)",
        );
      }
    });
  },
};
