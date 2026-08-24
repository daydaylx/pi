import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness, latestStatus } from "../../shared/harness.mjs";

export const verificationSections = {
  "verification status layer": async (context) => {
    const { section, load, setupCore } = context;

    await section("verification status layer", async () => {
      const status = await load("extensions/setup-core/verification-status.ts");
      const cleanSnapshot = { changedFiles: [], fingerprint: "clean" };
      const changedSnapshot = {
        changedFiles: ["source.ts"],
        fingerprint: "changed",
      };
      const ROOT_A = "/workspace/a";
      const ROOT_B = "/workspace/b";

      const report = (
        profileId,
        classification,
        reportStatus,
        exitCode,
        killed,
      ) => ({
        profileId,
        classification,
        status: reportStatus,
        exitCode: exitCode ?? (reportStatus === "success" ? 0 : 1),
        killed: killed ?? false,
      });
      const record = (requiredOutcomes, extra) => ({
        lastRequiredCheck: {
          workspaceRoot: ROOT_A,
          workspaceFingerprint: "changed",
          requiredOutcomes,
          blockingRecommendedIds: [],
          completedAt: "2026-08-06T00:00:00.000Z",
          ...extra,
        },
      });
      const statusOf = (snapshot, ledger, declaredRequiredIds, workspaceRoot) =>
        status.verificationStatus(snapshot, ledger, {
          declaredRequiredIds,
          workspaceRoot: workspaceRoot ?? ROOT_A,
        });

      // -- verificationStatus ------------------------------------------------
      eq(
        statusOf(cleanSnapshot, {}, ["typecheck"]),
        "unchanged",
        "an unmodified workspace reports unchanged, never a passed check",
      );
      eq(
        statusOf(changedSnapshot, {}, ["typecheck"]),
        "changed_unverified",
        "a changed workspace without a required check is unverified",
      );
      eq(
        statusOf(changedSnapshot, {}, []),
        "checks_unavailable",
        "a project that declares no required profile can never be verified",
      );
      eq(
        statusOf(changedSnapshot, record({ typecheck: "success" }), [
          "typecheck",
        ]),
        "verified",
        "a successful required check for the current snapshot is verified",
      );
      // P0: partial coverage must never read as verified.
      eq(
        statusOf(changedSnapshot, record({ typecheck: "success" }), [
          "tests",
          "typecheck",
        ]),
        "changed_unverified",
        "a required profile that never ran leaves the snapshot unverified",
      );
      eq(
        statusOf(
          changedSnapshot,
          record({ typecheck: "success" }, { workspaceFingerprint: "older" }),
          ["typecheck"],
        ),
        "changed_unverified",
        "a workspace change makes a previous check stale",
      );
      // A check from another workspace must never verify this one.
      eq(
        statusOf(
          changedSnapshot,
          record({ typecheck: "success" }),
          ["typecheck"],
          ROOT_B,
        ),
        "changed_unverified",
        "a check recorded for another workspace root does not carry over",
      );
      eq(
        statusOf(changedSnapshot, record({ typecheck: "failed" }), [
          "typecheck",
        ]),
        "checks_failed",
        "a failed required check is reported as failed",
      );
      eq(
        statusOf(changedSnapshot, record({ typecheck: "unavailable" }), [
          "typecheck",
        ]),
        "checks_unavailable",
        "a required check without a verdict is unavailable, not failed",
      );
      // A check that ran and said no outranks one that never produced a verdict.
      eq(
        statusOf(
          changedSnapshot,
          record({ tests: "failed", typecheck: "unavailable" }),
          ["tests", "typecheck"],
        ),
        "checks_failed",
        "a real required failure outranks a concurrent unavailable check",
      );
      // P0: a blocking recommended failure must not coexist with `verified`.
      eq(
        statusOf(
          changedSnapshot,
          record(
            { typecheck: "success" },
            { blockingRecommendedIds: ["lint"] },
          ),
          ["typecheck"],
        ),
        "checks_failed",
        "a blocking recommended failure cannot coexist with a verified status",
      );
      eq(
        statusOf(undefined, {}, ["typecheck"]),
        "checks_unavailable",
        "a workspace without a snapshot is unavailable",
      );

      // -- evaluateCheckRun --------------------------------------------------
      const requiredPass = status.evaluateCheckRun(
        [report("typecheck", "required", "success")],
        ["typecheck"],
      );
      eq(
        requiredPass.requiredOutcomes.typecheck,
        "success",
        "a passing required run succeeds",
      );
      eq(requiredPass.blocking, false, "a passing required run does not block");
      eq(
        requiredPass.missingRequiredIds.length,
        0,
        "a full run leaves nothing open",
      );

      const requiredPartial = status.evaluateCheckRun(
        [report("typecheck", "required", "success")],
        ["tests", "typecheck"],
      );
      eq(
        requiredPartial.missingRequiredIds.join(","),
        "tests",
        "an unrun required profile is reported as missing coverage",
      );
      eq(
        requiredPartial.blocking,
        false,
        "incomplete coverage is not itself a tool error",
      );

      const requiredFail = status.evaluateCheckRun(
        [report("typecheck", "required", "spawn_failed", 1)],
        ["typecheck"],
      );
      eq(
        requiredFail.requiredOutcomes.typecheck,
        "failed",
        "a required command failure fails",
      );
      eq(
        requiredFail.blocking,
        true,
        "a required failure blocks the tool call",
      );

      const requiredTimeout = status.evaluateCheckRun(
        [report("typecheck", "required", "timeout", null, true)],
        ["typecheck"],
      );
      eq(
        requiredTimeout.requiredOutcomes.typecheck,
        "unavailable",
        "a timeout is an unavailable check, not a failure",
      );
      eq(
        requiredTimeout.blocking,
        true,
        "a required non-execution still blocks",
      );

      const recommendedFail = status.evaluateCheckRun(
        [
          report("typecheck", "required", "success"),
          report("lint", "recommended", "spawn_failed", 1),
        ],
        ["typecheck"],
      );
      eq(
        recommendedFail.blockingRecommendedIds.join(","),
        "lint",
        "a confirmed recommended failure is recorded",
      );
      eq(
        recommendedFail.blocking,
        true,
        "a confirmed recommended failure blocks",
      );

      const recommendedMissing = status.evaluateCheckRun(
        [report("lint", "recommended", "missing_binary", null)],
        [],
      );
      eq(
        recommendedMissing.blockingRecommendedIds.length,
        0,
        "a missing recommended binary stays a residual risk",
      );
      eq(
        recommendedMissing.blocking,
        false,
        "a missing recommended binary does not block",
      );
      eq(
        recommendedMissing.clearedRecommendedIds.length,
        0,
        "a missing recommended binary clears nothing — only a success may",
      );

      const advisoryFail = status.evaluateCheckRun(
        [
          report("typecheck", "required", "success"),
          report("audit", "advisory", "spawn_failed", 1),
        ],
        ["typecheck"],
      );
      eq(advisoryFail.blocking, false, "an advisory finding never blocks");
      eq(
        Object.keys(advisoryFail.requiredOutcomes).join(","),
        "typecheck",
        "an advisory report never contributes to required coverage",
      );

      const undeclared = status.evaluateCheckRun(
        [report("legacy", "required", "success")],
        ["typecheck"],
      );
      eq(
        Object.keys(undeclared.requiredOutcomes).length,
        0,
        "a required profile the project no longer declares contributes no coverage",
      );

      // -- mergeCheckRun -----------------------------------------------------
      const firstRun = status.mergeCheckRun(
        {},
        status.evaluateCheckRun(
          [report("typecheck", "required", "success")],
          ["tests", "typecheck"],
        ),
        ROOT_A,
        "changed",
      );
      eq(
        statusOf(changedSnapshot, firstRun, ["tests", "typecheck"]),
        "changed_unverified",
        "one of two required profiles is not enough to verify",
      );
      const secondRun = status.mergeCheckRun(
        firstRun,
        status.evaluateCheckRun(
          [report("tests", "required", "success")],
          ["tests", "typecheck"],
        ),
        ROOT_A,
        "changed",
      );
      eq(
        statusOf(changedSnapshot, secondRun, ["tests", "typecheck"]),
        "verified",
        "coverage accumulates across runs of one identical snapshot",
      );
      const afterEdit = status.mergeCheckRun(
        secondRun,
        status.evaluateCheckRun(
          [report("tests", "required", "success")],
          ["tests", "typecheck"],
        ),
        ROOT_A,
        "edited",
      );
      eq(
        Object.keys(afterEdit.lastRequiredCheck.requiredOutcomes).join(","),
        "tests",
        "a changed fingerprint discards previously accumulated coverage",
      );
      const otherRoot = status.mergeCheckRun(
        secondRun,
        status.evaluateCheckRun(
          [report("tests", "required", "success")],
          ["tests", "typecheck"],
        ),
        ROOT_B,
        "changed",
      );
      eq(
        Object.keys(otherRoot.lastRequiredCheck.requiredOutcomes).join(","),
        "tests",
        "a different workspace root discards previously accumulated coverage",
      );
      const blocked = status.mergeCheckRun(
        secondRun,
        status.evaluateCheckRun(
          [report("lint", "recommended", "spawn_failed", 1)],
          ["tests", "typecheck"],
        ),
        ROOT_A,
        "changed",
      );
      eq(
        statusOf(changedSnapshot, blocked, ["tests", "typecheck"]),
        "checks_failed",
        "a later recommended failure revokes an already verified snapshot",
      );
      const unblocked = status.mergeCheckRun(
        blocked,
        status.evaluateCheckRun(
          [report("lint", "recommended", "success")],
          ["tests", "typecheck"],
        ),
        ROOT_A,
        "changed",
      );
      eq(
        statusOf(changedSnapshot, unblocked, ["tests", "typecheck"]),
        "verified",
        "re-running the recommended profile successfully clears its block",
      );
      // A vanished binary must not launder a failure the same snapshot already
      // confirmed: only a successful re-run may clear a block.
      const vanished = status.mergeCheckRun(
        blocked,
        status.evaluateCheckRun(
          [report("lint", "recommended", "missing_binary", null)],
          ["tests", "typecheck"],
        ),
        ROOT_A,
        "changed",
      );
      eq(
        statusOf(changedSnapshot, vanished, ["tests", "typecheck"]),
        "checks_failed",
        "a missing binary does not erase an already confirmed recommended failure",
      );
      eq(
        vanished.lastRequiredCheck.blockingRecommendedIds.join(","),
        "lint",
        "the confirmed recommended failure survives a later missing_binary run",
      );

      // A project with no required profile still cannot be verified, but a
      // confirmed failure must not be hidden behind `checks_unavailable`.
      const recommendedOnly = status.mergeCheckRun(
        {},
        status.evaluateCheckRun(
          [report("lint", "recommended", "spawn_failed", 1)],
          [],
        ),
        ROOT_A,
        "changed",
      );
      eq(
        statusOf(changedSnapshot, recommendedOnly, []),
        "checks_failed",
        "a confirmed recommended failure stays visible without any required profile",
      );
      eq(
        statusOf(changedSnapshot, {}, []),
        "checks_unavailable",
        "a project without required profiles and without a failure is unavailable",
      );

      // -- requiredCoverage --------------------------------------------------
      const coverage = status.requiredCoverage(firstRun.lastRequiredCheck, [
        "tests",
        "typecheck",
      ]);
      eq(
        coverage.covered.join(","),
        "typecheck",
        "coverage lists what actually passed",
      );
      eq(
        coverage.missing.join(","),
        "tests",
        "coverage lists what is still open",
      );
      eq(coverage.total, 2, "coverage counts every declared required profile");
      eq(
        status.requiredCoverage(undefined, ["tests"]).missing.join(","),
        "tests",
        "an absent record covers nothing",
      );

      if (!setupCore) return;
      const auroraStateMod = await load("extensions/aurora-ui/state.ts");
      const workspace = mkdtempSync(
        path.join(tmpdir(), "pi-verification-status-"),
      );
      const git = (args) =>
        execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
      try {
        git(["init", "--quiet"]);
        git(["config", "user.email", "verification@example.test"]);
        git(["config", "user.name", "Verification Test"]);
        mkdirSync(path.join(workspace, ".pi"), { recursive: true });
        writeFileSync(
          path.join(workspace, ".pi", "verify.json"),
          JSON.stringify({
            profiles: {
              typecheck: {
                program: "npm",
                args: ["run", "typecheck"],
                classification: "required",
              },
              tests: {
                program: "npm",
                args: ["test"],
                classification: "required",
              },
              lint: {
                program: "npm",
                args: ["run", "lint"],
                classification: "recommended",
              },
            },
          }),
        );
        writeFileSync(
          path.join(workspace, "source.ts"),
          "export const value = 1;\n",
        );
        git(["add", "."]);
        git(["commit", "--quiet", "-m", "baseline"]);

        // `lint` fails with a real exit code, or its binary disappears; the
        // required profiles pass.
        let lintFails = false;
        let lintMissing = false;
        const harness = createHarness({
          exec: (_program, args) => {
            if (args.includes("lint")) {
              if (lintMissing) {
                throw new Error("spawn npm ENOENT");
              }
              if (lintFails)
                return {
                  stdout: "",
                  stderr: "lint error",
                  code: 1,
                  killed: false,
                };
            }
            return { stdout: "ok", stderr: "", code: 0, killed: false };
          },
        });
        setupCore.default(harness.api, { exec: harness.api.exec });
        const trusted = harness.makeContext({ cwd: workspace, trusted: true });
        await harness.runHooks("session_start", {}, trusted);

        // setup-core participates in the Aurora UI state bus: it answers a
        // state request with its current (still empty) verification summary
        // and, from then on, republishes it as a patch whenever it changes.
        if (auroraStateMod) {
          harness.api.events.emit(auroraStateMod.AURORA_UI_CHANNELS.request, {
            type: "request",
            requestId: "aurora-req-1",
            sessionEpoch: "aurora-epoch-1",
            requester: "aurora-ui",
          });
          const initialSnapshot = harness.emitted.find(
            (e) =>
              e.name === auroraStateMod.AURORA_UI_CHANNELS.snapshot &&
              e.event.source === "setup-core",
          );
          assert(
            initialSnapshot,
            "setup-core answers an Aurora state request with a snapshot",
          );
          eq(
            initialSnapshot.event.state.verification,
            null,
            "setup-core has nothing to report before the first agent_settled",
          );
        }

        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          latestStatus(harness, "verification"),
          "Verify: unchanged",
          "agent_settled publishes the unchanged workspace state, not a verdict",
        );

        writeFileSync(
          path.join(workspace, "source.ts"),
          "export const value = 2;\n",
        );
        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          latestStatus(harness, "verification"),
          "Verify: changed_unverified",
          "agent_settled reports a changed workspace without a current check",
        );
        const beforeDuplicateSettle = harness.statusCalls.length;
        const beforeDuplicateAuroraPatches = auroraStateMod
          ? harness.emitted.filter(
              (e) =>
                e.name === auroraStateMod.AURORA_UI_CHANNELS.patch &&
                e.event.source === "setup-core",
            ).length
          : 0;
        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          harness.statusCalls.length,
          beforeDuplicateSettle,
          "identical settled statuses are deduplicated",
        );
        if (auroraStateMod) {
          eq(
            harness.emitted.filter(
              (e) =>
                e.name === auroraStateMod.AURORA_UI_CHANNELS.patch &&
                e.event.source === "setup-core",
            ).length,
            beforeDuplicateAuroraPatches + 1,
            "an identical status still republishes Aurora verification evidence",
          );
        }

        const projectCheck = harness.tools.get("project_check");
        assert(
          projectCheck,
          "project_check is available for a required profile",
        );
        const runCheck = (id, params) =>
          projectCheck.execute(id, params, undefined, undefined, trusted);

        // P0 regression: one of two required profiles must not verify.
        const partial = await runCheck("verification-status-partial", {
          profile: "typecheck",
        });
        assert(!partial.isError, "incomplete coverage is not a tool error");
        eq(
          partial.details.verification.missingRequiredIds.join(","),
          "tests",
          "project_check names the required profile that is still open",
        );
        assert(
          partial.content[0].text.includes(
            "Pflichtabdeckung: 1/2 — offen: tests",
          ),
          "project_check reports accumulated required coverage in its output",
        );
        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          latestStatus(harness, "verification"),
          "Verify: changed_unverified",
          "a partially covered snapshot is never verified",
        );

        const complete = await runCheck("verification-status-complete", {
          profile: "tests",
        });
        assert(
          complete.content[0].text.includes("Pflichtabdeckung: 2/2"),
          "project_check reports full coverage once every required profile passed",
        );
        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          latestStatus(harness, "verification"),
          "Verify: verified",
          "coverage accumulated over two calls verifies the identical snapshot",
        );
        if (auroraStateMod) {
          const verifiedPatch = [...harness.emitted]
            .reverse()
            .find(
              (e) =>
                e.name === auroraStateMod.AURORA_UI_CHANNELS.patch &&
                e.event.source === "setup-core",
            );
          assert(
            verifiedPatch,
            "setup-core publishes a verification patch on the Aurora bus",
          );
          eq(
            verifiedPatch.event.patch.verification.status,
            "verified",
            "the published patch carries the same verdict as the status line",
          );
          eq(
            [...verifiedPatch.event.patch.verification.declaredRequiredIds]
              .sort()
              .join(","),
            "tests,typecheck",
            "the published patch names every declared required profile",
          );
          eq(
            verifiedPatch.event.patch.verification.requiredOutcomes.tests,
            "success",
            "the published patch carries the real per-profile outcome, not just the coarse verdict",
          );
        }

        // P0 regression: a blocking recommended failure and `verified` must
        // never describe the same run.
        lintFails = true;
        try {
          await runCheck("verification-status-recommended", {
            profile: "lint",
          });
          assert(false, "a confirmed recommended failure is a tool error");
        } catch (error) {
          assert(
            error instanceof Error,
            "a confirmed recommended failure throws a tool error",
          );
        }
        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          latestStatus(harness, "verification"),
          "Verify: checks_failed",
          "a blocking recommended failure revokes the verified status",
        );

        // P0 regression: losing the binary must not launder the failure the
        // same snapshot already confirmed.
        lintFails = false;
        lintMissing = true;
        const vanishedBinary = await runCheck("verification-status-vanished", {
          profile: "lint",
        });
        assert(
          !vanishedBinary.isError,
          "a missing recommended binary is a residual risk, not a tool error",
        );
        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          latestStatus(harness, "verification"),
          "Verify: checks_failed",
          "a vanished recommended binary does not restore a verified status",
        );
        lintMissing = false;

        // Only a successful re-run clears the block.
        await runCheck("verification-status-lint-recovered", {
          profile: "lint",
        });
        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          latestStatus(harness, "verification"),
          "Verify: verified",
          "a successful recommended re-run restores the verified status",
        );

        writeFileSync(
          path.join(workspace, "source.ts"),
          "export const value = 3;\n",
        );
        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          latestStatus(harness, "verification"),
          "Verify: changed_unverified",
          "the status becomes stale after a later workspace change",
        );
        writeFileSync(
          path.join(workspace, ".pi", "setup.json"),
          JSON.stringify({ verificationStatus: { enabled: false } }),
        );
        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          latestStatus(harness, "verification"),
          undefined,
          "the configured status layer can be disabled without running a check",
        );
        await harness.runHooks("session_shutdown", {}, trusted);
        eq(
          latestStatus(harness, "verification"),
          undefined,
          "session shutdown removes the transient verification status",
        );
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  },

  "project verification profiles (#105)": async (context) => {
    const { section, load } = context;

    await section("project verification profiles (#105)", async () => {
      const profilesMod = await load(
        "extensions/setup-core/verify-profiles.ts",
      );
      assert(
        typeof profilesMod?.loadVerifyProfiles === "function",
        "verify-profiles exports loadVerifyProfiles",
      );
      assert(
        typeof profilesMod?.runProfile === "function",
        "verify-profiles exports runProfile",
      );
      assert(
        typeof profilesMod?.resolveProfileCwd === "function",
        "verify-profiles exports resolveProfileCwd",
      );

      const workspace = mkdtempSync(path.join(tmpdir(), "pi-verify-profiles-"));
      const cfgDir = path.join(workspace, ".pi");
      mkdirSync(cfgDir, { recursive: true });
      const cfgPath = path.join(cfgDir, "verify.json");

      function writeConfig(obj) {
        writeFileSync(cfgPath, JSON.stringify(obj));
      }
      function clearConfig() {
        try {
          rmSync(cfgPath, { force: true });
        } catch {
          /* ignore */
        }
      }

      // --- Trust gate: untrusted ignores .pi/verify.json ---
      writeConfig({
        profiles: {
          tests: {
            program: "pytest",
            args: ["-q"],
            timeoutMs: 30000,
          },
        },
      });
      const untrusted = profilesMod.loadVerifyProfiles(workspace, false);
      eq(
        Object.keys(untrusted.profiles).length,
        0,
        "untrusted project loads no verification profiles",
      );
      eq(
        untrusted.diagnostics.some(
          (d) => d.level === "warning" && d.message.includes("trusted"),
        ),
        true,
        "untrusted project gets a clear 'ignored until trusted' diagnostic",
      );

      // --- Trust gate: trusted loads valid profiles ---
      const trusted = profilesMod.loadVerifyProfiles(workspace, true);
      eq(
        Object.keys(trusted.profiles),
        ["tests"],
        "trusted project loads the declared profile",
      );
      eq(trusted.profiles.tests.program, "pytest", "program preserved");
      eq(trusted.profiles.tests.args, ["-q"], "args preserved as array");
      eq(trusted.profiles.tests.required, true, "required defaults to true");
      eq(
        trusted.profiles.tests.trustRequired,
        true,
        "trustRequired defaults to true",
      );
      eq(trusted.profiles.tests.cwd, ".", "cwd defaults to '.'");

      // --- Missing file yields no profiles and no diagnostics ---
      clearConfig();
      const missing = profilesMod.loadVerifyProfiles(workspace, true);
      eq(
        Object.keys(missing.profiles).length,
        0,
        "missing file -> no profiles",
      );
      eq(missing.diagnostics.length, 0, "missing file -> no diagnostics");

      // --- Schema: unknown top-level key is rejected ---
      writeConfig({
        unexpected: 1,
        profiles: { tests: { program: "pytest", args: [] } },
      });
      let res = profilesMod.loadVerifyProfiles(workspace, true);
      eq(
        res.diagnostics.some((d) =>
          d.message.includes("unbekannter Schlüssel 'unexpected'"),
        ),
        true,
        "unknown top-level key is reported",
      );
      eq(Object.keys(res.profiles), ["tests"], "valid profile still loads");

      // --- Schema: unknown profile key drops the profile (fail-closed) ---
      writeConfig({
        profiles: {
          bad: { program: "x", args: [], oops: true },
          good: { program: "y", args: ["--fast"] },
        },
      });
      res = profilesMod.loadVerifyProfiles(workspace, true);
      eq(
        Object.keys(res.profiles),
        ["good"],
        "profile with unknown key is dropped",
      );
      eq(
        res.diagnostics.some(
          (d) =>
            d.message.includes("profiles.bad") && d.message.includes("oops"),
        ),
        true,
        "unknown profile key is reported with path",
      );

      // --- Schema: invalid program / args / timeoutMs / env ---
      writeConfig({
        profiles: {
          noProgram: { args: [] },
          emptyProgram: { program: "   ", args: [] },
          badArgs: { program: "x", args: "not-array" },
          nonStringArg: { program: "x", args: [1] },
          hugeTimeout: { program: "x", args: [], timeoutMs: 9_000_000 },
          badEnv: { program: "x", args: [], env: { K: 1 } },
        },
      });
      res = profilesMod.loadVerifyProfiles(workspace, true);
      eq(
        Object.keys(res.profiles),
        [],
        "every schema violation drops its profile (fail-closed)",
      );
      const msgs = res.diagnostics.map((d) => d.message).join("\n");
      for (const needle of [
        "noProgram.program",
        "badArgs.args",
        "nonStringArg.args",
        "hugeTimeout.timeoutMs",
        "badEnv.env",
      ]) {
        assert(msgs.includes(needle), "diagnostic names " + needle);
      }

      // --- resolveProfileCwd: relative ok, absolute/escape rejected ---
      const root = workspace;
      eq(
        profilesMod.resolveProfileCwd(root, "."),
        root,
        "'.' resolves to the project root",
      );
      eq(
        profilesMod.resolveProfileCwd(root, "sub/dir"),
        path.join(root, "sub", "dir"),
        "relative subdir resolves under the project root",
      );
      eq(
        profilesMod.resolveProfileCwd(root, "/etc"),
        null,
        "absolute cwd is rejected",
      );
      eq(
        profilesMod.resolveProfileCwd(root, "../escape"),
        null,
        "parent traversal is rejected",
      );
      const outsideWorkspace = mkdtempSync(
        path.join(tmpdir(), "pi-verify-outside-"),
      );
      symlinkSync(outsideWorkspace, path.join(workspace, "outside-link"));
      eq(
        profilesMod.resolveProfileCwd(root, "outside-link"),
        null,
        "existing cwd symlinks escaping the project are rejected",
      );

      // --- runProfile: program + args passed separately (no shell string) ---
      const seen = [];
      const recordingExec = async (program, args, options) => {
        seen.push({ program, args, options });
        return { code: 0, stdout: "ok", stderr: "", killed: false };
      };
      const profile = {
        program: "pytest",
        args: ["-q", "--maxfail=1"],
        cwd: ".",
        timeoutMs: 30_000,
        required: true,
        env: {},
        trustRequired: true,
      };
      const okRun = await profilesMod.runProfile(profile, {
        projectRoot: root,
        exec: recordingExec,
      });
      eq(okRun.ok, true, "exit 0 -> ok");
      eq(seen[0].program, "pytest", "exec receives the program name");
      eq(
        seen[0].args,
        ["-q", "--maxfail=1"],
        "exec receives args as a separate array (no shell string)",
      );
      eq(seen[0].options.cwd, root, "exec runs in the bounded project root");
      eq(typeof seen[0].options.env, "object", "exec receives an env object");
      eq(
        seen[0].options.env.PATH !== undefined,
        true,
        "profile env is additive on top of process.env (PATH inherited)",
      );

      // --- runProfile: non-zero exit -> not ok, structured error ---
      const failRun = await profilesMod.runProfile(profile, {
        projectRoot: root,
        exec: async () => ({
          code: 2,
          stdout: "",
          stderr: "boom",
          killed: false,
        }),
      });
      eq(failRun.ok, false, "non-zero exit -> not ok");
      eq(failRun.exitCode, 2, "exit code captured");
      eq(failRun.error.kind, "failed", "non-zero exit reported as failed");

      // --- runProfile: timeout -> killed, structured timeout error ---
      const timeoutRun = await profilesMod.runProfile(profile, {
        projectRoot: root,
        exec: async () => ({
          code: null,
          stdout: "",
          stderr: "",
          killed: true,
        }),
      });
      eq(timeoutRun.ok, false, "killed -> not ok");
      eq(timeoutRun.killed, true, "killed flag surfaced");
      eq(timeoutRun.error.kind, "timeout", "timeout reported as timeout");

      // --- runProfile: killed by an external abort signal, not the
      // profile's own timeoutMs -> distinct "aborted" classification,
      // not a misleading "Zeitlimit ... überschritten" message ---
      const abortedRun = await profilesMod.runProfile(profile, {
        projectRoot: root,
        exec: async () => ({
          code: null,
          stdout: "",
          stderr: "",
          killed: true,
          killReason: "abort-signal",
        }),
      });
      eq(abortedRun.ok, false, "aborted -> not ok");
      eq(abortedRun.killed, true, "killed flag surfaced");
      eq(
        abortedRun.error.kind,
        "aborted",
        "external abort reported as aborted, not timeout",
      );
      eq(
        abortedRun.error.message.includes(String(profile.timeoutMs)),
        false,
        "aborted message does not blame the profile's timeoutMs",
      );

      // --- runProfile: process exited via signal (code null) without the
      // killed flag set -> reported honestly, never masked as exit code 0 ---
      const signalExitRun = await profilesMod.runProfile(profile, {
        projectRoot: root,
        exec: async () => ({
          code: null,
          stdout: "",
          stderr: "",
          killed: false,
        }),
      });
      eq(signalExitRun.ok, false, "null exit code -> not ok");
      eq(
        signalExitRun.exitCode,
        null,
        "null exit code surfaced, not coerced to 0",
      );
      eq(
        signalExitRun.error.kind,
        "failed",
        "signal-terminated process reported as failed",
      );

      // --- runProfile: missing binary (ENOENT) -> missing_binary, no crash ---
      const missingRun = await profilesMod.runProfile(profile, {
        projectRoot: root,
        exec: async () => {
          throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
        },
      });
      eq(missingRun.ok, false, "missing binary -> not ok");
      eq(
        missingRun.error.kind,
        "missing_binary",
        "ENOENT classified as missing_binary",
      );

      // --- runProfile: cwd bounding honored at run time ---
      const escapeRun = await profilesMod.runProfile(
        { ...profile, cwd: "../escape" },
        {
          projectRoot: root,
          exec: async () => ({
            code: 0,
            stdout: "",
            stderr: "",
            killed: false,
          }),
        },
      );
      eq(escapeRun.ok, false, "escaping cwd is not executed");
      eq(
        escapeRun.error.kind,
        "spawn_failed",
        "escaping cwd reported as spawn_failed with a clear message",
      );
      eq(seen.length, 1, "escaping cwd prevented the exec call entirely");

      try {
        rmSync(workspace, { recursive: true, force: true });
        rmSync(outsideWorkspace, { recursive: true, force: true });
      } catch {
        /* ignore temp cleanup */
      }
    });
  },

  "project_check tool (#123)": async (context) => {
    const { section, setupCore } = context;

    await section("project_check tool (#123)", async () => {
      if (!setupCore) return;
      const workspace = mkdtempSync(path.join(tmpdir(), "pi-project-check-"));
      mkdirSync(path.join(workspace, ".pi"), { recursive: true });
      writeFileSync(
        path.join(workspace, ".pi", "verify.json"),
        JSON.stringify({
          profiles: {
            typecheck: {
              program: "npm",
              args: ["run", "typecheck", "--token=do-not-leak"],
              classification: "required",
            },
            lint: {
              program: "npm",
              args: ["run", "lint"],
              classification: "advisory",
            },
          },
        }),
      );
      const harness = createHarness();
      setupCore.default(harness.api, { exec: harness.api.exec });
      const trusted = harness.makeContext({ cwd: workspace, trusted: true });
      await harness.runHooks("session_start", {}, trusted);
      const tool = harness.tools.get("project_check");
      assert(Boolean(tool), "project_check is available in a trusted project");
      if (tool) {
        const result = await tool.execute(
          "project-check-ordered",
          { profiles: ["typecheck", "lint"] },
          undefined,
          undefined,
          trusted,
        );
        eq(
          harness.execCalls.slice(-2).map((call) => call.command),
          ["npm", "npm"],
          "project_check executes requested profiles in deterministic order",
        );
        eq(
          harness.execCalls.at(-2)?.options?.cwd,
          workspace,
          "project_check executes only at the bounded project cwd",
        );
        assert(
          !result.isError,
          "successful required and advisory profiles pass",
        );
        eq(
          result.details.profiles.map((profile) => profile.classification),
          ["required", "advisory"],
          "project_check returns each profile classification structurally",
        );
        assert(
          result.content[0].text.includes("--token=[redacted]") &&
            !result.content[0].text.includes("do-not-leak"),
          "project_check redacts credential-like command arguments",
        );
        try {
          await tool.execute(
            "project-check-unknown",
            { profile: "does-not-exist" },
            undefined,
            undefined,
            trusted,
          );
          assert(false, "project_check rejects unknown profile IDs");
        } catch (error) {
          assert(
            error instanceof Error &&
              error.message.includes("Verfügbar: lint, typecheck"),
            "unknown profile errors list available profile IDs",
          );
        }
        try {
          await tool.execute(
            "project-check-ambiguous",
            { profile: "lint", profiles: ["typecheck"] },
            undefined,
            undefined,
            trusted,
          );
          assert(
            false,
            "project_check rejects ambiguous single-plus-list calls",
          );
        } catch (error) {
          assert(
            error instanceof Error,
            "project_check throws on ambiguous single-plus-list calls",
          );
        }
      }
      const untrusted = harness.makeContext({ cwd: workspace, trusted: false });
      await harness.runHooks("session_start", {}, untrusted);
      if (tool) {
        try {
          await tool.execute(
            "project-check-untrusted",
            { profile: "typecheck" },
            undefined,
            undefined,
            untrusted,
          );
          assert(false, "project_check refuses untrusted project profiles");
        } catch (error) {
          assert(
            error instanceof Error &&
              error.message.includes("vertrauten Projekten"),
            "project_check explains the trust requirement",
          );
        }
      }
      rmSync(workspace, { recursive: true, force: true });

      // A large *passing* profile's output must never push a smaller
      // *failing* profile's diagnostics out of the truncated aggregate text
      // — the per-report text is truncated once individually and once again
      // in aggregate, and the second pass used to keep whatever happened to
      // sit at the head/tail regardless of which profile actually failed.
      const truncWorkspace = mkdtempSync(
        path.join(tmpdir(), "pi-project-check-truncation-"),
      );
      mkdirSync(path.join(truncWorkspace, ".pi"), { recursive: true });
      const truncNames = ["filler1", "beta", "filler2"];
      writeFileSync(
        path.join(truncWorkspace, ".pi", "verify.json"),
        JSON.stringify({
          profiles: Object.fromEntries(
            truncNames.map((name) => [
              name,
              {
                program: "npm",
                args: ["run", name],
                classification: "required",
              },
            ]),
          ),
        }),
      );
      const fillerBody = Array.from(
        { length: 100 },
        (_, i) => `line-${i}-${"f".repeat(300)}`,
      ).join("\n");
      const truncHarness = createHarness({
        exec: (_program, args) => {
          const name = args[1];
          if (name === "beta") {
            return {
              stdout: "MARKER-BETA-UNIQUE: real type error at line 42",
              stderr: "",
              code: 1,
              killed: false,
            };
          }
          return { stdout: fillerBody, stderr: "", code: 0, killed: false };
        },
      });
      setupCore.default(truncHarness.api, { exec: truncHarness.api.exec });
      const truncTrusted = truncHarness.makeContext({
        cwd: truncWorkspace,
        trusted: true,
      });
      await truncHarness.runHooks("session_start", {}, truncTrusted);
      const truncTool = truncHarness.tools.get("project_check");
      if (truncTool) {
        try {
          await truncTool.execute(
            "project-check-truncation-priority",
            { profiles: truncNames },
            undefined,
            undefined,
            truncTrusted,
          );
          assert(false, "the failing beta profile blocks the call");
        } catch (error) {
          assert(
            error instanceof Error &&
              error.message.includes("MARKER-BETA-UNIQUE"),
            "the failing profile's diagnostic survives aggregate truncation " +
              "even when surrounded by much larger passing profiles",
          );
        }
      }
      rmSync(truncWorkspace, { recursive: true, force: true });

      // Sorting alone is not enough once *multiple* profiles fail: a small
      // failing profile sandwiched between two large failing profiles is
      // just as exposed as one sandwiched between two large passing ones —
      // the balanced head/tail truncator can drop it (and even a large
      // neighbor) entirely. Each failing report needs its own reserved,
      // non-zero slice of the text so no failure is ever fully crowded out
      // by its siblings, no matter how many of them there are.
      const multiFailWorkspace = mkdtempSync(
        path.join(tmpdir(), "pi-project-check-multi-fail-"),
      );
      mkdirSync(path.join(multiFailWorkspace, ".pi"), { recursive: true });
      const multiFailNames = ["fail1", "beta", "fail3"];
      writeFileSync(
        path.join(multiFailWorkspace, ".pi", "verify.json"),
        JSON.stringify({
          profiles: Object.fromEntries(
            multiFailNames.map((name) => [
              name,
              {
                program: "npm",
                args: ["run", name],
                classification: "required",
              },
            ]),
          ),
        }),
      );
      const largeFailureBody = Array.from(
        { length: 150 },
        (_, i) => `line-${i}-${"e".repeat(200)}`,
      ).join("\n");
      const multiFailHarness = createHarness({
        exec: (_program, args) => {
          const name = args[1];
          const marker = `MARKER-${name.toUpperCase()}-UNIQUE`;
          if (name === "beta") {
            return {
              stdout: `${marker}: real type error at line 42`,
              stderr: "",
              code: 1,
              killed: false,
            };
          }
          return {
            stdout: `${marker}: first line\n${largeFailureBody}`,
            stderr: "",
            code: 1,
            killed: false,
          };
        },
      });
      setupCore.default(multiFailHarness.api, {
        exec: multiFailHarness.api.exec,
      });
      const multiFailTrusted = multiFailHarness.makeContext({
        cwd: multiFailWorkspace,
        trusted: true,
      });
      await multiFailHarness.runHooks("session_start", {}, multiFailTrusted);
      const multiFailTool = multiFailHarness.tools.get("project_check");
      if (multiFailTool) {
        try {
          await multiFailTool.execute(
            "project-check-multi-fail",
            { profiles: multiFailNames },
            undefined,
            undefined,
            multiFailTrusted,
          );
          assert(false, "three failing profiles block the call");
        } catch (error) {
          for (const name of multiFailNames) {
            const marker = `MARKER-${name.toUpperCase()}-UNIQUE`;
            assert(
              error instanceof Error && error.message.includes(marker),
              `${name}'s diagnostic survives even with two large failing ` +
                "profiles competing for the same truncation budget",
            );
          }
        }
      }
      rmSync(multiFailWorkspace, { recursive: true, force: true });
    });
  },
};
