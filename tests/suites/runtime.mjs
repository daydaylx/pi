import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { assert, eq } from "../shared/assertions.mjs";
import {
  assertNoGlobalChrome,
  contrastRatio,
  createHarness,
  latestStatus,
  stripAnsi,
} from "../shared/harness.mjs";
import { ROOT } from "../shared/jiti-loader.mjs";

export const runtimeSections = {
  "target runtime configuration": async (context) => {
    const { section } = context;

    await section("target runtime configuration", async () => {
      const settings = JSON.parse(
        readFileSync(path.join(ROOT, "settings.json"), "utf8"),
      );
      const keybindings = JSON.parse(
        readFileSync(path.join(ROOT, "keybindings.json"), "utf8"),
      );
      const subagentConfig = JSON.parse(
        readFileSync(
          path.join(ROOT, "extensions", "subagent", "config.json"),
          "utf8",
        ),
      );
      const packageJson = JSON.parse(
        readFileSync(path.join(ROOT, "npm", "package.json"), "utf8"),
      );
      const lock = JSON.parse(
        readFileSync(path.join(ROOT, "npm", "package-lock.json"), "utf8"),
      );

      // Aurora is the only supported runtime chrome in this test suite.
      if (settings.theme === "aurora-night") {
        const setup = JSON.parse(
          readFileSync(path.join(ROOT, "setup.json"), "utf8"),
        );
        const schema = JSON.parse(
          readFileSync(path.join(ROOT, "schemas", "setup.schema.json"), "utf8"),
        );
        const auroraTheme = JSON.parse(
          readFileSync(path.join(ROOT, "themes", "aurora-night.json"), "utf8"),
        );
        const packageSources = settings.packages.map((entry) =>
          typeof entry === "string" ? entry : entry?.source,
        );
        eq(
          packageSources.length,
          1,
          "only subagent orchestration remains an active package",
        );
        assert(
          /^git:github\.com\/daydaylx\/pi-subagents@[0-9a-f]{40}$/.test(
            packageSources[0] ?? "",
          ),
          "subagent runtime remains immutable-pinned",
        );
        eq(
          settings.subagents,
          { disableBuiltins: true },
          "settings directly disable package-built-in agent profiles",
        );
        assert(
          !Object.hasOwn(setup, "models"),
          "setup.json contains no duplicate model-role configuration",
        );
        const defaultModelId = `${settings.defaultProvider}/${settings.defaultModel}`;
        assert(
          settings.enabledModels.includes(defaultModelId),
          `the active default model (${defaultModelId}) is contained in Pi's scoped models`,
        );
        eq(
          setup.ui,
          { theme: "aurora-night", motion: "contextual" },
          "central UI defaults",
        );
        eq(
          setup.permissions,
          { unknownTools: "ask", bash: "allow" },
          "unknown tools and free bash fail to confirmation",
        );
        eq(
          keybindings["tui.editor.yank"],
          "super+shift+y",
          "editor yank leaves Super+Y available for the YOLO toggle",
        );
        eq(
          schema.additionalProperties,
          false,
          "central setup schema rejects unknown root keys",
        );
        eq(
          auroraTheme.name,
          "aurora-night",
          "Aurora theme has its stable runtime name",
        );
        eq(
          auroraTheme.vars.dim,
          "#7384AA",
          "Aurora dim uses the accessible P2 contrast color",
        );
        assert(
          contrastRatio(auroraTheme.vars.dim, auroraTheme.vars.navy) >= 4.5 &&
            contrastRatio(auroraTheme.vars.dim, auroraTheme.vars.surface) >=
              4.5,
          "Aurora dim meets AA contrast on both default backgrounds",
        );
        for (const color of [
          "accent",
          "borderAccent",
          "success",
          "warning",
          "error",
          "thinkingXhigh",
        ]) {
          assert(
            Boolean(auroraTheme.colors?.[color]),
            `Aurora declares ${color}`,
          );
        }

        // Pi's theme schema sets additionalProperties:false and Theme.fg/bg throw on
        // unknown keys. A key the schema does not know therefore does not fail
        // loudly — it fails inside whatever try/catch happens to wrap the call. This
        // is the check that would have caught the invented "pillBg".
        const themeSchema = JSON.parse(
          readFileSync(
            path.join(
              ROOT,
              "npm/node_modules/@earendil-works/pi-coding-agent/dist",
              "modes/interactive/theme/theme-schema.json",
            ),
            "utf8",
          ),
        );
        const schemaColors = themeSchema.properties?.colors ?? {};
        const declaredColors = Object.keys(schemaColors.properties ?? {});
        assert(
          declaredColors.length > 0,
          "the Pi theme schema exposes its color properties",
        );
        eq(
          schemaColors.additionalProperties,
          false,
          "the Pi theme schema rejects unknown color keys",
        );
        for (const color of Object.keys(auroraTheme.colors ?? {})) {
          assert(
            declaredColors.includes(color),
            `Aurora color ${color} exists in the Pi theme schema`,
          );
        }
        for (const required of schemaColors.required ?? []) {
          assert(
            Object.hasOwn(auroraTheme.colors ?? {}, required),
            `Aurora declares the required color ${required}`,
          );
        }

        // The three former UI packages are inactive (see the pin assertions below),
        // so their configuration steered nothing. ADR 009 deleted it; these two
        // assertions are the stronger statement over "is unused".
        for (const deadConfig of [
          "zentui.json",
          "extensions/pi-tool-display/config.json",
        ]) {
          assert(
            !existsSync(path.join(ROOT, deadConfig)),
            `${deadConfig} does not return as dead configuration`,
          );
        }

        // renderPill reached for a background through an `as never` cast, which is
        // exactly how the invalid key survived the typechecker.
        const uiTheme = readFileSync(
          path.join(ROOT, "extensions/shared/ui-theme.ts"),
          "utf8",
        );
        assert(
          !/as never/.test(uiTheme) && !/\.bg\(/.test(uiTheme),
          "shared chrome helpers type their theme colors instead of casting them away",
        );

        const activeExtensions = settings.extensions.filter(
          (entry) =>
            typeof entry === "string" && entry.startsWith("+extensions/"),
        );
        eq(
          activeExtensions,
          [
            "+extensions/setup-core/index.ts",
            "+extensions/plan-mode/index.ts",
            "+extensions/mode-permissions.ts",
            "+extensions/lsp/index.ts",
            "+extensions/ask-user.ts",
            "+extensions/diff-viewer/index.ts",
            "+extensions/control-plane.ts",
            "+extensions/aurora-ui/index.ts",
          ],
          "settings declare the dependency-safe local extension order",
        );
        for (const extension of [
          "+extensions/setup-core/index.ts",
          "+extensions/plan-mode/index.ts",
          "+extensions/mode-permissions.ts",
          "+extensions/ask-user.ts",
          "+extensions/lsp/index.ts",
          "+extensions/aurora-ui/index.ts",
        ]) {
          assert(
            activeExtensions.includes(extension),
            `${extension} is active`,
          );
        }
        // Aurora is the only UI owner: the pre-Aurora chrome files are gone from
        // the tree, not merely deactivated. Git history is their fallback.
        for (const legacyOwner of [
          "extensions/activity-status.ts",
          "extensions/thinking-view.ts",
          "extensions/thinking-view-config.ts",
          "extensions/git-header.ts",
          "extensions/context-menu.ts",
        ]) {
          assert(
            !existsSync(path.join(ROOT, legacyOwner)),
            `${legacyOwner} no longer exists under Aurora`,
          );
        }
        for (const extension of activeExtensions) {
          const sourcePath = path.join(ROOT, extension.slice(1));
          assert(
            existsSync(sourcePath),
            extension + " resolves to a local file",
          );
          if (!existsSync(sourcePath)) continue;
          const source = readFileSync(sourcePath, "utf8");
          const ownsChrome =
            /\.(?:setFooter|setEditorComponent|setWidget|setHeader)\s*\(/.test(
              source,
            );
          if (extension === "+extensions/aurora-ui/index.ts") {
            assert(ownsChrome, "Aurora owns the custom TUI chrome");
            eq(
              (source.match(/\bsetInterval\s*\(/g) ?? []).length,
              1,
              "Aurora owns one shared contextual ticker",
            );
          } else {
            const isTemporaryDiffPreview =
              extension === "+extensions/diff-viewer/index.ts";
            if (isTemporaryDiffPreview) {
              assert(
                !/\.(?:setFooter|setEditorComponent|setHeader)\s*\(/.test(
                  source,
                ),
                extension + " owns no permanent TUI chrome",
              );
              assert(
                source.includes("setWidget(LIVE_PREVIEW_WIDGET, undefined)"),
                extension + " clears its temporary live-preview widget",
              );
            } else {
              assert(
                !ownsChrome,
                extension + " does not compete for TUI chrome",
              );
            }
            assert(
              !/\bsetInterval\s*\(/.test(source),
              extension + " has no UI ticker",
            );
          }
        }
        eq(
          subagentConfig.parallel,
          { maxTasks: 4, concurrency: 3 },
          "active package config directly bounds subagent tasks and concurrency",
        );
        eq(
          subagentConfig.globalConcurrencyLimit,
          3,
          "active package config directly bounds global concurrency",
        );
        eq(
          subagentConfig.maxSubagentSpawnsPerSession,
          5,
          "active package config directly bounds spawns per session",
        );
        eq(
          setup.subagents,
          { concurrency: 3 },
          "setup.json supplies only the concurrency baseline",
        );
        eq(
          schema.properties.subagents.required,
          ["concurrency"],
          "setup schema requires only the concurrency baseline",
        );
        eq(
          schema.properties.subagents.properties,
          { concurrency: { type: "integer", minimum: 1, maximum: 8 } },
          "setup schema exposes no runtime package limits",
        );
        eq(
          subagentConfig.parallel.concurrency,
          setup.subagents.concurrency,
          "active package concurrency matches the setup baseline",
        );
        const installerSource = readFileSync(
          path.join(ROOT, "scripts", "install-user.mjs"),
          "utf8",
        );
        for (const required of [
          '"package.json"',
          '"tsconfig.json"',
          '"npm/package.json"',
          '"npm/package-lock.json"',
          '"tests"',
        ]) {
          assert(
            installerSource.includes(required),
            `greenfield installer includes verification support ${required}`,
          );
        }
        for (const workflow of ["verify.yml", "lsp-smoke.yml"]) {
          const source = readFileSync(
            path.join(ROOT, ".github", "workflows", workflow),
            "utf8",
          );
          assert(
            /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/.test(
              source,
            ),
            `${workflow} pins actions/checkout to its v4.2.2 commit`,
          );
          assert(
            /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/.test(
              source,
            ),
            `${workflow} pins actions/setup-node to its v4.4.0 commit`,
          );
          assert(
            !/uses:\s*actions\/(?:checkout|setup-node)@v\d/.test(source),
            `${workflow} has no mutable checkout/setup-node tag`,
          );
        }

        // Exact harness pins remain installed for deterministic typechecking even
        // though the remaining former UI packages are not active at runtime.
        for (const [name, version] of [
          ["pi-zentui", "0.3.0"],
          ["@ujjwalgrover/pi-catppuccin", "1.0.0"],
          ["pi-subagents", "0.34.0"],
        ]) {
          eq(
            packageJson.dependencies?.[name],
            version,
            name + " remains exact in the harness",
          );
          eq(
            lock.packages?.["node_modules/" + name]?.version,
            version,
            name + " remains locked",
          );
        }
        return;
      }
    });
  },

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
          activity: { kind: "idle", activeTools: 0 },
        };
        auroraState.mergeAuroraUiState(state, {
          workflow: {
            phase: "simple_plan",
            label: "Schnellplan",
            completed: 1,
            total: 3,
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
        eq(state.workflow.completed, 1, "Aurora keeps workflow progress");
        eq(state.workflow.total, 3, "Aurora keeps the workflow total");
        auroraState.mergeAuroraUiState(state, {
          workflow: { completed: 4, total: 3 },
        });
        eq(
          state.workflow.completed,
          undefined,
          "Aurora rejects progress beyond the declared total",
        );
        eq(state.lsp.state, "ready", "Aurora merges LSP patches");
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
    const { section, contextDiagnostics, setupCore } = context;

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
        setupCore.default(harness.api);
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
            ?.message?.includes("Pi CLI/dev package: 0.80.7/0.84.0") &&
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
              "subagent baseline (setup.json): concurrency=3",
            ) &&
            harness.notifications
              .at(-1)
              ?.message?.includes(
                "active subagent package config: concurrency=3, globalConcurrencyLimit=3",
              ),
          "setup doctor distinguishes the setup baseline from active package config",
        );
        assert(
          !harness.notifications.at(-1)?.message?.includes("doom-loop status:") &&
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
        setupCore.default(contextHarness.api);
        const contextCommand = contextHarness.commands.get("setup-doctor");
        const diagnosticContext = contextHarness.makeContext();
        if (contextCommand) await contextCommand("context", diagnosticContext);
        const contextReport = contextHarness.notifications.at(-1)?.message ?? "";
        assert(
          contextReport.includes("registered tools: 2 (alpha, zeta)") &&
            contextReport.includes("active tools: 2 (dynamic-tool, zeta)"),
          "context doctor reports sorted registered and dynamically active tools",
        );
        assert(
          contextReport.includes("effective system prompt: 11 bytes") &&
            contextReport.includes(
              "real usage: input=11, output=22, cacheRead=33, cacheWrite=44",
            ) &&
            contextReport.includes(
              "persisted compactions: 1 (2026-08-02T10:00:00.000Z)",
            ) &&
            contextReport.includes(
              "persisted tool truncations: count=1, totalBytes=200, outputBytes=80",
            ),
          "context doctor reports only aggregate prompt, usage, compaction and truncation diagnostics",
        );
        if (contextCommand) await contextCommand("unexpected", diagnosticContext);
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
          eq(empty.usage, null, "missing persisted usage is reported as n/a");
          eq(
            empty.toolTruncation,
            { count: 0, totalBytes: 0, outputBytes: 0 },
            "empty sessions have no persisted truncations",
          );
        }
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
        const projectCheck = harness.tools.get("project_check");
        if (projectCheck) {
          const missing = await projectCheck.execute(
            "project-check-missing-config",
            { profile: "tests" },
            undefined,
            undefined,
            context,
          );
          eq(
            missing.isError,
            true,
            "project_check reports a missing .pi/verify.json without guessing commands",
          );
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

  "verification status layer": async (context) => {
    const { section, load, setupCore } = context;

    await section("verification status layer", async () => {
      const status = await load("extensions/setup-core/verification-status.ts");
      const cleanSnapshot = { changedFiles: [], fingerprint: "clean" };
      const changedSnapshot = { changedFiles: ["source.ts"], fingerprint: "changed" };
      const ROOT_A = "/workspace/a";
      const ROOT_B = "/workspace/b";

      const report = (profileId, classification, reportStatus, exitCode, killed) => ({
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
        "clean",
        "a clean workspace is clean without a check",
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
        statusOf(changedSnapshot, record({ typecheck: "success" }), ["typecheck"]),
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
        statusOf(changedSnapshot, record({ typecheck: "success" }), ["typecheck"], ROOT_B),
        "changed_unverified",
        "a check recorded for another workspace root does not carry over",
      );
      eq(
        statusOf(changedSnapshot, record({ typecheck: "failed" }), ["typecheck"]),
        "checks_failed",
        "a failed required check is reported as failed",
      );
      eq(
        statusOf(changedSnapshot, record({ typecheck: "unavailable" }), ["typecheck"]),
        "checks_unavailable",
        "a required check without a verdict is unavailable, not failed",
      );
      // A check that ran and said no outranks one that never produced a verdict.
      eq(
        statusOf(changedSnapshot, record({ tests: "failed", typecheck: "unavailable" }), [
          "tests",
          "typecheck",
        ]),
        "checks_failed",
        "a real required failure outranks a concurrent unavailable check",
      );
      // P0: a blocking recommended failure must not coexist with `verified`.
      eq(
        statusOf(
          changedSnapshot,
          record({ typecheck: "success" }, { blockingRecommendedIds: ["lint"] }),
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
      eq(requiredPass.requiredOutcomes.typecheck, "success", "a passing required run succeeds");
      eq(requiredPass.blocking, false, "a passing required run does not block");
      eq(requiredPass.missingRequiredIds.length, 0, "a full run leaves nothing open");

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
      eq(requiredFail.requiredOutcomes.typecheck, "failed", "a required command failure fails");
      eq(requiredFail.blocking, true, "a required failure blocks the tool call");

      const requiredTimeout = status.evaluateCheckRun(
        [report("typecheck", "required", "timeout", null, true)],
        ["typecheck"],
      );
      eq(
        requiredTimeout.requiredOutcomes.typecheck,
        "unavailable",
        "a timeout is an unavailable check, not a failure",
      );
      eq(requiredTimeout.blocking, true, "a required non-execution still blocks");

      const recommendedFail = status.evaluateCheckRun(
        [report("typecheck", "required", "success"), report("lint", "recommended", "spawn_failed", 1)],
        ["typecheck"],
      );
      eq(
        recommendedFail.blockingRecommendedIds.join(","),
        "lint",
        "a confirmed recommended failure is recorded",
      );
      eq(recommendedFail.blocking, true, "a confirmed recommended failure blocks");

      const recommendedMissing = status.evaluateCheckRun(
        [report("lint", "recommended", "missing_binary", null)],
        [],
      );
      eq(
        recommendedMissing.blockingRecommendedIds.length,
        0,
        "a missing recommended binary stays a residual risk",
      );
      eq(recommendedMissing.blocking, false, "a missing recommended binary does not block");
      eq(
        recommendedMissing.clearedRecommendedIds.length,
        0,
        "a missing recommended binary clears nothing — only a success may",
      );

      const advisoryFail = status.evaluateCheckRun(
        [report("typecheck", "required", "success"), report("audit", "advisory", "spawn_failed", 1)],
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
        status.evaluateCheckRun([report("typecheck", "required", "success")], [
          "tests",
          "typecheck",
        ]),
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
        status.evaluateCheckRun([report("tests", "required", "success")], [
          "tests",
          "typecheck",
        ]),
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
        status.evaluateCheckRun([report("tests", "required", "success")], [
          "tests",
          "typecheck",
        ]),
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
        status.evaluateCheckRun([report("tests", "required", "success")], [
          "tests",
          "typecheck",
        ]),
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
        status.evaluateCheckRun([report("lint", "recommended", "spawn_failed", 1)], [
          "tests",
          "typecheck",
        ]),
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
        status.evaluateCheckRun([report("lint", "recommended", "success")], [
          "tests",
          "typecheck",
        ]),
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
      eq(coverage.covered.join(","), "typecheck", "coverage lists what actually passed");
      eq(coverage.missing.join(","), "tests", "coverage lists what is still open");
      eq(coverage.total, 2, "coverage counts every declared required profile");
      eq(
        status.requiredCoverage(undefined, ["tests"]).missing.join(","),
        "tests",
        "an absent record covers nothing",
      );

      if (!setupCore) return;
      const workspace = mkdtempSync(path.join(tmpdir(), "pi-verification-status-"));
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
        writeFileSync(path.join(workspace, "source.ts"), "export const value = 1;\n");
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
                return { stdout: "", stderr: "lint error", code: 1, killed: false };
            }
            return { stdout: "ok", stderr: "", code: 0, killed: false };
          },
        });
        setupCore.default(harness.api);
        const trusted = harness.makeContext({ cwd: workspace, trusted: true });
        await harness.runHooks("session_start", {}, trusted);
        await harness.runHooks("agent_settled", { type: "agent_settled" }, trusted);
        eq(
          latestStatus(harness, "verification"),
          "Verify: clean",
          "agent_settled publishes a compact clean technical status",
        );

        writeFileSync(path.join(workspace, "source.ts"), "export const value = 2;\n");
        await harness.runHooks("agent_settled", { type: "agent_settled" }, trusted);
        eq(
          latestStatus(harness, "verification"),
          "Verify: changed_unverified",
          "agent_settled reports a changed workspace without a current check",
        );
        const beforeDuplicateSettle = harness.statusCalls.length;
        await harness.runHooks("agent_settled", { type: "agent_settled" }, trusted);
        eq(
          harness.statusCalls.length,
          beforeDuplicateSettle,
          "identical settled statuses are deduplicated",
        );

        const projectCheck = harness.tools.get("project_check");
        assert(projectCheck, "project_check is available for a required profile");
        const runCheck = (id, params) =>
          projectCheck.execute(id, params, undefined, undefined, trusted);

        // P0 regression: one of two required profiles must not verify.
        const partial = await runCheck("verification-status-partial", {
          profile: "typecheck",
        });
        eq(partial.isError, false, "incomplete coverage is not a tool error");
        eq(
          partial.details.verification.missingRequiredIds.join(","),
          "tests",
          "project_check names the required profile that is still open",
        );
        assert(
          partial.content[0].text.includes("Pflichtabdeckung: 1/2 — offen: tests"),
          "project_check reports accumulated required coverage in its output",
        );
        await harness.runHooks("agent_settled", { type: "agent_settled" }, trusted);
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
        await harness.runHooks("agent_settled", { type: "agent_settled" }, trusted);
        eq(
          latestStatus(harness, "verification"),
          "Verify: verified",
          "coverage accumulated over two calls verifies the identical snapshot",
        );

        // P0 regression: a blocking recommended failure and `verified` must
        // never describe the same run.
        lintFails = true;
        const recommended = await runCheck("verification-status-recommended", {
          profile: "lint",
        });
        eq(recommended.isError, true, "a confirmed recommended failure is a tool error");
        await harness.runHooks("agent_settled", { type: "agent_settled" }, trusted);
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
        eq(
          vanishedBinary.isError,
          false,
          "a missing recommended binary is a residual risk, not a tool error",
        );
        await harness.runHooks("agent_settled", { type: "agent_settled" }, trusted);
        eq(
          latestStatus(harness, "verification"),
          "Verify: checks_failed",
          "a vanished recommended binary does not restore a verified status",
        );
        lintMissing = false;

        // Only a successful re-run clears the block.
        await runCheck("verification-status-lint-recovered", { profile: "lint" });
        await harness.runHooks("agent_settled", { type: "agent_settled" }, trusted);
        eq(
          latestStatus(harness, "verification"),
          "Verify: verified",
          "a successful recommended re-run restores the verified status",
        );

        writeFileSync(path.join(workspace, "source.ts"), "export const value = 3;\n");
        await harness.runHooks("agent_settled", { type: "agent_settled" }, trusted);
        eq(
          latestStatus(harness, "verification"),
          "Verify: changed_unverified",
          "the status becomes stale after a later workspace change",
        );
        writeFileSync(
          path.join(workspace, ".pi", "setup.json"),
          JSON.stringify({ verificationStatus: { enabled: false } }),
        );
        await harness.runHooks("agent_settled", { type: "agent_settled" }, trusted);
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
          setupCore.default(harness.api);
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
      eq(
        failRun.error.kind,
        "spawn_failed",
        "non-zero exit reported as spawn_failed",
      );

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
      setupCore.default(harness.api);
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
        eq(
          result.isError,
          false,
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
        const unknown = await tool.execute(
          "project-check-unknown",
          { profile: "does-not-exist" },
          undefined,
          undefined,
          trusted,
        );
        eq(unknown.isError, true, "project_check rejects unknown profile IDs");
        assert(
          unknown.content[0].text.includes("Verfügbar: lint, typecheck"),
          "unknown profile errors list available profile IDs",
        );
        const invalid = await tool.execute(
          "project-check-ambiguous",
          { profile: "lint", profiles: ["typecheck"] },
          undefined,
          undefined,
          trusted,
        );
        eq(
          invalid.isError,
          true,
          "project_check rejects ambiguous single-plus-list calls",
        );
      }
      const untrusted = harness.makeContext({ cwd: workspace, trusted: false });
      await harness.runHooks("session_start", {}, untrusted);
      if (tool) {
        const result = await tool.execute(
          "project-check-untrusted",
          { profile: "typecheck" },
          undefined,
          undefined,
          untrusted,
        );
        eq(
          result.isError,
          true,
          "project_check refuses untrusted project profiles",
        );
        assert(
          result.content[0].text.includes("vertrauten Projekten"),
          "project_check explains the trust requirement",
        );
      }
      rmSync(workspace, { recursive: true, force: true });
    });
  },

  "native subagent profiles": async (context) => {
    const { section } = context;

    await section("native subagent profiles", async () => {
      const expectedProfiles = [
        "debugger.md",
        "investigator.md",
        "verifier.md",
      ];
      const agentsRoot = path.join(ROOT, "agents");
      eq(
        readdirSync(agentsRoot, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => entry.name)
          .sort(),
        expectedProfiles,
        "investigator, debugger and verifier are the complete local role set",
      );
      const profileSources = Object.fromEntries(
        expectedProfiles.map((name) => [
          name,
          readFileSync(path.join(agentsRoot, name), "utf8"),
        ]),
      );
      const expectedTools = {
        "investigator.md": "read, grep, find, ls",
        "debugger.md": "read, grep, find, ls, bash",
        "verifier.md": "read, grep, find, ls, bash",
      };
      for (const [name, source] of Object.entries(profileSources)) {
        assert(
          source.includes(`name: ${name.slice(0, -3)}`),
          `${name} declares the exact active role name`,
        );
        assert(
          source.includes(`tools: ${expectedTools[name]}`),
          `${name} declares its exact runtime tool boundary`,
        );
        assert(
          source.includes("defaultContext: fresh") &&
            source.includes("inheritProjectContext: true") &&
            source.includes("inheritSkills: false"),
          `${name} starts with fresh context without inherited skills`,
        );
        assert(
          !/^tools:.*\b(?:task|delegate|spawn)\b/m.test(source),
          `${name} cannot perform nested delegation`,
        );
      }
      for (const name of expectedProfiles) {
        assert(
          !/^tools:.*\b(?:edit|write)\b/m.test(profileSources[name]),
          `${name} has no project write tool`,
        );
      }
      for (const name of ["investigator.md", "verifier.md"]) {
        const source = profileSources[name];
        assert(
          source.includes("## Acceptance Contract") &&
            source.includes("`acceptance-report`") &&
            source.includes("Teil des Ausgabeformats"),
          `${name} treats a required acceptance report as part of its fixed output format`,
        );
      }
      assert(
        !/^tools:.*\bbash\b/m.test(profileSources["investigator.md"]),
        "investigator has no shell access",
      );
      for (const name of ["debugger.md", "verifier.md"]) {
        assert(
          /^tools:.*\bbash\b/m.test(profileSources[name]),
          `${name} may run diagnostic shell commands`,
        );
      }
      const archivedRoot = path.join(ROOT, "docs", "archive", "subagents-v1");
      eq(
        readdirSync(archivedRoot)
          .filter((name) => name.endsWith(".md"))
          .sort(),
        ["planner.md", "reviewer.md", "worker.md"],
        "retired profiles are preserved outside the active agent directory",
      );
      for (const activeDoc of ["AGENTS.md", "README.md", "docs/subagents.md"]) {
        const source = readFileSync(path.join(ROOT, activeDoc), "utf8");
        assert(
          !/\b(?:planner|worker|reviewer)\b/i.test(source),
          `${activeDoc} does not present retired roles as active`,
        );
      }
      assert(
        /Hauptagent.*(?:Patch-Eigentümer|implementiert)/is.test(
          readFileSync(path.join(ROOT, "docs/subagents.md"), "utf8"),
        ),
        "documentation keeps regular patch ownership with the main agent",
      );
      assert(
        readFileSync(path.join(ROOT, "docs/subagents.md"), "utf8").includes(
          "Aufrufer geben ihnen keinen\n`output`-Pfad vor",
        ),
        "documentation keeps read-only subagent findings inline instead of requiring a child-written output path",
      );
    });
  },

  "native project skills": async (context) => {
    const { section } = context;

    await section("native project skills", async () => {
      const expectedSkills = [
        "agent-docs",
        "bug-triage",
        "context-checkpoint",
        "doc-diff",
        "git-check",
        "lsp-navigation",
        "prompt-compiler",
        "release-changelog",
        "repo-analyse",
        "security-audit",
        "test-ci",
        "ui-ux-review",
      ];
      const skillsRoot = path.join(ROOT, "skills");
      eq(
        readdirSync(skillsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort(),
        expectedSkills,
        "the twelve project skills use Pi's standard skill directories",
      );

      for (const name of expectedSkills) {
        const skillPath = path.join(skillsRoot, name, "SKILL.md");
        assert(existsSync(skillPath), name + " has a native SKILL.md file");
        if (!existsSync(skillPath)) continue;
        const source = readFileSync(skillPath, "utf8");
        assert(
          new RegExp(
            "^---\\nname: " +
              name +
              '\\ndescription: (?:\\"[^\\n]+\\"|[^\\n]+)\\n---\\n',
          ).test(source),
          name + " has Pi-compatible name and description frontmatter",
        );
        assert(
          !/^allowed-tools:/m.test(source),
          name +
            " does not present experimental allowed-tools as a security boundary",
        );
      }

      const checkpointSkill = readFileSync(
        path.join(skillsRoot, "context-checkpoint", "SKILL.md"),
        "utf8",
      );
      const agentRules = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
      const ledger = readFileSync(
        path.join(ROOT, "docs", "CONTEXT_LEDGER.md"),
        "utf8",
      );
      const projectState = readFileSync(
        path.join(ROOT, "docs", "PROJECT_STATE.md"),
        "utf8",
      );
      const ledgerDecision = readFileSync(
        path.join(
          ROOT,
          "docs",
          "decisions",
          "008-context-ledger-is-documentation.md",
        ),
        "utf8",
      );
      assert(
        /\bcontext-checkpoint\b/.test(agentRules) &&
          !/Ledger\s+wird\s+zusätzlich\s+automatisch[\s\S]{0,120}plan-mode\s+konsolidiert/i.test(
            agentRules,
          ),
        "AGENTS routes checkpoints through the manual skill without a runtime ledger claim",
      );
      assert(
        /keine\s+automatische\s+Konsolidierung/i.test(checkpointSkill) &&
          checkpointSkill.includes("docs/PROJECT_STATE.md") &&
          checkpointSkill.includes("docs/CONTEXT_LEDGER.md"),
        "context-checkpoint is the sole ledger maintenance path",
      );
      assert(
        ledger.includes("# Context Ledger") &&
          projectState.includes("# Project State") &&
          ledgerDecision.includes("keine Laufzeitkomponente"),
        "ledger, project state and ADR retain their separate non-runtime roles",
      );
    });

    // ─────────────────────── security and plan helpers ───────────────────────
    // Doom-Loop- und Edit-Fallback-Module wurden entfernt: sie waren seit 4c7a201
    // von keiner Extension mehr geladen (setup-core/index.ts importierte sie nicht)
    // und damit wirkungslos. Ihre Tests entfallen mit ihnen.
  },

  "global control plane shortcuts": async (context) => {
    const { section, controlPlane } = context;

    await section("global control plane shortcuts", async () => {
      if (!controlPlane) return;
      const harness = createHarness({
        select: (labels) =>
          labels.includes("LSP-Diagnose") ? "LSP-Diagnose" : undefined,
      });
      controlPlane.default(harness.api);
      const context = harness.makeContext();
      context.ui.custom = async () => {
        throw new Error("use deterministic select fallback");
      };
      const openMainMenu = harness.shortcuts.get("super+q");
      assert(Boolean(openMainMenu), "Super+Q registers the global main menu");
      if (openMainMenu) await openMainMenu(context);
      eq(
        harness.submittedCommands,
        ["/commands"],
        "Super+Q submits the canonical /commands entry point",
      );
      eq(
        harness.emitted,
        [],
        "the control plane owns shortcuts only and needs no parallel menu event",
      );
    });
  },

  "shared output limits": async (context) => {
    const { section, load, lspTools, outputLimits } = context;

    await section("shared output limits", async () => {
      if (!outputLimits) return;
      const largeText = [
        "HEAD_SENTINEL",
        ...Array.from(
          { length: outputLimits.DEFAULT_MAX_LINES + 500 },
          (_, index) => `line-${index}`,
        ),
        "TAIL_SENTINEL",
      ].join("\n");
      const limited = outputLimits.limitTextOutput(largeText);
      assert(
        Boolean(limited.truncation),
        "oversized text is visibly truncated",
      );
      assert(
        limited.text.startsWith("HEAD_SENTINEL") &&
          limited.text.endsWith("TAIL_SENTINEL"),
        "balanced truncation retains both beginning and end",
      );
      assert(
        limited.text.includes("[Ausgabe gekürzt:"),
        "balanced truncation includes a visible marker",
      );
      assert(
        Buffer.byteLength(limited.text, "utf8") <=
          outputLimits.DEFAULT_MAX_BYTES,
        "balanced truncation stays within Pi's byte limit",
      );
      assert(
        limited.truncation.outputLines <= outputLimits.DEFAULT_MAX_LINES,
        "balanced truncation stays within Pi's line limit",
      );

      const utf8SingleLine =
        "HEAD_UTF8_SENTINEL-" + "😀".repeat(40_000) + "-TAIL_UTF8_SENTINEL";
      const limitedUtf8 = outputLimits.limitTextOutput(utf8SingleLine);
      const actualUtf8Bytes = Buffer.byteLength(limitedUtf8.text, "utf8");
      const actualUtf8Lines = limitedUtf8.text.endsWith("\n")
        ? limitedUtf8.text.split("\n").length - 1
        : limitedUtf8.text.split("\n").length;
      assert(
        limitedUtf8.text.startsWith("HEAD_UTF8_SENTINEL-") &&
          limitedUtf8.text.endsWith("-TAIL_UTF8_SENTINEL"),
        "a long single UTF-8 line retains both head and tail sentinels",
      );
      assert(
        !limitedUtf8.text.includes("\uFFFD"),
        "partial single-line truncation never splits a UTF-8 code point",
      );
      assert(
        actualUtf8Bytes <= outputLimits.DEFAULT_MAX_BYTES,
        "single-line UTF-8 truncation stays within Pi's byte limit",
      );
      eq(
        limitedUtf8.truncation.outputBytes,
        actualUtf8Bytes,
        "single-line truncation reports its actual byte count",
      );
      eq(
        limitedUtf8.truncation.outputLines,
        actualUtf8Lines,
        "single-line truncation reports its actual line count",
      );
      eq(
        outputLimits.SUBAGENT_MAX_BYTES,
        12 * 1024,
        "subagent output has its dedicated byte limit",
      );
      eq(
        outputLimits.SUBAGENT_MAX_LINES,
        240,
        "subagent output has its dedicated line limit",
      );
      const compactSubagent =
        outputLimits.limitSubagentOutput("kurzer Bericht");
      eq(
        compactSubagent,
        { text: "kurzer Bericht" },
        "compact subagent output remains unchanged",
      );
      const subagentUtf8 = outputLimits.limitSubagentOutput(
        "HEAD_SUBAGENT_UTF8-" + "😀".repeat(10_000) + "-TAIL_SUBAGENT_UTF8",
      );
      assert(
        subagentUtf8.text.startsWith("HEAD_SUBAGENT_UTF8-") &&
          subagentUtf8.text.endsWith("-TAIL_SUBAGENT_UTF8") &&
          !subagentUtf8.text.includes("\uFFFD") &&
          Buffer.byteLength(subagentUtf8.text, "utf8") <=
            outputLimits.SUBAGENT_MAX_BYTES,
        "subagent UTF-8 truncation is byte-safe and retains head and tail",
      );

      const lspTools = await load("extensions/lsp/tools.ts");
      const lspCwd = mkdtempSync(path.join(tmpdir(), "pi-lsp-output-limit-"));
      try {
        writeFileSync(path.join(lspCwd, "tsconfig.json"), "{}");
        writeFileSync(
          path.join(lspCwd, "large.ts"),
          "export const value = 1;\n",
        );
        const profile = {
          id: "typescript",
          label: "Bounded TypeScript",
          enabled: true,
          command: "unused",
          args: [],
          rootMarkers: ["tsconfig.json"],
        };
        const config = {
          enabled: true,
          mode: "auto",
          requestTimeoutMs: 1000,
          idleShutdownMs: 1000,
          workspaceSymbolLimit: 50,
          languages: { typescript: profile },
        };
        const oversizedError = Array.from(
          { length: outputLimits.DEFAULT_MAX_LINES + 500 },
          (_, index) => `server-error-${index}`,
        ).join("\n");
        const lspHarness = createHarness();
        lspTools.registerLspDiagnosticsTool(lspHarness.api, {
          getConfig: () => config,
          getRegistry: () => ({
            async acquire() {
              throw new Error(oversizedError);
            },
            release() {},
          }),
        });
        const lspResult = await lspHarness.tools
          .get("lsp_diagnostics")
          .execute(
            "large-lsp-result",
            { path: "large.ts" },
            undefined,
            undefined,
            lspHarness.makeContext({ cwd: lspCwd }),
          );
        assert(
          lspResult.content[0].text.includes("[Ausgabe gekürzt:"),
          "LSP text results use the shared visible output boundary",
        );
        eq(
          lspResult.details?.truncation?.strategy,
          "balanced-head-tail",
          "LSP details identify output truncation without hiding semantic metadata",
        );
      } finally {
        rmSync(lspCwd, { recursive: true, force: true });
      }
    });

    // ───────────────── temporary dialogs and narrow terminals ─────────────────
  },

  "ask-user temporary dialog": async (context) => {
    const { section, askUser, askUserPolicy } = context;

    await section("ask-user temporary dialog", async () => {
      if (!askUser || !askUserPolicy) return;
      eq(
        askUserPolicy.hasValidQuestionOptionCount(2),
        true,
        "ask_user accepts two options",
      );
      eq(
        askUserPolicy.hasValidQuestionOptionCount(4),
        true,
        "ask_user accepts four options",
      );
      eq(
        askUserPolicy.hasValidQuestionOptionCount(5),
        false,
        "ask_user rejects five options",
      );
      eq(
        askUserPolicy.digitSelection("2", 2),
        2,
        "direct digit selection works",
      );
      eq(
        askUserPolicy.digitSelection("3", 2),
        undefined,
        "digits never select the custom-input row",
      );

      const harness = createHarness({ columns: 24 });
      askUser.default(harness.api);
      const tool = harness.tools.get("ask_user");
      assert(Boolean(tool), "ask_user is registered");
      if (!tool) return;
      const context = harness.makeContext();
      const params = {
        question:
          "Welche sichere Option soll bei schmalem Terminal gewählt werden?",
        why: "Die Auswahl muss ohne globale UI funktionieren.",
        options: [
          {
            label: "Lesen",
            description: "Nur prüfen.",
            effort: "niedrig",
            risk: "niedrig",
          },
          {
            label: "Planen",
            description: "Einen strukturierten Plan vorbereiten.",
            effort: "mittel",
            risk: "niedrig",
          },
        ],
        recommendedIndex: 2,
        recommendationReason: "Eine klare nächste Entscheidung.",
      };
      const pending = tool.execute(
        "ask-user-test",
        params,
        undefined,
        undefined,
        context,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const component = harness.customComponents.at(-1);
      assert(Boolean(component), "ask_user opens a temporary native dialog");
      if (!component) return;
      assert(
        component.render(24).every((line) => stripAnsi(line).length <= 24),
        "ask_user renders within a narrow 24-column terminal",
      );
      component.handleInput("2");
      const result = await pending;
      eq(
        result.details.answer,
        "Planen",
        "keyboard selection returns the choice",
      );
      eq(result.details.selectedIndex, 2, "selected index remains one-based");
      assertNoGlobalChrome(harness, "ask_user uses no global editor or widget");

      const nonTui = createHarness();
      askUser.default(nonTui.api);
      const nonTuiTool = nonTui.tools.get("ask_user");
      for (const mode of ["json", "print", "rpc"]) {
        const resultForMode = await nonTuiTool.execute(
          "ask-user-non-tui",
          params,
          undefined,
          undefined,
          nonTui.makeContext({ mode, hasUI: false }),
        );
        assert(
          resultForMode.content[0].text.includes(
            "benötigt den interaktiven TUI-Modus",
          ),
          "ask_user returns a structured error in " + mode + " mode",
        );
      }
      eq(
        nonTui.customComponents.length,
        0,
        "ask_user opens no dialog outside TUI",
      );

      // Keyboard navigation and the free-text path. Digit selection above is
      // the shortcut; these are the routes a user takes when the option they
      // want is not one of the first nine, or is not offered at all.
      const ESC = String.fromCharCode(27);
      const KEYS = {
        up: ESC + "[A",
        down: ESC + "[B",
        home: ESC + "[H",
        end: ESC + "[F",
        pageUp: ESC + "[5~",
        pageDown: ESC + "[6~",
        enter: "\r",
        escape: ESC,
        ctrlC: String.fromCharCode(3),
      };

      async function openDialog(id) {
        const dialogHarness = createHarness({ columns: 80 });
        askUser.default(dialogHarness.api);
        const pendingResult = dialogHarness.tools
          .get("ask_user")
          .execute(
            id,
            params,
            undefined,
            undefined,
            dialogHarness.makeContext(),
          );
        await new Promise((resolve) => setTimeout(resolve, 0));
        return {
          harness: dialogHarness,
          pending: pendingResult,
          dialog: dialogHarness.customComponents.at(-1),
        };
      }

      {
        // End jumps past the real options onto the free-text entry, Enter opens
        // it, and Escape leaves edit mode without ending the dialog.
        const { pending, dialog } = await openDialog("ask-user-freetext");
        dialog.handleInput(KEYS.end);
        dialog.handleInput(KEYS.enter);
        const editing = stripAnsi(dialog.render(80).join("\n"));
        dialog.handleInput(KEYS.escape);
        assert(
          stripAnsi(dialog.render(80).join("\n")) !== editing,
          "Escape leaves the free-text editor instead of closing the dialog",
        );
        dialog.handleInput(KEYS.home);
        dialog.handleInput(KEYS.enter);
        const result = await pending;
        eq(
          result.details.answer,
          "Lesen",
          "Home returns to the first option and Enter selects it",
        );
      }

      {
        // Down/up/pageDown/pageUp all move within bounds; the dialog must not
        // run off either end.
        const { pending, dialog } = await openDialog("ask-user-navigation");
        dialog.handleInput(KEYS.pageUp);
        dialog.handleInput(KEYS.up);
        dialog.handleInput(KEYS.down);
        dialog.handleInput(KEYS.pageDown);
        dialog.handleInput(KEYS.pageDown);
        dialog.handleInput(KEYS.up);
        dialog.handleInput(KEYS.enter);
        const result = await pending;
        eq(
          result.details.answer,
          "Planen",
          "navigation stays inside the option list and selects the second entry",
        );
      }

      for (const [key, label] of [
        [KEYS.escape, "Escape"],
        [KEYS.ctrlC, "Ctrl+C"],
      ]) {
        const { pending, dialog } = await openDialog("ask-user-cancel");
        dialog.handleInput(key);
        const result = await pending;
        assert(
          result.isError === true ||
            /abgebrochen|cancel/i.test(result.content[0].text),
          `${label} cancels the dialog instead of answering it`,
        );
      }
    });
  },

  "Aurora UI lifecycle and responsive surfaces": async (context) => {
    const { section, load, auroraUi, auroraFooter } = context;

    await section("Aurora UI lifecycle and responsive surfaces", async () => {
      if (!auroraUi) return;
      const harness = createHarness({ sessionName: "aurora-test" });
      auroraUi.default(harness.api);

      // Stands in for permissions/session-state.ts, the only extension that knows
      // the permission mode. Aurora seeds no label of its own any more, so without
      // a provider the footer must say so rather than invent one.
      harness.api.events.on("aurora-ui/state/request", (value) => {
        if (value?.requester !== "aurora-ui") return;
        harness.api.events.emit("aurora-ui/state/snapshot", {
          type: "snapshot",
          requestId: value.requestId,
          sessionEpoch: value.sessionEpoch,
          source: "permissions-test-provider",
          state: {
            workflow: {
              phase: "detailed_plan",
              label: "Architekturplan",
              completed: 1,
              total: 3,
            },
            permissions: { level: "project-write", label: "Projekt schreiben" },
          },
        });
      });

      const context = harness.makeContext({
        cwd: path.join(homedir(), "projects", "aurora-test"),
      });
      const discovered = await harness.runHooks(
        "resources_discover",
        {},
        context,
      );
      assert(
        discovered.some((entry) =>
          entry?.themePaths?.some((value) =>
            value.endsWith("aurora-night.json"),
          ),
        ),
        "Aurora exposes its theme through resource discovery",
      );
      await harness.runHooks("session_start", {}, context);
      eq(
        context.ui.theme.name,
        "aurora-night",
        "Aurora activates its central theme",
      );
      eq(
        harness.chrome,
        { footer: 1, editor: 1, widget: 1, header: 0 },
        "Aurora is the single custom chrome owner",
      );
      assert(
        Boolean(harness.footerFactory),
        "Aurora installs a footer factory",
      );
      assert(
        Boolean(harness.editorFactory),
        "Aurora installs an editor factory",
      );

      // A second consumer asks for the current state. Aurora answers on the
      // snapshot channel — the contract aurora-ui/README.md documents.
      {
        const answers = [];
        const stopListening = harness.api.events.on(
          "aurora-ui/state/snapshot",
          (value) => {
            if (value?.source === "aurora-ui") answers.push(value);
          },
        );
        const request = harness.emitted.find(
          (entry) => entry.name === "aurora-ui/state/request",
        )?.event;
        assert(Boolean(request), "Aurora announces a session epoch on start");
        harness.api.events.emit("aurora-ui/state/request", {
          type: "request",
          requestId: "control-center:1",
          sessionEpoch: request?.sessionEpoch,
          requester: "control-center",
        });
        eq(
          answers.length,
          1,
          "Aurora answers a foreign state request exactly once",
        );
        eq(
          answers[0]?.requestId,
          "control-center:1",
          "the snapshot carries the requester's id",
        );
        harness.api.events.emit("aurora-ui/state/request", {
          type: "request",
          requestId: "stale:1",
          sessionEpoch: "epoch-from-a-previous-session",
          requester: "control-center",
        });
        eq(answers.length, 1, "Aurora ignores a request from a stale epoch");
        stopListening?.();
      }

      if (harness.footerFactory) {
        let onBranchChange;
        const footer = harness.footerFactory(
          { requestRender() {} },
          context.ui.theme,
          {
            getGitBranch: () => "feature/aurora",
            getExtensionStatuses: () =>
              new Map([
                ["workflow", "ARBEIT 1/3"],
                ["permissions", "Read + Write"],
                ["lsp", "ready"],
              ]),
            onBranchChange: (listener) => {
              onBranchChange = listener;
              return () => {
                onBranchChange = undefined;
              };
            },
          },
        );
        for (const width of [60, 90, 140]) {
          assert(
            footer
              .render(width)
              .every((line) => stripAnsi(line).length <= width),
            `Aurora footer fits ${width} columns`,
          );
        }
        assert(
          stripAnsi(footer.render(140)[0]).includes(
            `~${path.sep}projects${path.sep}aurora-test`,
          ),
          "Aurora footer shows the current directory as a compact home-relative path",
        );

        const wide = stripAnsi(footer.render(140)[0]);
        const narrow = stripAnsi(footer.render(60)[0]);

        // The permission mode comes from the Aurora bus. The "permissions" status
        // key carries a risk banner sized for dialogs, not for a footer segment.
        assert(
          wide.includes("Projekt schreiben") && !wide.includes("Read + Write"),
          "Aurora footer shows the permission mode from the bus, not the status banner",
        );
        assert(
          narrow.includes("Projekt schreiben"),
          "the permission mode survives the narrowest layout",
        );

        // Segments give up their place whole rather than being shaved off at the
        // edge, so what remains stays readable.
        assert(
          wide.includes("Denken") && !narrow.includes("Denken"),
          "Aurora footer drops the thinking segment before it crowds a narrow line",
        );

        // The editor frame is the only surface allowed to show workflow status
        // (decision 009). The footer must never echo the "workflow" status key,
        // even in the wide layout that has room for it.
        assert(
          !wide.includes("ARBEIT 1/3"),
          "Aurora footer no longer duplicates the workflow status from the editor frame",
        );

        // renderPill's bracket fallback fired on every render because "pillBg" is
        // not a key the Pi theme schema knows.
        assert(
          !/[[\]]/.test(wide) && !/[[\]]/.test(narrow),
          "Aurora footer segments are colored, not bracketed",
        );
        assert(
          !wide.includes(" · ") && !narrow.includes(" · "),
          "Aurora footer never falls back to an unstyled separator",
        );

        const wideLines = footer.render(140).map(stripAnsi);
        eq(
          wideLines.filter((line) => line.includes("Kontext")).length,
          1,
          "context is reported exactly once, on the second wide line",
        );
        assert(
          !wideLines.some((line) => line.includes("Konf ")),
          "the second footer line spells out Kontext",
        );
        const readsAfterFirstWideRender = harness.branchReads;
        footer.render(140);
        eq(
          harness.branchReads,
          readsAfterFirstWideRender,
          "Aurora reuses token totals across unchanged footer renders",
        );
        onBranchChange?.();
        footer.render(140);
        eq(
          harness.branchReads,
          readsAfterFirstWideRender + 1,
          "Aurora recomputes token totals exactly once after a branch change",
        );
        footer.dispose?.();
      }

      {
        const responsiveInput = {
          state: {
            sessionEpoch: "responsive-test",
            workflow: { phase: "work", label: "Work" },
            permissions: { level: "confirm-all", label: "Alles bestätigen" },
            lsp: { state: "eingeschränkt" },
            model: { id: "aurora-test-model", thinking: "hoch" },
            activity: { kind: "idle", activeTools: 0 },
          },
          statuses: new Map(),
          branch: "feature/aurora",
          cwd: path.join(homedir(), "projects", "aurora-test"),
          sessionName: "aurora-test",
          tokens: { input: 1_000, output: 500 },
          contextPercent: 92,
        };
        const narrow = auroraFooter
          .renderFooterLines(context.ui.theme, 60, responsiveInput)
          .map(stripAnsi)
          .join("\n");
        const normal = auroraFooter
          .renderFooterLines(context.ui.theme, 90, {
            ...responsiveInput,
            state: { ...responsiveInput.state, lsp: { state: "ready" } },
            contextPercent: 40,
          })
          .map(stripAnsi)
          .join("\n");
        assert(
          narrow.includes("Alles bestätigen") &&
            narrow.includes("LSP eingeschränkt") &&
            narrow.includes("Kontext 92%") &&
            !narrow.includes("aurora-test-model"),
          "the narrow footer protects permissions and warnings before model metadata",
        );
        assert(
          normal.includes("aurora-test-model") &&
            normal.includes("LSP ready") &&
            normal.includes("Kontext 40%"),
          "the normal footer adds model and routine diagnostics",
        );

        // setup-core publishes the verification status via setStatus; Aurora
        // replaces the runtime footer wholesale, so this is the only surface
        // that can render it. It used to be computed and then dropped.
        const withVerification = (value, extra) => ({
          ...responsiveInput,
          ...extra,
          statuses: new Map([["verification", value]]),
        });
        const quiet = {
          state: { ...responsiveInput.state, lsp: { state: "ready" } },
          contextPercent: 10,
        };
        const failedNarrow = auroraFooter
          .renderFooterLines(
            context.ui.theme,
            60,
            withVerification("Verify: checks_failed", quiet),
          )
          .map(stripAnsi)
          .join("\n");
        const cleanNarrow = auroraFooter
          .renderFooterLines(
            context.ui.theme,
            60,
            withVerification("Verify: clean", quiet),
          )
          .map(stripAnsi)
          .join("\n");
        const verifiedNormal = auroraFooter
          .renderFooterLines(
            context.ui.theme,
            90,
            withVerification("Verify: verified", quiet),
          )
          .map(stripAnsi)
          .join("\n");
        const staleWide = auroraFooter
          .renderFooterLines(
            context.ui.theme,
            140,
            withVerification("Verify: changed_unverified", quiet),
          )
          .map(stripAnsi)
          .join("\n");
        assert(
          failedNarrow.includes("Verify checks_failed"),
          "a failing verification status claims space even in the narrow footer",
        );
        assert(
          !cleanNarrow.includes("Verify"),
          "a clean workspace does not spend narrow footer space on a verify segment",
        );
        assert(
          verifiedNormal.includes("Verify verified"),
          "the normal footer renders the routine verification status",
        );
        assert(
          staleWide.includes("Verify changed_unverified"),
          "the wide footer renders the verification status next to LSP",
        );

        const auroraTools = await load(
          "extensions/aurora-ui/tool-renderers.ts",
        );
        const activeTools = ["read", "grep", "bash", "edit"].map(
          (name, index) => ({
            id: `${name}-${index}`,
            name,
            startedAt: 0,
          }),
        );
        const narrowTools = auroraTools
          .renderActiveTools(activeTools, context.ui.theme, 60, 5_000)
          .map(stripAnsi);
        const normalTools = auroraTools
          .renderActiveTools(activeTools, context.ui.theme, 90, 5_000)
          .map(stripAnsi);
        assert(
          narrowTools.length === 2 &&
            narrowTools.at(-1)?.includes("+3 weitere Tools"),
          "the narrow activity surface discloses hidden parallel tools",
        );
        assert(
          normalTools.length === 4 &&
            normalTools.at(-1)?.includes("+1 weitere Tools"),
          "the normal activity surface discloses its remaining parallel tool",
        );
      }

      // Aurora owns the compact, live subagent summary in the footer. Rendering no
      // subagents must leave the rest of the footer intact.
      {
        const footerState = {
          sessionEpoch: "test-epoch",
          workflow: { phase: "arbeit", label: "ARBEIT" },
          permissions: { label: "Read + Write" },
          lsp: { state: "ready" },
          model: { id: "claude-opus-5", thinking: "aus" },
          activity: { kind: "idle", activeTools: 0 },
        };
        const footerInput = (subagents) => ({
          state: footerState,
          statuses: new Map(),
          branch: null,
          cwd: process.cwd(),
          sessionName: undefined,
          tokens: { input: 0, output: 0 },
          contextPercent: null,
          subagents,
        });
        const withSubagents = auroraFooter
          .renderFooterLines(
            context.ui.theme,
            140,
            footerInput([
              { agent: "reviewer", status: "needs_attention" },
              { agent: "worker", status: "running" },
            ]),
          )
          .map(stripAnsi)
          .join("\n");
        const handedOver = auroraFooter
          .renderFooterLines(context.ui.theme, 140, footerInput(undefined))
          .map(stripAnsi)
          .join("\n");
        assert(
          withSubagents.includes("2 Subagenten aktiv") &&
            withSubagents.includes("reviewer"),
          "Aurora footer reports active subagents",
        );
        assert(
          !handedOver.includes("Subagent") && !handedOver.includes("reviewer"),
          "Aurora footer omits the subagent line when there are none",
        );
        assert(
          handedOver.length > 0 && handedOver.includes("Read + Write"),
          "handing the subagent segment over leaves the rest of the footer intact",
        );
        const overflow = auroraFooter
          .renderFooterLines(
            context.ui.theme,
            124,
            footerInput([
              {
                agent: "very-long-investigator-name",
                phase: "very-long-analysis-phase",
                status: "running",
              },
              {
                agent: "very-long-debugger-name",
                phase: "very-long-analysis-phase",
                status: "running",
              },
              {
                agent: "very-long-verifier-name",
                phase: "very-long-analysis-phase",
                status: "running",
              },
              {
                agent: "very-long-review-name",
                phase: "very-long-analysis-phase",
                status: "running",
              },
            ]),
          )
          .map(stripAnsi)
          .join("\n");
        assert(
          overflow.includes("+1 weitere"),
          "the subagent overflow count survives long names in the compact wide footer",
        );
      }

      // The pure function contract above only proves renderFooterLines() itself
      // behaves correctly. This proves the actual wiring: with the real, pinned
      // `extensions/subagent/config.json` (`ui.fleetView: true`), the running
      // extension must read that file at session_start and hand the segment
      // over end-to-end — not just when a test constructs the input by hand.
      {
        const dockHarness = createHarness();
        auroraUi.default(dockHarness.api);
        dockHarness.api.events.on("subagents:rpc:v1:request", (request) => {
          dockHarness.api.events.emit(
            `subagents:rpc:v1:reply:${request.requestId}`,
            {
              success: true,
              data: {
                text: "Active async runs: 1\n\n- async-test | running | single | steps 1 | /tmp",
              },
            },
          );
        });
        const dockContext = dockHarness.makeContext();
        await dockHarness.runHooks("session_start", {}, dockContext);
        const dockFooter = dockHarness.footerFactory?.(
          { requestRender() {} },
          dockContext.ui.theme,
          {
            getGitBranch: () => null,
            getExtensionStatuses: () => new Map(),
            onBranchChange: () => () => {},
          },
        );
        await dockHarness.runHooks(
          "tool_execution_start",
          {
            toolCallId: "foreground-subagent",
            toolName: "subagent",
            args: { agent: "worker" },
          },
          dockContext,
        );
        dockFooter?.render(140);
        await Promise.resolve();
        await Promise.resolve();
        const dockRendered =
          dockFooter?.render(140).map(stripAnsi).join("\n") ?? "";
        assert(
          !dockRendered.includes("worker") &&
            !dockRendered.includes("async-test") &&
            !dockRendered.includes("Subagent"),
          "with the real pinned config, the Fleet Status Dock owns the subagent segment end-to-end and the footer shows none of it",
        );
        await dockHarness.runHooks("session_shutdown", {}, dockContext);
      }

      // The editor frame carries workflow and step only. Everything durable moved
      // to the footer, so a status value must never appear on both surfaces.
      if (harness.editorFactory) {
        const identity = (value) => value;
        const editor = harness.editorFactory(
          {
            requestRender() {},
            write() {},
            terminal: { rows: 40, columns: 140 },
          },
          {
            borderColor: identity,
            selectList: {
              text: identity,
              selectedText: identity,
              description: identity,
              scrollIndicator: identity,
            },
          },
          { onAction() {}, get: () => undefined },
        );
        const framed = editor.render(140).map(stripAnsi);
        const frame = framed.find((line) => line.startsWith("╭"));
        assert(
          Boolean(frame),
          "the editor keeps exactly one frame line on top",
        );
        assert(
          !framed.some((line) => line.startsWith("╰")),
          "the lower frame line is gone with the values it used to carry",
        );
        assert(
          frame?.includes("Architekturplan · 1/3"),
          "the editor frame names the workflow and its structured progress",
        );
        for (const duplicated of ["Denken", "Kontext", "aurora-test-model"]) {
          assert(
            !frame?.includes(duplicated),
            `the editor frame leaves ${duplicated} to the footer`,
          );
        }
        editor.dispose?.();
      }

      await harness.runHooks("agent_start", {}, context);
      eq(
        harness.workingVisibility.at(-1),
        false,
        "Aurora keeps the native working indicator hidden while its activity widget owns live status",
      );
      await harness.runHooks(
        "tool_execution_start",
        {
          toolCallId: "tool-aurora",
          toolName: "read",
          args: { path: "README.md" },
        },
        context,
      );
      const widget = harness.widgets.get("aurora-ui/activity")?.content;
      assert(
        typeof widget === "function",
        "Aurora activity widget is transient and component-backed",
      );
      if (typeof widget === "function") {
        const component = widget({ requestRender() {} }, context.ui.theme);
        assert(
          component.render(60).length >= 1,
          "Aurora activity renders in a narrow terminal",
        );
        // The widget is Aurora's only live-work surface; the native indicator
        // remains hidden so the editor does not show two competing signals.
        eq(
          harness.workingVisibility.at(-1),
          false,
          "the native working indicator remains hidden while a tool runs",
        );
        assert(
          stripAnsi(component.render(60)[0]).includes("Tool"),
          "the specific activity text lives only in the activity widget",
        );
        component.invalidate?.();
        component.dispose?.();
      }

      for (const motion of ["reduced", "off"]) {
        const workspace = mkdtempSync(path.join(tmpdir(), "aurora-motion-"));
        try {
          mkdirSync(path.join(workspace, ".pi"));
          writeFileSync(
            path.join(workspace, ".pi", "setup.json"),
            JSON.stringify({ ui: { motion } }),
          );
          const motionHarness = createHarness();
          auroraUi.default(motionHarness.api);
          const motionContext = motionHarness.makeContext({
            cwd: workspace,
            trusted: true,
          });
          await motionHarness.runHooks("session_start", {}, motionContext);
          await motionHarness.runHooks("agent_start", {}, motionContext);
          const motionWidget =
            motionHarness.widgets.get("aurora-ui/activity")?.content;
          const rendered =
            typeof motionWidget === "function"
              ? motionWidget({ requestRender() {} }, motionContext.ui.theme)
                  .render(60)
                  .map(stripAnsi)
                  .join("\n")
              : "";
          assert(
            rendered.includes("Analysiert die Aufgabe"),
            `Aurora keeps its activity label visible with ${motion} motion`,
          );
          if (motion === "reduced")
            assert(
              rendered.includes("●"),
              "reduced motion uses a static activity marker",
            );
          else
            assert(
              !rendered.includes("●"),
              "off motion keeps activity text without a marker",
            );
          eq(
            motionHarness.workingVisibility.at(-1),
            false,
            `${motion} motion leaves the native working indicator hidden`,
          );
          await motionHarness.runHooks("session_shutdown", {}, motionContext);
        } finally {
          rmSync(workspace, { recursive: true, force: true });
        }
      }

      // A turn that ends while a tool is still registered must not leave the
      // activity surface claiming work. agent_end and agent_settled share one
      // handler, so both have to clear it.
      await harness.runHooks("agent_end", {}, context);
      eq(
        harness.workingVisibility.at(-1),
        false,
        "Aurora settles the activity surface when the turn ends",
      );
      eq(
        harness.widgets
          .get("aurora-ui/activity")
          ?.content({ requestRender() {} }, context.ui.theme)
          .render(140).length,
        0,
        "the activity widget renders nothing once the turn has settled",
      );
      {
        // This footer-level tracking (foreground subagents from tool-call args,
        // async runs from the RPC reply) is what the footer falls back to when
        // the Fleet Status Dock does not own the subagent display. With the
        // pinned config's `ui.fleetView: true`, the dock owns it and the footer
        // must show nothing here (see the handover test above) — so this block
        // pins the real repo config to `fleetView: false` for its duration to
        // exercise the tracking mechanism itself, then restores the real file.
        const subagentConfigPath = path.join(
          ROOT,
          "extensions",
          "subagent",
          "config.json",
        );
        const originalSubagentConfig = readFileSync(subagentConfigPath, "utf8");
        try {
          writeFileSync(
            subagentConfigPath,
            JSON.stringify(
              {
                ...JSON.parse(originalSubagentConfig),
                ui: {
                  ...JSON.parse(originalSubagentConfig).ui,
                  fleetView: false,
                },
              },
              null,
              2,
            ),
          );
          const footerHarness = createHarness();
          auroraUi.default(footerHarness.api);
          footerHarness.api.events.on("subagents:rpc:v1:request", (request) => {
            footerHarness.api.events.emit(
              `subagents:rpc:v1:reply:${request.requestId}`,
              {
                success: true,
                data: {
                  text: "Active async runs: 1\n\n- async-test | running | single | steps 1 | /tmp",
                },
              },
            );
          });
          const footerContext = footerHarness.makeContext();
          await footerHarness.runHooks("session_start", {}, footerContext);
          const footer = footerHarness.footerFactory?.(
            { requestRender() {} },
            footerContext.ui.theme,
            {
              getGitBranch: () => null,
              getExtensionStatuses: () => new Map(),
              onBranchChange: () => () => {},
            },
          );
          footer?.render(140);
          await Promise.resolve();
          await Promise.resolve();
          footer?.invalidate?.();
          assert(
            footer
              ?.render(140)
              .some((line) => stripAnsi(line).includes("async-test")),
            "Aurora renders active async runs from the pinned RPC response shape",
          );
          await footerHarness.runHooks(
            "tool_execution_start",
            {
              toolCallId: "foreground-subagent",
              toolName: "subagent",
              args: { agent: "worker" },
            },
            footerContext,
          );
          assert(
            footer
              ?.render(140)
              .some((line) => stripAnsi(line).includes("worker")),
            "Aurora renders a running foreground subagent immediately",
          );
          await footerHarness.runHooks(
            "tool_execution_end",
            { toolCallId: "foreground-subagent", toolName: "subagent" },
            footerContext,
          );
          assert(
            !footer
              ?.render(140)
              .some((line) => stripAnsi(line).includes("worker")),
            "Aurora removes a foreground subagent when its tool call ends",
          );
          await footerHarness.runHooks("session_shutdown", {}, footerContext);
        } finally {
          writeFileSync(subagentConfigPath, originalSubagentConfig);
        }
      }

      await harness.runHooks("session_shutdown", {}, context);
      eq(harness.widgets.size, 0, "Aurora removes its widget on shutdown");
      eq(
        harness.workingVisibility.at(-1),
        false,
        "Aurora hides activity on shutdown",
      );
      eq(
        context.ui.theme.name,
        "test-theme",
        "Aurora restores the previous theme on shutdown",
      );
    });
  },

  "combined production extension stack": async (context) => {
    const {
      section,
      modePermissions,
      planMode,
      controlPlane,
      diffViewer,
      askUser,
      lspExtensionMod,
      setupCore,
      auroraUi,
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
        !auroraUi
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
        "+extensions/aurora-ui/index.ts": auroraUi.default,
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
        { footer: 1, editor: 1, widget: 1, header: 0 },
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
          "lsp_definition",
          "lsp_diagnostics",
          "lsp_hover",
          "lsp_references",
          "lsp_workspace_symbols",
          "project_check",
          "verify",
        ],
        "only local functional tools register locally",
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
