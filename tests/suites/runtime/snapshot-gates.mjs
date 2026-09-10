// Phase-1 integration regressions at the real snapshot, event and tool boundaries.
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
import { collectWorkspaceSnapshot } from "../../../shared/workspace-snapshot.mjs";
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness, latestStatus } from "../../shared/harness.mjs";

export const snapshotGateSections = {
  "snapshot gate asynchronous regressions": async ({
    section,
    load,
    resilience,
    setupCore,
    verifierPolicy,
    trackedExec,
  }) => {
    await section("snapshot gate asynchronous regressions", async () => {
      const workspace = mkdtempSync(path.join(tmpdir(), "pi-snapshot-gates-"));
      const originalPath = process.env.PATH;
      const git = (args) =>
        execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
      try {
        git(["init", "--quiet", "--initial-branch=main"]);
        const empty = await collectWorkspaceSnapshot(workspace);
        assert(empty.ok, "an unborn repository has a valid snapshot");
        eq(
          empty.snapshot?.head,
          "unborn:refs/heads/main",
          "an unborn HEAD has an explicit branch identity",
        );
        writeFileSync(path.join(workspace, "initial.txt"), "initial\n");
        git(["add", "initial.txt"]);
        assert(
          (await collectWorkspaceSnapshot(workspace)).ok,
          "staged files before the first commit are snapshotable",
        );
        const assess = (coverage = {}) =>
          verifierPolicy.assessGitCommitVerifierGate(
            { toolName: "bash", input: { command: 'git commit -m "initial"' } },
            workspace,
            coverage,
          );
        assert(
          !(await assess()).blocked,
          "an ordinary first commit is not permanently blocked",
        );
        mkdirSync(path.join(workspace, "extensions", "permissions"), {
          recursive: true,
        });
        writeFileSync(
          path.join(workspace, "extensions", "permissions", "guards.ts"),
          "export {};\n",
        );
        git(["add", "."]);
        assert(
          (await assess()).blocked,
          "a first commit in a protected path still requires a verifier",
        );
        const initial = await collectWorkspaceSnapshot(workspace);
        assert(
          !(
            await assess({
              workspaceRoot: workspace,
              workspaceFingerprint: initial.snapshot.fingerprint,
              verifierStatus: "completed",
              verifierVerdict: "PASS",
            })
          ).blocked,
          "a matching verifier PASS can authorize a protected first commit",
        );
        git([
          "-c",
          "user.name=Snapshot Fixture",
          "-c",
          "user.email=snapshot@example.test",
          "commit",
          "--quiet",
          "-m",
          "initial",
        ]);

        // A staged content change can keep both name-status lists and all
        // worktree metadata identical. The index itself must be checked.
        const blob = (text) =>
          execFileSync("git", ["hash-object", "-w", "--stdin"], {
            cwd: workspace,
            input: text,
            encoding: "utf8",
          }).trim();
        const stagedA = blob("stage A\n");
        const stagedB = blob("stage B\n");
        git(["update-index", "--cacheinfo", `100644,${stagedA},initial.txt`]);
        let indexAttempts = 0;
        const indexRace = await collectWorkspaceSnapshot(workspace, {
          onAttemptState(attempt) {
            indexAttempts += 1;
            if (attempt === 1)
              git([
                "update-index",
                "--cacheinfo",
                `100644,${stagedB},initial.txt`,
              ]);
          },
        });
        assert(
          indexRace.ok && indexAttempts > 1,
          "a same-status index-only edit forces a fresh snapshot attempt",
        );
        eq(
          indexRace.snapshot?.fingerprint,
          (await collectWorkspaceSnapshot(workspace)).snapshot?.fingerprint,
          "an index race resolves to the actual final index/worktree pair",
        );

        const bridge = await load("extensions/shared/recovery-capabilities.ts");
        const query = (replies) =>
          bridge.requestRecoveryStatus({
            emit(_channel, request) {
              for (const reply of replies) request.respond(reply);
            },
          });
        eq(
          await query([]),
          { armed: false },
          "an absent recovery extension does not lock writes",
        );
        eq(
          await query([{}, Promise.resolve({ armed: true })]),
          { armed: true },
          "an invalid reply cannot shadow a valid recovery gate",
        );
        eq(
          await query([
            Promise.reject(new Error("provider failed")),
            { armed: true },
          ]),
          { armed: true },
          "a rejected reply cannot shadow the next provider",
        );
        eq(
          await query([Promise.resolve({ armed: false }), { armed: true }]),
          { armed: false },
          "the first valid reply retains registration-order precedence",
        );
        eq(
          await query([{}, Promise.reject(new Error("provider failed"))]),
          { armed: true },
          "only broken providers leave the recovery boundary closed",
        );

        const bounded = await trackedExec.trackedExec(
          process.execPath,
          [
            "-e",
            'process.stdout.write("x".repeat(400000)); process.stderr.write("y".repeat(400000));',
          ],
          { maxOutputBytes: 1024, timeout: 10000 },
        );
        eq(
          bounded.code,
          0,
          "bounded capture still drains both streams to completion",
        );
        eq(
          [
            bounded.stdout.length,
            bounded.stderr.length,
            bounded.stdoutTruncated,
            bounded.stderrTruncated,
          ],
          [1024, 1024, true, true],
          "both streams are capped during collection and truncation is reported",
        );

        // Each hook reaches a real snapshot await before the next lifecycle
        // event runs. No sleeps or mocked snapshot results are needed.
        for (const event of [
          "before_agent_start",
          "after_provider_response",
          "agent_settled",
          "session_before_compact",
          "session_compact_failed",
          "session_compact",
        ]) {
          const harness = createHarness();
          resilience.default(harness.api);
          const ctx = harness.makeContext({ cwd: workspace });
          await harness.runHooks("session_start", {}, ctx);
          if (event !== "before_agent_start")
            await harness.runHooks("before_agent_start", {}, ctx);
          if (event === "agent_settled") {
            await harness.runHooks(
              "tool_execution_start",
              { toolName: "edit" },
              ctx,
            );
            await harness.runHooks(
              "after_provider_response",
              { status: 503 },
              ctx,
            );
          }
          const count = harness.appended.length;
          const pending = harness.runHooks(
            event,
            {
              status: 503,
              reason: "manual",
              errorMessage: "failed",
              willRetry: false,
            },
            ctx,
          );
          await harness.runHooks("session_shutdown", {}, ctx);
          const next = harness.makeContext({
            cwd: workspace,
            sessionId: "next",
          });
          await harness.runHooks("session_start", {}, next);
          await pending;
          eq(
            harness.appended.length,
            count,
            `${event}: stale snapshot work appends no entries to the next session`,
          );
          eq(
            latestStatus(harness, "recovery"),
            undefined,
            `${event}: stale work cannot arm the next session's gate`,
          );
        }

        const recoveryHarness = createHarness();
        resilience.default(recoveryHarness.api);
        const ctx = recoveryHarness.makeContext({ cwd: workspace });
        await recoveryHarness.runHooks("session_start", {}, ctx);
        await recoveryHarness.runHooks("before_agent_start", {}, ctx);
        await recoveryHarness.runHooks(
          "tool_execution_start",
          { toolName: "edit" },
          ctx,
        );
        await recoveryHarness.runHooks(
          "after_provider_response",
          { status: 503 },
          ctx,
        );
        await recoveryHarness.runHooks("agent_settled", {}, ctx);
        const recovery = recoveryHarness.tools.get("recovery_check");
        const pendingCheck = recovery
          .execute("old-check", {}, undefined, undefined, ctx)
          .then(
            () => "released",
            (error) => error.message,
          );
        await recoveryHarness.runHooks("session_shutdown", {}, ctx);
        await recoveryHarness.runHooks("session_start", {}, ctx);
        assert(
          (await pendingCheck).includes("abgebrochen"),
          "an in-flight recovery check cannot release a gate after session replacement",
        );
        assert(
          !recoveryHarness.appended.some(
            (entry) => entry.customType === "resilience.recovery-checked",
          ),
          "no obsolete recovery proof is persisted",
        );

        const turns = createHarness();
        resilience.default(turns.api);
        const turnCtx = turns.makeContext({ cwd: workspace });
        await turns.runHooks("session_start", {}, turnCtx);
        await turns.runHooks("before_agent_start", {}, turnCtx);
        await turns.runHooks(
          "after_provider_response",
          { status: 503 },
          turnCtx,
        );
        const settling = turns.runHooks("agent_settled", {}, turnCtx);
        await turns.runHooks("before_agent_start", {}, turnCtx);
        await settling;
        await turns.runHooks("agent_settled", {}, turnCtx);
        const settled = turns.appended.filter(
          (entry) => entry.customType === "resilience.turn-settled",
        );
        eq(
          settled.length,
          1,
          "an obsolete settlement cannot clear the following turn in the same session",
        );
        eq(
          settled[0]?.data.outcome,
          "completed",
          "the following turn retains its own outcome",
        );

        const verifierHarness = createHarness();
        setupCore.default(verifierHarness.api, {
          exec: verifierHarness.api.exec,
        });
        const verifierCtx = verifierHarness.makeContext({ cwd: workspace });
        const capabilities = await load(
          "extensions/shared/verification-capabilities.ts",
        );
        const coverage = () =>
          capabilities.requestVerificationCapabilities(
            verifierHarness.api.events,
          );
        const runVerifier = (verdict) =>
          verifierHarness.runHooks(
            "tool_result",
            {
              toolName: "subagent",
              toolCallId: verdict,
              input: { agent: "verifier", task: "check" },
              content: [{ type: "text", text: verdict }],
              details: {
                results: [
                  { agent: "verifier", exitCode: 0, finalOutput: verdict },
                ],
              },
            },
            verifierCtx,
          );
        await verifierHarness.runHooks("session_start", {}, verifierCtx);
        await Promise.all([runVerifier("PASS"), runVerifier("FAIL")]);
        eq(
          coverage().verifierVerdict,
          "FAIL",
          "overlapping verifier results retain dispatch order",
        );
        const old = runVerifier("PASS");
        await Promise.resolve();
        await verifierHarness.runHooks("session_shutdown", {}, verifierCtx);
        await verifierHarness.runHooks("session_start", {}, verifierCtx);
        await Promise.all([old, runVerifier("FAIL")]);
        eq(
          coverage().verifierVerdict,
          "FAIL",
          "an old queued verifier result cannot repopulate the new session's ledger",
        );

        mkdirSync(path.join(workspace, ".pi"));
        writeFileSync(
          path.join(workspace, ".pi", "verify.json"),
          JSON.stringify({
            profiles: {
              probe: {
                program: "node",
                args: ["--version"],
                cwd: ".",
                timeoutMs: 10000,
                classification: "required",
              },
            },
          }),
        );
        let releaseCheck;
        let checkStarted;
        const entered = new Promise((resolve) => {
          checkStarted = resolve;
        });
        const checkHarness = createHarness();
        setupCore.default(checkHarness.api, {
          exec: () => {
            checkStarted();
            return new Promise((resolve) => {
              releaseCheck = resolve;
            });
          },
        });
        const checkCtx = checkHarness.makeContext({ cwd: workspace });
        await checkHarness.runHooks("session_start", {}, checkCtx);
        const checkResult = checkHarness.tools
          .get("project_check")
          .execute(
            "check",
            { profile: "probe" },
            undefined,
            undefined,
            checkCtx,
          )
          .then(
            () => "passed",
            (error) => error.message,
          );
        await entered;
        await checkHarness.runHooks("session_shutdown", {}, checkCtx);
        await checkHarness.runHooks("session_start", {}, checkCtx);
        releaseCheck({ stdout: "ok", stderr: "", code: 0, killed: false });
        assert(
          (await checkResult).includes("Sitzung"),
          "a profile finishing after session replacement cannot record a successful check",
        );

        if (process.platform !== "win32") {
          // Exercise actual Git subprocess failures, without replacing the
          // collector or its error contract. Wrapper artefacts live in .git.
          const realGit = execFileSync("sh", ["-c", "command -v git"], {
            encoding: "utf8",
          }).trim();
          const wrapperDir = path.join(workspace, ".git", "probe-bin");
          mkdirSync(wrapperDir);
          const attemptsFile = path.join(workspace, ".git", "probe-attempts");
          const installWrapper = (always) => {
            writeFileSync(attemptsFile, "");
            writeFileSync(
              path.join(wrapperDir, "git"),
              `#!${process.execPath}\n` +
                `const fs = require("node:fs"); const cp = require("node:child_process");\n` +
                `const args = process.argv.slice(2); const marker = ${JSON.stringify(attemptsFile)};\n` +
                `if (args.includes("--cached") && args.includes("--binary")) {\n` +
                `const count = fs.readFileSync(marker, "utf8").length; fs.appendFileSync(marker, "x");\n` +
                `if (${always} || count === 0) { process.stderr.write("transient fixture Git failure"); process.exit(128); } }\n` +
                `const r = cp.spawnSync(${JSON.stringify(realGit)}, args, {stdio:"inherit"}); process.exit(r.status ?? 1);\n`,
              { mode: 0o755 },
            );
          };
          const expected = await collectWorkspaceSnapshot(workspace);
          process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
          installWrapper(false);
          const retried = await collectWorkspaceSnapshot(workspace);
          eq(
            retried.snapshot?.fingerprint,
            expected.snapshot.fingerprint,
            "a transient patch-process failure retries the whole capture without changing its fingerprint",
          );
          eq(
            readFileSync(attemptsFile, "utf8").length,
            2,
            "one failed patch process uses exactly two attempts",
          );
          installWrapper(true);
          const exhausted = await collectWorkspaceSnapshot(workspace, {
            maxAttempts: 2,
          });
          eq(
            exhausted.error?.code,
            "git_command_failed",
            "persistent patch failure retains its typed cause",
          );
          eq(
            readFileSync(attemptsFile, "utf8").length,
            2,
            "persistent patch failures respect the finite retry budget",
          );
          const controller = new AbortController();
          let abortAttempts = 0;
          const aborted = await collectWorkspaceSnapshot(workspace, {
            signal: controller.signal,
            onAttemptState() {
              abortAttempts += 1;
              controller.abort();
            },
          });
          assert(
            !aborted.ok && abortAttempts === 1,
            "an explicit abort never consumes further retry attempts or produces a fingerprint",
          );
          process.env.PATH = originalPath;
        }
      } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  },
};
