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
import { assertNoGlobalChrome, createHarness } from "../../shared/harness.mjs";
import { ROOT } from "../../shared/jiti-loader.mjs";

export const setupCoreSections = {
  "greenfield setup config and Aurora state contract": async (context) => {
    const { section, setupConfig, auroraState } = context;

    await section(
      "greenfield setup config and Aurora state contract",
      async () => {
        if (!setupConfig || !auroraState) return;
        const defaults = setupConfig.defaultSetupConfig();
        eq(
          defaults.ui,
          { theme: "aurora-night", motion: "contextual" },
          "Aurora is the central UI default",
        );
        eq(
          defaults.permissions,
          { unknownTools: "ask", bash: "allow" },
          "capability defaults require confirmation",
        );
        eq(
          defaults.verificationStatus,
          { enabled: true },
          "verification status is enabled by default and can be configured",
        );
        assert(
          !Object.hasOwn(defaults, "models"),
          "native Pi scoped models replace setup roles",
        );

        const project = mkdtempSync(path.join(tmpdir(), "pi-setup-config-"));
        mkdirSync(path.join(project, ".pi"), { recursive: true });
        writeFileSync(
          path.join(project, ".pi", "setup.json"),
          JSON.stringify({
            ui: { motion: "reduced" },
            permissions: { unknownTools: "allow", bash: "allow" },
            lsp: { requestTimeoutMs: 5000 },
          }),
        );
        const trusted = setupConfig.loadSetupConfig(project, true);
        eq(
          trusted.config.ui.motion,
          "reduced",
          "trusted project may reduce motion",
        );
        eq(
          trusted.config.lsp.requestTimeoutMs,
          5000,
          "trusted project may tune LSP timeout",
        );
        eq(
          trusted.config.permissions,
          defaults.permissions,
          "project may not relax global permissions",
        );
        assert(
          trusted.diagnostics.some((entry) => entry.level === "warning"),
          "security relaxation produces a visible warning",
        );
        rmSync(project, { recursive: true, force: true });

        const state = {
          sessionEpoch: "epoch-1",
          workflow: { phase: "work", label: "Work" },
          permissions: {},
          lsp: {},
          model: {},
          activity: { kind: "idle" },
        };
        auroraState.mergeAuroraUiState(state, {
          workflow: {
            phase: "simple_plan",
            label: "Schnellplan",
          },
          lsp: { state: "ready" },
        });
        eq(state.workflow.phase, "simple_plan", "Aurora merges workflow modes");
        // Unknown legacy phases are ignored.
        auroraState.mergeAuroraUiState(state, {
          workflow: { phase: "executing" },
        });
        eq(
          state.workflow.phase,
          "simple_plan",
          "Aurora rejects the retired legacy phase name",
        );
        eq(
          state.workflow.label,
          "Schnellplan",
          "Aurora merges the workflow label",
        );
        eq(state.lsp.state, "ready", "Aurora merges LSP patches");
        eq(
          auroraState.mergeAuroraUiState(state, { lsp: { state: "ready" } }),
          false,
          "Aurora ignores a state patch that changes no presentation data",
        );
        assert(
          auroraState.isAuroraUiStateRequest({
            type: "request",
            requestId: "request-1",
            sessionEpoch: "epoch-1",
            requester: "test",
          }),
          "Aurora validates state requests",
        );
      },
    );
  },

  "setup core lifecycle": async (context) => {
    const { section, contextDiagnostics, setupCore, trackedExec } = context;

    await section("setup core lifecycle", async () => {
      if (!setupCore) return;
      // setup-core deliberately reads/executes from getAgentDir() (~/.pi/agent
      // by default, see @earendil-works/pi-coding-agent's config.js) rather
      // than the checkout cwd, so an active repository cannot replace its own
      // verify command or lifecycle hooks. This repo doubles as a real Pi
      // agent directory, so pointing PI_CODING_AGENT_DIR at ROOT for the
      // duration of this section reproduces that deployment instead of
      // assuming the checkout happens to sit at the tester's real ~/.pi/agent.
      const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = ROOT;
      try {
        const harness = createHarness();
        setupCore.default(harness.api, { exec: harness.api.exec });
        const context = harness.makeContext();
        await harness.runHooks("session_start", {}, context);
        assert(
          Boolean(harness.tools.get("verify")),
          "setup core registers the allowlisted verify tool",
        );
        assert(
          Boolean(harness.tools.get("project_check")),
          "setup core registers the trust-bound project_check tool (#123)",
        );
        // One canonical route for the full project verification. The verify
        // tool offers fast partial checks only; it does not update the
        // footer/ledger, so offering the same command under both tools made
        // an unverified workspace look checked.
        eq(
          harness.tools
            .get("verify")
            ?.parameters?.properties?.check?.anyOf?.map((entry) => entry.const),
          ["typecheck", "test"],
          "the verify tool no longer offers the full project verification",
        );
        eq(
          Object.keys(
            JSON.parse(readFileSync(path.join(ROOT, "setup.json"), "utf8"))
              .verification,
          ).sort(),
          ["test", "typecheck"],
          "setup.json declares no check that duplicates a project profile",
        );
        assert(
          Object.hasOwn(
            JSON.parse(
              readFileSync(path.join(ROOT, ".pi", "verify.json"), "utf8"),
            ).profiles,
            "verify",
          ),
          "the full verification stays available as the required project profile",
        );
        assert(
          !harness.commands.get("verify-gate"),
          "setup core no longer owns /verify-gate; it belongs to the completion domain",
        );
        const doctor = harness.commands.get("setup-doctor");
        assert(Boolean(doctor), "/setup-doctor is registered");
        if (doctor) await doctor("", context);
        assert(
          harness.notifications.at(-1)?.message?.startsWith("Setup Doctor"),
          "setup doctor reports effective configuration without mutation",
        );
        assert(
          harness.notifications
            .at(-1)
            ?.message?.includes("Pi CLI/dev package: 0.80.7/0.84.2") &&
            harness.notifications.at(-1)?.level === "error",
          "setup doctor makes CLI/dev version drift visible",
        );
        // This repo declares its own required profile in .pi/verify.json, so a
        // trusted session at ROOT must load it rather than report none.
        assert(
          harness.notifications
            .at(-1)
            ?.message?.includes(
              "project verification profiles: 1 Profil(e) geladen",
            ),
          "setup doctor reports the project verification profile status (#105)",
        );
        assert(
          !harness.notifications
            .at(-1)
            ?.message?.includes("keine Pflichtprüfung"),
          "this repo's own profile is a required check, so the doctor does not warn",
        );
        assert(
          harness.notifications
            .at(-1)
            ?.message?.includes(
              "subagent tool surface: schema=harness, description=custom",
            ) &&
            harness.notifications
              .at(-1)
              ?.message?.includes(
                "active subagent package config: reduced harness surface (single execution, list/status/stop/interrupt)",
              ),
          "setup doctor reports both tool-surface settings and the active surface",
        );
        assert(
          !harness.notifications
            .at(-1)
            ?.message?.includes("subagent baseline (setup.json)"),
          "setup doctor no longer reports a removed concurrency baseline",
        );
        assert(
          !harness.notifications
            .at(-1)
            ?.message?.includes("doom-loop status:") &&
            !harness.notifications.at(-1)?.message?.includes("edit metrics:"),
          "setup doctor omits removed automatic doom-loop and edit-metric workflows",
        );
        assert(
          !harness.notifications.at(-1)?.message?.includes("recovery status:"),
          "setup doctor leaves workflow recovery to the explicit v3 controller",
        );
        const contextHarness = createHarness({
          systemPrompt: "System 🙂",
          registeredTools: [
            {
              name: "zeta",
              parameters: {
                type: "object",
                properties: { b: { type: "number" }, a: { type: "string" } },
              },
            },
            {
              name: "alpha",
              parameters: { type: "object", required: ["value"] },
            },
          ],
          activeTools: ["zeta", "dynamic-tool"],
          contextUsage: { tokens: null, contextWindow: 272000, percent: null },
          entries: [
            {
              type: "message",
              message: {
                role: "assistant",
                usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
              },
            },
            {
              type: "compaction",
              timestamp: "2026-08-02T10:00:00.000Z",
              usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
            },
            {
              type: "custom",
              customType: "resilience.compaction-boundary",
              data: {
                timestamp: "2026-08-02T10:01:00.000Z",
                boundary: "failed",
                reason: "threshold",
                errorMessage: "summary provider failed",
              },
            },
            {
              type: "message",
              message: {
                role: "toolResult",
                details: {
                  truncation: {
                    truncated: true,
                    totalBytes: 200,
                    outputBytes: 80,
                  },
                },
              },
            },
          ],
        });
        setupCore.default(contextHarness.api, {
          exec: contextHarness.api.exec,
        });
        const contextCommand = contextHarness.commands.get("setup-doctor");
        const diagnosticContext = contextHarness.makeContext();
        if (contextCommand) await contextCommand("context", diagnosticContext);
        const contextReport =
          contextHarness.notifications.at(-1)?.message ?? "";
        assert(
          contextReport.includes("registered tools: 2 (alpha, zeta)") &&
            contextReport.includes("active tools: 2 (dynamic-tool, zeta)"),
          "context doctor reports sorted registered and dynamically active tools",
        );
        assert(
          contextReport.includes("Model: main-provider/main-model") &&
            contextReport.includes("Context Window: 272000") &&
            contextReport.includes("Active Context Tokens: n/a") &&
            contextReport.includes("Compaction Trigger: 222848") &&
            contextReport.includes("Reserve Tokens: 49152") &&
            contextReport.includes("Keep Recent Tokens: 20000") &&
            contextReport.includes("Compaction Enabled: true") &&
            contextReport.includes("Usage Source: pending fresh usage") &&
            contextReport.includes("effective system prompt: 11 bytes") &&
            /active tool schemas: \d+ bytes/.test(contextReport) &&
            contextReport.includes(
              "Lifetime Usage: input=11, output=22, cacheRead=33, cacheWrite=44",
            ) &&
            contextReport.includes(
              "Last Successful Compaction: 2026-08-02T10:00:00.000Z",
            ) &&
            contextReport.includes(
              "Last Compaction Attempt: 2026-08-02T10:01:00.000Z (failed, threshold: summary provider failed)",
            ) &&
            contextReport.includes(
              "persisted tool truncations: count=1, totalBytes=200, outputBytes=80",
            ),
          "context doctor separates active context from lifetime usage and shows compaction status",
        );
        if (contextCommand)
          await contextCommand("unexpected", diagnosticContext);
        eq(
          contextHarness.notifications.at(-1),
          { message: "Usage: /setup-doctor [context]", level: "error" },
          "context doctor rejects unknown arguments without running the default doctor",
        );
        eq(
          contextHarness.execCalls.length,
          0,
          "context doctor does not invoke runtime or model commands",
        );
        if (contextDiagnostics) {
          const empty = contextDiagnostics.collectContextDiagnostics({
            registeredTools: [],
            activeToolNames: [],
            sessionEntries: [],
          });
          eq(
            empty.schemaBytes,
            2,
            "empty context diagnostics have a deterministic empty schema size",
          );
          eq(
            empty.systemPromptBytes,
            null,
            "missing system prompt is reported as n/a",
          );
          eq(
            empty.lifetimeUsage,
            null,
            "missing persisted lifetime usage is reported as n/a",
          );
          eq(
            empty.toolTruncation,
            { count: 0, totalBytes: 0, outputBytes: 0 },
            "empty sessions have no persisted truncations",
          );
        }
        const largeSubagentReport = [
          "SUBAGENT_HEAD",
          ...Array.from(
            { length: 500 },
            (_, index) => `report-${index}-${"x".repeat(80)}`,
          ),
          "SUBAGENT_TAIL",
        ].join("\n");
        const subagentResults = await contextHarness.runHooks(
          "tool_result",
          {
            toolName: "subagent",
            toolCallId: "subagent-call",
            input: { agent: "investigator", task: "inspect" },
            content: [
              { type: "text", text: largeSubagentReport },
              { type: "image", data: "image-data", mimeType: "image/png" },
              { type: "text", text: "SECOND_TEXT_BLOCK" },
            ],
            details: {
              mode: "single",
              runId: "run-1",
              results: [
                {
                  agent: "investigator",
                  finalOutput: largeSubagentReport,
                  messages: [{ role: "assistant", content: [] }],
                  sessionFile: "/tmp/child.jsonl",
                  transcriptPath: "/tmp/child.md",
                  artifactPaths: { output: "/tmp/report.md" },
                  acceptance: {
                    status: "accepted",
                    childReport: { verbose: largeSubagentReport },
                    verifyRuns: [
                      {
                        stdout: largeSubagentReport,
                        stderr: largeSubagentReport,
                      },
                    ],
                  },
                },
              ],
              outputs: {
                child: {
                  text: largeSubagentReport,
                  structured: { report: largeSubagentReport },
                  outputFile: "/tmp/report.md",
                },
              },
            },
            isError: true,
            usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
          },
          diagnosticContext,
        );
        const boundedSubagent = subagentResults.find(Boolean);
        const persistedSubagentContent = boundedSubagent?.content ?? [];
        const persistedSubagentText = persistedSubagentContent
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        assert(
          Buffer.byteLength(persistedSubagentText, "utf8") <= 12 * 1024 &&
            persistedSubagentText.includes("SUBAGENT_HEAD") &&
            persistedSubagentText.includes("SECOND_TEXT_BLOCK") &&
            persistedSubagentText.includes("[Ausgabe gekürzt:") &&
            persistedSubagentContent.some((block) => block.type === "image"),
          "the active setup-core tool_result hook bounds the parent-facing subagent result while retaining text ends and images",
        );
        eq(
          boundedSubagent?.isError,
          true,
          "subagent result guard preserves isError",
        );
        eq(
          boundedSubagent?.details?.results?.[0]?.finalOutput,
          undefined,
          "the parent-persisted subagent details omit the duplicate full child report",
        );
        eq(
          boundedSubagent?.details?.results?.[0]?.sessionFile,
          "/tmp/child.jsonl",
          "the parent-persisted subagent details retain child artifact references",
        );
        eq(
          boundedSubagent?.details?.truncation?.maxBytes,
          12 * 1024,
          "the parent-persisted subagent details record the real truncation boundary",
        );
        eq(
          boundedSubagent?.details?.results?.[0]?.acceptance?.verifyRuns?.[0]
            ?.stdout,
          undefined,
          "the parent-persisted acceptance details omit verify command output copies",
        );
        eq(
          boundedSubagent?.details?.outputs?.child?.structured,
          undefined,
          "the parent-persisted chain details omit structured output copies",
        );
        const verify = harness.tools.get("verify");
        if (verify) {
          await verify.execute(
            "verify-safe-cwd",
            { check: "typecheck" },
            undefined,
            undefined,
            context,
          );
          eq(
            harness.execCalls.at(-1)?.options?.cwd,
            ROOT,
            "verify runs the setup's fixed command from the agent directory",
          );
        }
        const rejectedHarness = createHarness();
        setupCore.default(rejectedHarness.api, {
          exec: async () => {
            throw new Error("spawn ENOENT");
          },
        });
        const rejectedContext = rejectedHarness.makeContext();
        const rejectedVerify = rejectedHarness.tools.get("verify");
        if (rejectedVerify) {
          try {
            await rejectedVerify.execute(
              "verify-spawn-failure",
              { check: "typecheck" },
              undefined,
              undefined,
              rejectedContext,
            );
            assert(false, "verify reports executor startup failures");
          } catch (error) {
            assert(
              error instanceof Error && error.message.includes("spawn ENOENT"),
              "verify throws the bounded executor error as tool output",
            );
          }
        }
        const killedHarness = createHarness();
        setupCore.default(killedHarness.api, {
          exec: async () => ({
            code: 0,
            stdout: "",
            stderr: "",
            killed: true,
          }),
        });
        const killedVerify = killedHarness.tools.get("verify");
        if (killedVerify) {
          try {
            await killedVerify.execute(
              "verify-killed",
              { check: "typecheck" },
              undefined,
              undefined,
              killedHarness.makeContext(),
            );
            assert(
              false,
              "verify never reports a killed process as successful",
            );
          } catch (error) {
            assert(
              error instanceof Error,
              "verify throws on a killed process instead of returning success",
            );
          }
        }
        if (trackedExec) {
          const trailingOutput = await trackedExec.trackedExec(
            process.execPath,
            [
              "-e",
              `const { spawn } = require("node:child_process");\nspawn(process.execPath, ["-e", "setTimeout(() => console.log('CHILD_TAIL'), 20)"], { stdio: "inherit" });`,
            ],
            { timeout: 1_000 },
          );
          assert(
            trailingOutput.stdout.includes("CHILD_TAIL"),
            "tracked executor drains output inherited by a child after leader exit",
          );

          if (process.platform !== "win32") {
            const processDir = mkdtempSync(
              path.join(tmpdir(), "pi-tracked-exec-"),
            );
            const pidFile = path.join(processDir, "child.pid");
            let childPid;
            try {
              const result = await trackedExec.trackedExec(
                process.execPath,
                [
                  "-e",
                  `const { spawn } = require("node:child_process");\nconst child = spawn(process.execPath, ["-e", "const { writeFileSync } = require('node:fs'); writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000);", ${JSON.stringify(pidFile)}], { stdio: "ignore" });\nchild.unref();\nsetInterval(() => {}, 1_000);`,
                ],
                // The grandchild has to get far enough to record its pid
                // before the tree is torn down. A 100 ms budget did not
                // reliably cover a Node start under parallel load, which made
                // the read below throw ENOENT roughly one run in six. The
                // leader loops forever, so a longer timeout still fires.
                { timeout: 1_000, killGraceMs: 50 },
              );
              eq(
                result.killed,
                true,
                "tracked executor reports the timed-out process tree",
              );
              let pidRaw;
              for (let attempt = 0; attempt < 40 && !pidRaw; attempt += 1) {
                try {
                  pidRaw = readFileSync(pidFile, "utf8");
                } catch {
                  await new Promise((resolve) => setTimeout(resolve, 25));
                }
              }
              assert(
                Boolean(pidRaw),
                "the grandchild recorded its pid before the tree was torn down",
              );
              childPid = Number(pidRaw);
              let childStillExists = true;
              for (
                let attempt = 0;
                attempt < 20 && childStillExists;
                attempt += 1
              ) {
                try {
                  process.kill(childPid, 0);
                } catch {
                  childStillExists = false;
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
              eq(
                childStillExists,
                false,
                "tracked executor escalates to SIGKILL after the leader accepts SIGTERM",
              );
            } finally {
              if (childPid) {
                try {
                  process.kill(childPid, "SIGKILL");
                } catch {
                  // The assertion expects this process to be gone already.
                }
              }
              rmSync(processDir, { recursive: true, force: true });
            }
          }
        }
        const projectCheck = harness.tools.get("project_check");
        if (projectCheck) {
          try {
            await projectCheck.execute(
              "project-check-missing-config",
              { profile: "tests" },
              undefined,
              undefined,
              context,
            );
            assert(
              false,
              "project_check reports a requested profile it cannot run without guessing commands",
            );
          } catch (error) {
            assert(
              error instanceof Error,
              "project_check throws on a requested profile it cannot run without guessing commands",
            );
          }
        }
        assertNoGlobalChrome(harness, "setup core owns no TUI chrome");
      } finally {
        if (previousAgentDir === undefined)
          delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    });

    // ---------------------------------------------------------------------------
    // Trust-gated project verification profiles (#105). Foundation for the
    // universal verification gate (#102); separate from the inviolable setup
    // `verify` tool. No real process is spawned (exec is injected).
    // ---------------------------------------------------------------------------
  },

  "setup doctor required profile completeness (P1-08)": async (context) => {
    const { section, setupCore } = context;

    await section(
      "setup doctor required profile completeness (P1-08)",
      async () => {
        if (!setupCore) return;
        // Before this, the only signal that a project had no required check
        // was a passive agent_end notification, gated on the project having
        // *changed* since the session started — invisible on a fresh
        // /setup-doctor run, and silent entirely when .pi/verify.json was
        // missing outright.
        async function doctorReport(workspace) {
          const harness = createHarness();
          setupCore.default(harness.api, { exec: harness.api.exec });
          const context = harness.makeContext({
            cwd: workspace,
            trusted: true,
          });
          const doctor = harness.commands.get("setup-doctor");
          await doctor("", context);
          return harness.notifications.at(-1)?.message ?? "";
        }

        const noConfigWorkspace = mkdtempSync(
          path.join(tmpdir(), "pi-setup-doctor-no-verify-json-"),
        );
        assert(
          (await doctorReport(noConfigWorkspace)).includes(
            "WARNING: Kein Projekt-Prüfprofil definiert",
          ),
          "a trusted project without .pi/verify.json is flagged",
        );
        rmSync(noConfigWorkspace, { recursive: true, force: true });

        const noRequiredWorkspace = mkdtempSync(
          path.join(tmpdir(), "pi-setup-doctor-no-required-"),
        );
        mkdirSync(path.join(noRequiredWorkspace, ".pi"), { recursive: true });
        writeFileSync(
          path.join(noRequiredWorkspace, ".pi", "verify.json"),
          JSON.stringify({
            profiles: {
              lint: { program: "eslint", args: [], classification: "advisory" },
            },
          }),
        );
        assert(
          (await doctorReport(noRequiredWorkspace)).includes(
            "WARNING: Projekt-Prüfprofile enthalten keine Pflichtprüfung",
          ),
          "a project whose profiles are all non-required is flagged",
        );
        rmSync(noRequiredWorkspace, { recursive: true, force: true });

        const healthyWorkspace = mkdtempSync(
          path.join(tmpdir(), "pi-setup-doctor-healthy-"),
        );
        mkdirSync(path.join(healthyWorkspace, ".pi"), { recursive: true });
        writeFileSync(
          path.join(healthyWorkspace, ".pi", "verify.json"),
          JSON.stringify({
            profiles: {
              typecheck: {
                program: "tsc",
                args: ["--noEmit"],
                classification: "required",
              },
            },
          }),
        );
        const healthyReport = await doctorReport(healthyWorkspace);
        assert(
          !healthyReport.includes("Kein Projekt-Prüfprofil definiert") &&
            !healthyReport.includes("keine Pflichtprüfung"),
          "a project with at least one required profile is not flagged",
        );
        rmSync(healthyWorkspace, { recursive: true, force: true });
      },
    );
  },
};
