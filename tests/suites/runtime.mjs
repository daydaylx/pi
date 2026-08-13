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
import { pathToFileURL } from "node:url";
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
            "+extensions/resilience/index.ts",
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
          "+extensions/resilience/index.ts",
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
              "Aurora owns one shared activity ticker",
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
          undefined,
          "reduced harness config exposes no inactive parallel task surface",
        );
        eq(
          subagentConfig.globalConcurrencyLimit,
          undefined,
          "reduced harness config exposes no inactive global concurrency limit",
        );
        eq(
          subagentConfig.maxSubagentSpawnsPerSession,
          5,
          "active package config directly bounds spawns per session",
        );
        // The reduced parameter surface is registered by toolSchemaMode alone.
        // toolDescriptionMode only replaces the visible description text.
        eq(
          subagentConfig.toolSchemaMode,
          "harness",
          "the reduced tool surface is requested explicitly",
        );
        eq(
          subagentConfig.toolDescriptionMode,
          "custom",
          "the visible tool description stays project-owned",
        );
        // Nothing in the active harness consumes a subagent concurrency
        // baseline any more, so keeping one would be configuration without a
        // runtime consumer.
        assert(
          !Object.hasOwn(setup, "subagents"),
          "setup.json carries no dead subagent parallelism baseline",
        );
        assert(
          !Object.hasOwn(schema.properties, "subagents"),
          "setup schema carries no dead subagent parallelism baseline",
        );
        assert(
          !schema.required.includes("subagents"),
          "setup schema no longer requires a subagent section",
        );
        // Verify installer ALLOWLIST covers every active extension's
        // runtime imports (no string-grep; real structural assertions).
        const { ALLOWLIST, NEVER_COPY, NEVER_COPY_SUBTREE, LEGACY_MANAGED } =
          await import(
            pathToFileURL(path.join(ROOT, "scripts", "install-user.mjs")).href
          );
        assert(
          Array.isArray(ALLOWLIST) && ALLOWLIST.length > 0,
          "installer has a non-empty ALLOWLIST",
        );
        const requiredAllowlist = [
          "shared",
          "subagent-tool-description.md",
          "extensions",
          "agents",
          "scripts",
          "tests",
        ];
        for (const entry of requiredAllowlist) {
          assert(
            ALLOWLIST.includes(entry),
            `installer ALLOWLIST includes ${entry}`,
          );
        }
        assert(
          NEVER_COPY.has("auth.json") &&
            NEVER_COPY.has("sessions") &&
            NEVER_COPY.has("backups") &&
            NEVER_COPY.has(".git") &&
            NEVER_COPY.has("node_modules"),
          "installer NEVER_COPY protects auth, sessions, backups, .git, node_modules",
        );
        assert(
          NEVER_COPY_SUBTREE.has("docs/archive/session-logs"),
          "installer excludes docs/archive/session-logs from user installations",
        );
        assert(
          Array.isArray(LEGACY_MANAGED) && LEGACY_MANAGED.length > 0,
          "installer declares known legacy managed paths for upgrade cleanup",
        );
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

  "installer greenfield deployment": async (context) => {
    const { section } = context;
    await section("installer greenfield deployment", async () => {
      const { ALLOWLIST, NEVER_COPY, NEVER_COPY_SUBTREE, SOURCE, collect } =
        await import(
          pathToFileURL(path.join(ROOT, "scripts", "install-user.mjs")).href
        );

      // Greenfield: collect all files the installer would deploy, then
      // verify the target can resolve every active extension's imports.
      const deployed = ALLOWLIST.flatMap((entry) => {
        const absolute = path.join(SOURCE, entry);
        return existsSync(absolute) ? collect(SOURCE, entry) : [];
      });

      const deployedSet = new Set(deployed);

      // shared/workspace-snapshot.mjs is required by setup-core at runtime.
      assert(
        deployedSet.has("shared/workspace-snapshot.mjs"),
        "greenfield includes shared/workspace-snapshot.mjs",
      );

      // Custom subagent description must be installed.
      assert(
        deployedSet.has("subagent-tool-description.md"),
        "greenfield includes the agent-level custom subagent description",
      );
      assert(
        !deployedSet.has(".pi/subagent-tool-description.md"),
        "greenfield does not deploy the retired agent-shipped .pi description",
      );

      // Exactly three agent profiles.
      const agentFiles = deployed.filter((f) => f.startsWith("agents/"));
      eq(
        agentFiles.length,
        3,
        "greenfield installs exactly three agent profiles",
      );
      for (const role of ["investigator.md", "debugger.md", "verifier.md"]) {
        assert(
          deployedSet.has(`agents/${role}`),
          `greenfield includes agents/${role}`,
        );
      }

      // No legacy agent profiles.
      for (const legacy of ["planner.md", "worker.md", "reviewer.md"]) {
        assert(
          !deployedSet.has(`agents/${legacy}`),
          `greenfield does not include legacy agents/${legacy}`,
        );
      }

      // Archive session logs must not be deployed. Match on a path boundary,
      // not a raw string prefix - docs/archive/session-logs.md is a policy
      // note (not a log), and a plain startsWith() would false-positive on
      // it merely because it shares a prefix with the excluded directory.
      const archiveFiles = deployed.filter(
        (f) =>
          f === "docs/archive/session-logs" ||
          f.startsWith("docs/archive/session-logs/"),
      );
      eq(
        archiveFiles.length,
        0,
        "greenfield excludes docs/archive/session-logs",
      );

      // Security: NEVER_COPY entries must not appear in deployed files.
      for (const forbidden of NEVER_COPY) {
        const violations = deployed.filter(
          (f) => f.startsWith(forbidden + "/") || f === forbidden,
        );
        eq(
          violations.length,
          0,
          `greenfield excludes NEVER_COPY entry ${forbidden}`,
        );
      }

      // Security: NEVER_COPY_SUBTREE entries must not appear. Path-boundary
      // match, same reasoning as the docs/archive/session-logs check above.
      for (const subtree of NEVER_COPY_SUBTREE) {
        const violations = deployed.filter(
          (f) => f === subtree || f.startsWith(subtree + "/"),
        );
        eq(
          violations.length,
          0,
          `greenfield excludes NEVER_COPY_SUBTREE entry ${subtree}`,
        );
      }

      // Verify real deployment to a temporary target works.
      const target = mkdtempSync(path.join(tmpdir(), "pi-install-greenfield-"));
      try {
        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts", "install-user.mjs"),
            "--apply",
            "--target",
            target,
          ],
          { stdio: "pipe", timeout: 30_000 },
        );

        // shared/ must exist and be importable.
        const snapshotPath = path.join(
          target,
          "shared",
          "workspace-snapshot.mjs",
        );
        assert(
          existsSync(snapshotPath),
          "deployed target contains shared/workspace-snapshot.mjs",
        );

        // Custom subagent description.
        assert(
          existsSync(path.join(target, "subagent-tool-description.md")),
          "deployed target contains the agent-level custom subagent description",
        );
        assert(
          !existsSync(path.join(target, ".pi", "subagent-tool-description.md")),
          "deployed target has no retired agent-shipped .pi description",
        );

        // Exactly three agents.
        const deployedAgents = readdirSync(path.join(target, "agents")).filter(
          (f) => f.endsWith(".md"),
        );
        eq(
          deployedAgents.length,
          3,
          "deployed target has exactly three agent profiles",
        );

        // No archive session logs.
        const archivePath = path.join(
          target,
          "docs",
          "archive",
          "session-logs",
        );
        assert(
          !existsSync(archivePath),
          "deployed target does not contain docs/archive/session-logs",
        );
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    });
  },

  "installer upgrade deployment": async (context) => {
    const { section } = context;
    await section("installer upgrade deployment", async () => {
      const { LEGACY_MANAGED } = await import(
        pathToFileURL(path.join(ROOT, "scripts", "install-user.mjs")).href
      );

      const target = mkdtempSync(path.join(tmpdir(), "pi-install-upgrade-"));
      try {
        // Pre-populate a target with known legacy agent profiles and one
        // user-owned file.
        mkdirSync(path.join(target, "agents"), { recursive: true });
        writeFileSync(
          path.join(target, "agents", "planner.md"),
          "# legacy planner",
        );
        writeFileSync(
          path.join(target, "agents", "worker.md"),
          "# legacy worker",
        );
        writeFileSync(
          path.join(target, "agents", "reviewer.md"),
          "# legacy reviewer",
        );
        const legacyDescription = path.join(
          target,
          ".pi",
          "subagent-tool-description.md",
        );
        mkdirSync(path.dirname(legacyDescription), { recursive: true });
        writeFileSync(legacyDescription, "# legacy installer description");
        // Aurora dropped its editor component; an older install still carries
        // the file, and the upgrade has to remove it rather than orphan it.
        const legacyEditor = path.join(
          target,
          "extensions",
          "aurora-ui",
          "editor.ts",
        );
        mkdirSync(path.dirname(legacyEditor), { recursive: true });
        writeFileSync(legacyEditor, "// legacy Aurora editor");
        const userFile = path.join(target, "agents", "custom-user-agent.md");
        writeFileSync(userFile, "# user-owned custom agent");

        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts", "install-user.mjs"),
            "--apply",
            "--target",
            target,
          ],
          { stdio: "pipe", timeout: 30_000 },
        );

        // Legacy managed files must be gone.
        for (const legacy of LEGACY_MANAGED) {
          assert(
            !existsSync(path.join(target, legacy)),
            `upgrade removes legacy ${legacy}`,
          );
        }
        assert(
          existsSync(path.join(target, "subagent-tool-description.md")),
          "upgrade installs the current agent-level custom subagent description",
        );

        // User-owned file must survive.
        assert(
          existsSync(userFile),
          "upgrade preserves user-owned file agents/custom-user-agent.md",
        );

        // Current agents are installed.
        for (const role of ["investigator.md", "debugger.md", "verifier.md"]) {
          assert(
            existsSync(path.join(target, "agents", role)),
            `upgrade installs agents/${role}`,
          );
        }
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    });
  },

  "installer security boundaries": async (context) => {
    const { section } = context;
    await section("installer security boundaries", async () => {
      const target = mkdtempSync(path.join(tmpdir(), "pi-install-security-"));
      try {
        // Symlink in target path must be rejected.
        const symDir = mkdtempSync(path.join(tmpdir(), "pi-install-symlink-"));
        const linkPath = path.join(symDir, "link");
        symlinkSync(target, linkPath, "dir");
        try {
          execFileSync(
            process.execPath,
            [
              path.join(ROOT, "scripts", "install-user.mjs"),
              "--apply",
              "--target",
              path.join(linkPath, "sub"),
            ],
            { stdio: "pipe", timeout: 10_000 },
          );
          assert(false, "installer must reject symlink in target path");
        } catch (error) {
          assert(
            error.stderr?.includes("Symlink") ||
              error.message?.includes("Symlink") ||
              error.code !== 0,
            "installer rejects symlink in target path",
          );
        } finally {
          rmSync(symDir, { recursive: true, force: true });
        }

        // Sensitive files must not appear in deployed target.
        const { NEVER_COPY } = await import(
          pathToFileURL(path.join(ROOT, "scripts", "install-user.mjs")).href
        );
        execFileSync(
          process.execPath,
          [
            path.join(ROOT, "scripts", "install-user.mjs"),
            "--apply",
            "--target",
            target,
          ],
          { stdio: "pipe", timeout: 30_000 },
        );
        for (const forbidden of NEVER_COPY) {
          assert(
            !existsSync(path.join(target, forbidden)),
            `deployed target must not contain ${forbidden}`,
          );
        }
      } finally {
        rmSync(target, { recursive: true, force: true });
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
            ?.message?.includes("Pi CLI/dev package: 0.80.7/0.84.1") &&
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
            contextReport.includes("Compaction Trigger: 239232") &&
            contextReport.includes("Reserve Tokens: 32768") &&
            contextReport.includes("Keep Recent Tokens: 12000") &&
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
          const rejected = await rejectedVerify.execute(
            "verify-spawn-failure",
            { check: "typecheck" },
            undefined,
            undefined,
            rejectedContext,
          );
          eq(
            rejected.isError,
            true,
            "verify reports executor startup failures",
          );
          eq(
            rejected.details.exitCode,
            null,
            "verify preserves missing exit code",
          );
          assert(
            rejected.content[0]?.text.includes("spawn ENOENT"),
            "verify returns the bounded executor error as tool output",
          );
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
          const killedResult = await killedVerify.execute(
            "verify-killed",
            { check: "typecheck" },
            undefined,
            undefined,
            killedHarness.makeContext(),
          );
          eq(
            killedResult.isError,
            true,
            "verify never reports a killed process as successful",
          );
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
                { timeout: 100, killGraceMs: 50 },
              );
              eq(
                result.killed,
                true,
                "tracked executor reports the timed-out process tree",
              );
              childPid = Number(readFileSync(pidFile, "utf8"));
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
        await harness.runHooks(
          "agent_settled",
          { type: "agent_settled" },
          trusted,
        );
        eq(
          latestStatus(harness, "verification"),
          "Verify: clean",
          "agent_settled publishes a compact clean technical status",
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
        eq(partial.isError, false, "incomplete coverage is not a tool error");
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

        // P0 regression: a blocking recommended failure and `verified` must
        // never describe the same run.
        lintFails = true;
        const recommended = await runCheck("verification-status-recommended", {
          profile: "lint",
        });
        eq(
          recommended.isError,
          true,
          "a confirmed recommended failure is a tool error",
        );
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
        eq(
          vanishedBinary.isError,
          false,
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
      assert(
        !existsSync(archivedRoot),
        "retired v1 subagent profiles have been cleaned up; only the active 3-role model remains",
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
      // Aurora owns the footer and the activity widget only. The editor stays
      // Pi's own component, so its padding, autocomplete and shortcuts come
      // from the runtime settings rather than from a decorative subclass.
      eq(
        harness.chrome,
        { footer: 1, editor: 0, widget: 1, header: 0 },
        "Aurora is the single custom chrome owner and leaves the editor alone",
      );
      assert(
        Boolean(harness.footerFactory),
        "Aurora installs a footer factory",
      );
      eq(
        harness.editorFactory,
        undefined,
        "Aurora installs no editor component of its own",
      );
      const welcomeWidget = harness.widgets.get("aurora-ui/activity")?.content;
      const welcome =
        typeof welcomeWidget === "function"
          ? welcomeWidget(
              { terminal: { columns: 120, rows: 30 }, requestRender() {} },
              context.ui.theme,
            )
              .render(120)
              .map(stripAnsi)
              .join("\n")
          : "";
      assert(
        welcome.includes("PI · AURORA") &&
          welcome.includes("~/projects/aurora-test"),
        "a fresh session shows the responsive Aurora welcome with its cwd",
      );
      const resumedHarness = createHarness({
        entries: [
          { type: "message", message: { role: "user", content: "resume" } },
        ],
      });
      auroraUi.default(resumedHarness.api);
      const resumedContext = resumedHarness.makeContext();
      await resumedHarness.runHooks("session_start", {}, resumedContext);
      const resumedWidget =
        resumedHarness.widgets.get("aurora-ui/activity")?.content;
      const resumedLines =
        typeof resumedWidget === "function"
          ? resumedWidget(
              { terminal: { columns: 120, rows: 30 }, requestRender() {} },
              resumedContext.ui.theme,
            ).render(120)
          : [];
      eq(resumedLines, [], "a resumed conversation skips the welcome surface");
      await resumedHarness.runHooks("session_shutdown", {}, resumedContext);

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
          const rendered = footer.render(width);
          eq(
            rendered.length,
            1,
            `Aurora footer is a single status line at ${width} columns`,
          );
          assert(
            stripAnsi(rendered[0]).length <= width,
            `Aurora footer fits ${width} columns`,
          );
        }

        const wide = stripAnsi(footer.render(140)[0]);
        const narrow = stripAnsi(footer.render(60)[0]);

        // Decision 009 moved the workflow here: one permanent status surface,
        // and the editor frame that used to carry it is gone.
        assert(
          wide.startsWith("Architekturplan") &&
            narrow.startsWith("Architekturplan"),
          "the workflow label leads the footer at every width",
        );

        // The footer renders runtime state, never the wide risk banner the
        // permission status key publishes for dialogs.
        assert(
          !wide.includes("ARBEIT 1/3") && !wide.includes("Read + Write"),
          "Aurora footer renders runtime state, not status-key banners",
        );

        // A routine permission mode costs nothing; only a risky one speaks up.
        assert(
          !wide.includes("Projekt schreiben") &&
            !narrow.includes("Projekt schreiben"),
          "a routine permission mode does not spend footer space",
        );

        // Segments give up their place whole rather than being shaved off at
        // the edge, so what remains stays readable.
        assert(
          wide.includes("Denken HOCH") && narrow.includes("Denken HOCH"),
          "Aurora retains the explicit thinking segment while the line has room",
        );

        assert(
          !/[\[\]]/.test(wide) && !/[\[\]]/.test(narrow),
          "Aurora footer segments are colored, not bracketed",
        );
        assert(
          !wide.includes(" · ") && !narrow.includes(" · "),
          "Aurora footer never falls back to an unstyled separator",
        );

        // Nothing in the footer walks the session branch any more, so a branch
        // change is a repaint trigger and not a recomputation.
        const readsBeforeBranchChange = harness.branchReads;
        onBranchChange?.();
        footer.render(140);
        eq(
          harness.branchReads,
          readsBeforeBranchChange,
          "the footer never walks the session branch while rendering",
        );

        // The footer caches nothing, so dropping its caches changes nothing.
        const beforeInvalidate = footer.render(140).map(stripAnsi);
        footer.invalidate?.();
        eq(
          footer.render(140).map(stripAnsi),
          beforeInvalidate,
          "the footer holds no cache that invalidation could change",
        );
        footer.dispose?.();
      }

      {
        // Layout assertions must measure terminal cells, so they use the same
        // width function the footer itself does.
        const { visibleWidth } = await import(
          pathToFileURL(
            path.join(
              ROOT,
              "npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js",
            ),
          ).href
        );
        const { LAYOUT_COLUMNS } = await load("extensions/shared/layout.ts");
        const auroraCwd = await load("extensions/aurora-ui/cwd.ts");
        const startscreen = await load("extensions/aurora-ui/startscreen.ts");
        eq(
          auroraCwd.compactCwd(
            path.join(homedir(), "projects", "pi"),
            40,
            homedir(),
          ),
          "~/projects/pi",
          "a home-relative cwd remains readable when it fits",
        );
        eq(
          auroraCwd.compactCwd(
            path.join(homedir(), "projects", "very-long-agent-project", "pi"),
            12,
            homedir(),
          ),
          "~/…/pi",
          "a long home-relative cwd keeps its final directory",
        );
        eq(
          auroraCwd.compactCwd("/", 8, homedir()),
          "/",
          "root cwd stays stable",
        );
        const unicodeCwd = auroraCwd.compactCwd(
          "/srv/项目/aurora",
          10,
          homedir(),
        );
        assert(
          visibleWidth(unicodeCwd) <= 10 && unicodeCwd.endsWith("aurora"),
          "an outside-home Unicode cwd is cell-safe and retains its leaf",
        );
        for (const [columns, rows] of [
          [40, 14],
          [52, 14],
          [90, 28],
          [120, 30],
        ]) {
          const rendered = startscreen.renderStartscreen(context.ui.theme, {
            width: columns,
            rows,
            workflow: "Work",
            model: "aurora-test-model",
            thinking: "high",
            cwd: path.join(homedir(), "projects", "pi"),
            homeDirectory: homedir(),
          });
          assert(
            rendered.every((row) => visibleWidth(row) <= columns),
            `the ${columns}×${rows} startscreen fits its terminal cells`,
          );
          assert(
            rendered.join("\n").includes("~/projects/pi"),
            `the ${columns}×${rows} startscreen keeps the current folder`,
          );
        }
        const footerState = (overrides = {}) => ({
          sessionEpoch: "responsive-test",
          workflow: { phase: "work", label: "Work" },
          permissions: { level: "project-write", label: "Projekt schreiben" },
          lsp: { state: "ready" },
          model: { id: "aurora-test-model", thinking: "high" },
          activity: { kind: "idle" },
          ...overrides,
        });
        const line = (width, input) =>
          stripAnsi(
            auroraFooter.renderFooterLines(context.ui.theme, width, {
              statuses: new Map(),
              contextPercent: null,
              cwd: path.join(
                homedir(),
                "projects",
                "very-long-aurora-project",
                "pi",
              ),
              homeDirectory: homedir(),
              ...input,
              state: footerState(input.state),
            })[0],
          );

        // The information priority from the UX brief, tier by tier.
        const quiet = { contextPercent: 38 };
        assert(
          line(140, quiet).includes("Kontext 38%") &&
            line(140, quiet).includes("HOCH") &&
            line(140, quiet).includes("~/…/pi"),
          "the wide footer shows thinking, folder and context",
        );
        assert(
          line(100, quiet).includes("Kontext 38%") &&
            line(100, quiet).includes("HOCH") &&
            line(100, quiet).includes("~/…/pi"),
          "the comfortable footer drops context before thinking and compacts the folder",
        );
        const standard = line(70, quiet);
        assert(
          standard.includes("Work") &&
            standard.includes("aurora-test-model") &&
            standard.includes("~/…/pi") &&
            standard.includes("Denken HOCH"),
          "the standard footer keeps workflow, model, thinking and folder",
        );
        const compact = line(45, quiet);
        assert(
          compact.includes("Work") && compact.includes("pi"),
          "the compact footer keeps the workflow and final folder name",
        );

        // Risk outranks the tier: these claim space at any width.
        const yolo = { state: { permissions: { level: "yolo" } } };
        for (const width of [45, 70, 100, 140]) {
          assert(
            line(width, yolo).includes("⚠ YOLO"),
            `YOLO displaces routine information at ${width} columns`,
          );
        }
        assert(
          line(45, {
            statuses: new Map([["verification", "Verify: checks_failed"]]),
          }).includes("checks_failed"),
          "a failing verification claims space even in the compact footer",
        );
        assert(
          !line(45, {
            statuses: new Map([["verification", "Verify: clean"]]),
          }).includes("clean"),
          "a clean workspace does not spend compact footer space",
        );
        assert(
          line(100, {
            statuses: new Map([["verification", "Verify: verified"]]),
          }).includes("verified"),
          "the comfortable footer reports a proven workspace",
        );
        assert(
          line(45, { state: { lsp: { state: "eingeschränkt" } } }).includes(
            "LSP eingeschränkt",
          ),
          "a broken language server is reported at any width",
        );
        for (const healthy of ["ready", "leerlauf", "aus", "3 aktiv"]) {
          assert(
            !line(140, { state: { lsp: { state: healthy } } }).includes("LSP"),
            `a language server reporting "${healthy}" stays off the line`,
          );
        }
        // Colour and layout priority are separate. A filling context warns
        // where there is room, but must not push the workflow or the model off
        // a narrow line the way a genuine emergency may.
        for (const columns of [45, 70]) {
          assert(
            !line(columns, { contextPercent: 75 }).includes("Kontext 75%"),
            `a 75% context does not claim space at ${columns} columns`,
          );
        }
        for (const columns of [100, 140]) {
          const filling = line(columns, { contextPercent: 75 });
          assert(
            filling.includes("Kontext 75%"),
            `a 75% context follows the normal tier at ${columns} columns`,
          );
        }
        {
          const warned = auroraFooter.renderFooterLines(context.ui.theme, 140, {
            statuses: new Map(),
            contextPercent: 75,
            state: footerState(),
          })[0];
          assert(
            warned.includes(context.ui.theme.fg("warning", "Kontext 75%")),
            "a 75% context is coloured as a warning where it is shown",
          );
        }

        // Only a nearly exhausted context overrides the tier, at every size.
        for (const columns of [40, 45, 52, 90, 120, 160]) {
          const critical = auroraFooter.renderFooterLines(
            context.ui.theme,
            columns,
            {
              statuses: new Map(),
              contextPercent: 95,
              state: footerState(),
            },
          );
          eq(critical.length, 1, `one line at ${columns} columns`);
          assert(
            stripAnsi(critical[0]).includes("Kontext 95%"),
            `an exhausted context survives the tier at ${columns} columns`,
          );
          assert(
            visibleWidth(critical[0]) <= columns,
            `an exhausted context does not overflow ${columns} columns`,
          );
        }

        // Layout decisions must count terminal cells, not JavaScript
        // characters: `⚠`, `✓` and CJK all occupy more cells than they do
        // string length. Measuring length would let a line "fit" and then be
        // truncated at the edge — losing part of a finished status instead of
        // dropping a whole segment.
        for (const columns of [40, 52, 70, 90, 120]) {
          const wide = auroraFooter.renderFooterLines(
            context.ui.theme,
            columns,
            {
              statuses: new Map([
                ["verification", "Verify: changed_unverified"],
              ]),
              contextPercent: 95,
              state: footerState({
                workflow: { phase: "work", label: "作業モード" },
                model: { id: "模型-统一-推理-大", thinking: "high" },
                permissions: { level: "yolo" },
                lsp: { state: "eingeschränkt" },
              }),
            },
          );
          eq(wide.length, 1, `wide glyphs stay on one line at ${columns}`);
          const rendered = wide[0];
          assert(
            visibleWidth(rendered) <= columns,
            `wide glyphs never overflow ${columns} terminal cells`,
          );
          // Whatever survived is intact — the ellipsis would mean a segment was
          // shaved at the edge instead of being dropped whole.
          assert(
            !stripAnsi(rendered).includes("…"),
            `segments are dropped whole rather than truncated at ${columns}`,
          );
        }

        // The responsive matrix from the UX brief. Every size gets the loudest
        // possible state, so nothing can fit by being empty.
        for (const columns of [40, 51, 52, 80, 89, 90, 119, 120, 160]) {
          for (const input of [quiet, yolo]) {
            const rendered = auroraFooter.renderFooterLines(
              context.ui.theme,
              columns,
              {
                statuses: new Map([
                  ["verification", "Verify: changed_unverified"],
                ]),
                contextPercent: 88,
                cwd: path.join(
                  homedir(),
                  "projects",
                  "very-long-aurora-project",
                  "pi",
                ),
                homeDirectory: homedir(),
                ...input,
                state: footerState(input.state),
              },
            );
            eq(
              rendered.length,
              1,
              `the footer stays a single line at ${columns} columns`,
            );
            assert(
              stripAnsi(rendered[0]).length <= columns,
              `the footer never overflows ${columns} columns`,
            );
          }
        }

        const auroraTools = await load(
          "extensions/aurora-ui/tool-renderers.ts",
        );
        for (const [name, label] of [
          ["read", "Lesen"],
          ["grep", "Suchen"],
          ["edit", "Bearbeiten"],
          ["bash", "Shell"],
          ["verify", "Prüfen"],
          ["subagent", "Subagent"],
          ["unknown_tool", "Werkzeug · unknown_tool"],
        ]) {
          eq(
            auroraTools.toolPresentation(name).label,
            label,
            `${name} uses its German Aurora presentation label`,
          );
        }
        const genericTool = auroraTools
          .renderActiveTools(
            [
              {
                id: "generic-ask",
                name: "ask_user",
                kind: "generic",
                startedAt: 0,
              },
            ],
            context.ui.theme,
            90,
            5_000,
          )
          .map(stripAnsi)
          .join("\n");
        assert(
          genericTool.includes("Werkzeug · ask_user"),
          "generic activity rows preserve the real runtime tool name",
        );
        const activeTools = ["read", "grep", "bash", "edit"].map(
          (name, index) => ({
            id: `${name}-${index}`,
            name,
            startedAt: 0,
          }),
        );
        const compactTools = auroraTools
          .renderActiveTools(activeTools, context.ui.theme, 45, 5_000)
          .map(stripAnsi);
        const normalTools = auroraTools
          .renderActiveTools(activeTools, context.ui.theme, 90, 5_000)
          .map(stripAnsi);
        assert(
          compactTools.length === 2 &&
            compactTools.at(-1)?.includes("+3 weitere Tools"),
          "the compact activity surface discloses hidden parallel tools",
        );
        assert(
          normalTools.length === 4 &&
            normalTools.at(-1)?.includes("+1 weitere Tools"),
          "the normal activity surface discloses its remaining parallel tool",
        );

        // A tool that is still producing output (e.g. bash streaming stdout)
        // must not be flagged as stalled just because it has run a while.
        const activeStreaming = auroraTools
          .renderActiveTools(
            [
              {
                id: "bash-streaming",
                name: "bash",
                kind: "bash",
                startedAt: 0,
                lastUpdateAt: 4_500,
              },
            ],
            context.ui.theme,
            90,
            5_000,
            { wide: true },
          )
          .map(stripAnsi)
          .join("\n");
        assert(
          !activeStreaming.includes("KEINE AUSGABE"),
          "recent output keeps the tool row in the normal running state",
        );

        // A tool with no update for longer than the stall threshold surfaces
        // a neutral "keine Ausgabe" state instead of the generic running one
        // — the signal this whole change exists to add to Aurora.
        const stalled = auroraTools
          .renderActiveTools(
            [
              {
                id: "bash-stalled",
                name: "bash",
                kind: "bash",
                startedAt: 0,
                lastUpdateAt: 0,
              },
            ],
            context.ui.theme,
            90,
            20_000,
            { wide: true },
          )
          .map(stripAnsi)
          .join("\n");
        assert(
          stalled.includes("KEINE AUSGABE SEIT 20S"),
          "no output for longer than the stall threshold is surfaced with its silent duration",
        );

        const activityCases = [
          ["read", { path: "README.md" }, "read", "README.md"],
          ["grep", { pattern: "aurora" }, "search", '"aurora"'],
          ["find", { pattern: "*.ts" }, "search", '"*.ts"'],
          ["edit", { path: "index.ts", edits: [] }, "edit", "index.ts"],
          ["write", { path: "new.ts", content: "" }, "edit", "new.ts"],
          ["bash", { command: "npm test" }, "test", "npm test"],
          [
            "bash",
            { command: "cargo test -p aurora" },
            "test",
            "cargo test -p aurora",
          ],
          [
            "bash",
            { command: "npm run verify" },
            "verification",
            "npm run verify",
          ],
          ["bash", { command: "echo jest" }, "bash", "echo jest"],
          ["verify", { check: "verify" }, "verification", "verify"],
          ["project_check", { profile: "verify" }, "verification", "verify"],
          ["subagent", { agent: "reviewer" }, "subagent", "reviewer"],
          ["wait", { all: true }, "wait", "alle Subagenten"],
          [
            "lsp_references",
            { path: "index.ts", line: 4, character: 2 },
            "lsp",
            "Referenzen · index.ts:5:3",
          ],
          [
            "lsp_workspace_symbols",
            { query: "Aurora" },
            "lsp",
            'Workspace-Symbole · "Aurora"',
          ],
          ["ask_user", { question: "continue?" }, "generic", undefined],
        ];
        for (const [name, args, kind, target] of activityCases) {
          const described = auroraTools.describeToolActivity(name, args);
          eq(described.kind, kind, `${name} has the expected Activity kind`);
          eq(described.target, target, `${name} keeps only its real target`);
        }
        const lspActivity = auroraTools
          .renderActiveTools(
            [
              {
                id: "lsp",
                name: "lsp_references",
                ...auroraTools.describeToolActivity("lsp_references", {
                  path: "index.ts",
                  line: 4,
                  character: 2,
                }),
                startedAt: 0,
              },
            ],
            context.ui.theme,
            120,
            5_000,
          )
          .map(stripAnsi)
          .join("\n");
        assert(
          lspActivity.includes("◇ LSP") &&
            lspActivity.includes("Referenzen · index.ts:5:3"),
          "LSP activity names the real operation and position without inventing a symbol",
        );
        for (const columns of [40, 52, 90, 120, 160]) {
          const rendered = auroraTools.renderActiveTools(
            [
              {
                id: "read",
                name: "read",
                ...auroraTools.describeToolActivity("read", {
                  path: "a-very-long-file-name.ts",
                }),
                startedAt: 0,
              },
              {
                id: "test",
                name: "bash",
                ...auroraTools.describeToolActivity("bash", {
                  command: "npm test -- --runInBand",
                }),
                startedAt: 0,
              },
            ],
            context.ui.theme,
            columns,
            5_000,
            { compact: columns < 52 },
          );
          assert(
            rendered.every((line) => visibleWidth(line) <= columns),
            `typed activity fits ${columns} columns`,
          );
        }
      }

      // Subagents are inline work: they show up next to the tool that started
      // them, for as long as it runs. The footer never carries them.
      {
        const auroraTools = await load(
          "extensions/aurora-ui/tool-renderers.ts",
        );
        const withSubagents = auroraTools
          .renderSubagents(
            [
              { agent: "reviewer", status: "needs_attention" },
              { agent: "worker", status: "running" },
            ],
            context.ui.theme,
            120,
          )
          .map(stripAnsi)
          .join("\n");
        assert(
          withSubagents.includes("SUBAGENTS · 2") &&
            withSubagents.includes("reviewer") &&
            withSubagents.includes("1 Aufmerksamkeit") &&
            withSubagents.includes("!") &&
            withSubagents.includes("◉"),
          "the activity widget reports active subagents and what needs a look",
        );
        eq(
          auroraTools.renderSubagents([], context.ui.theme, 120),
          [],
          "no subagents means no lines at all",
        );
        eq(
          auroraTools.renderSubagents(
            [{ agent: "worker", phase: "analyse", status: "running" }],
            context.ui.theme,
            45,
          ).length,
          2,
          "a compact terminal keeps the active worker plus its summary",
        );
        const overflow = auroraTools
          .renderSubagents(
            ["investigator", "debugger", "verifier", "reviewer"].map(
              (agent) => ({
                agent: `very-long-${agent}-name`,
                phase: "very-long-analysis-phase",
                status: "running",
              }),
            ),
            context.ui.theme,
            124,
          )
          .map(stripAnsi)
          .join("\n");
        assert(
          overflow.includes("+1 weitere"),
          "the subagent overflow count survives long names",
        );
      }

      // When the combined tool+subagent detail count exceeds the budget,
      // hiddenActivitySummary kicks in so the widget still fits the terminal.
      {
        const overflowHarness = createHarness();
        auroraUi.default(overflowHarness.api);
        const overflowCtx = overflowHarness.makeContext({
          sessionId: "overflow-summary-session",
        });
        await overflowHarness.runHooks("session_start", {}, overflowCtx);
        await overflowHarness.runHooks("agent_start", {}, overflowCtx);
        // Pump enough tool starts to overflow the detail budget (max 7).
        for (let i = 0; i < 9; i++) {
          await overflowHarness.runHooks(
            "tool_execution_start",
            {
              toolCallId: `overflow-tool-${i}`,
              toolName: "read",
              input: { path: `file-${i}.ts` },
            },
            overflowCtx,
          );
        }
        const widget = overflowHarness.widgets.get("aurora-ui/activity");
        const rendered =
          typeof widget?.content === "function"
            ? widget
                .content(
                  { terminal: { columns: 140, rows: 24 }, requestRender() {} },
                  overflowCtx.ui.theme,
                )
                .render(140)
                .map(stripAnsi)
                .join("\n")
            : "";
        assert(
          rendered.includes("↳ +") && rendered.includes("Tool"),
          "hiddenActivitySummary compacts the overflow into a single summary line",
        );
        await overflowHarness.runHooks("session_shutdown", {}, overflowCtx);
      }

      // Async subagents are visible only from their actual lifecycle events.
      // Aurora must not ask the package's status RPC, because that path itself
      // executes a subagent status action on behalf of the UI.
      {
        const subagentHarness = createHarness();
        auroraUi.default(subagentHarness.api);
        let rpcRequests = 0;
        subagentHarness.api.events.on("subagents:rpc:v1:request", () => {
          rpcRequests += 1;
        });
        const subagentContext = subagentHarness.makeContext({
          sessionId: "async-activity-session",
        });
        await subagentHarness.runHooks("session_start", {}, subagentContext);
        await subagentHarness.runHooks("agent_start", {}, subagentContext);
        const activity =
          subagentHarness.widgets.get("aurora-ui/activity")?.content;
        const render = () =>
          typeof activity === "function"
            ? activity(
                { terminal: { columns: 140, rows: 30 }, requestRender() {} },
                subagentContext.ui.theme,
              )
                .render(140)
                .map(stripAnsi)
                .join("\n")
            : "";

        await subagentHarness.runHooks(
          "tool_execution_start",
          {
            toolCallId: "foreground-subagent",
            toolName: "subagent",
            args: { agent: "worker" },
          },
          subagentContext,
        );
        assert(
          render().includes("worker") && render().includes("LÄUFT"),
          "a foreground subagent appears straight from its tool start",
        );
        await subagentHarness.runHooks(
          "tool_execution_end",
          { toolCallId: "foreground-subagent", toolName: "subagent" },
          subagentContext,
        );
        subagentHarness.api.events.emit("subagent:async-started", {
          id: "stale-async-activity",
          sessionId: "another-session",
          agent: "stale-worker",
        });
        assert(
          !render().includes("stale-worker"),
          "an async event from another session never reaches Activity",
        );
        subagentHarness.api.events.emit("subagent:async-started", {
          id: "pre-settle-async",
          sessionId: "async-activity-session",
          agent: "pre-settle-worker",
        });
        subagentHarness.api.events.emit("subagent:async-complete", {
          id: "pre-settle-async",
          sessionId: "async-activity-session",
        });
        assert(
          render().includes("ANTWORTET"),
          "the last async completion cannot make an active parent turn idle",
        );
        await subagentHarness.runHooks("agent_settled", {}, subagentContext);
        eq(
          render(),
          "",
          "the parent completion, not async completion, clears Aurora activity",
        );
        await subagentHarness.runHooks("agent_start", {}, subagentContext);

        subagentHarness.api.events.emit("subagent:async-started", {
          id: "async-activity",
          sessionId: "async-activity-session",
          agents: ["async-worker", "reviewer"],
          mode: "parallel",
        });
        assert(
          render().includes("async-worker") &&
            render().includes("reviewer") &&
            render().includes("WARTET"),
          "actual async-started data drives Aurora's transient subagent view",
        );
        await subagentHarness.runHooks(
          "message_update",
          { assistantMessageEvent: { type: "text_delta" } },
          subagentContext,
        );
        await subagentHarness.runHooks("agent_settled", {}, subagentContext);
        assert(
          render().includes("async-worker") && render().includes("reviewer"),
          "async subagents remain visible after the parent turn settles",
        );
        subagentHarness.api.events.emit("subagent:control-event", {
          event: {
            type: "needs_attention",
            runId: "async-activity",
            agent: "reviewer",
          },
        });
        assert(
          render().includes("reviewer") && render().includes("!"),
          "a real control event marks only the known async agent for attention",
        );
        subagentHarness.api.events.emit("subagent:async-complete", {
          id: "async-activity",
          sessionId: "async-activity-session",
        });
        assert(
          render() === "",
          "an async completion removes the subagent instead of creating history",
        );
        eq(rpcRequests, 0, "Aurora never initiates a subagent status RPC");
        await subagentHarness.runHooks("session_shutdown", {}, subagentContext);
      }

      await harness.runHooks("agent_start", {}, context);
      const thinkingWidget = harness.widgets.get("aurora-ui/activity")?.content;
      const thinkingHeader =
        typeof thinkingWidget === "function"
          ? thinkingWidget({ requestRender() {} }, context.ui.theme)
              .render(120)
              .map(stripAnsi)
              .join("\n")
          : "";
      assert(
        thinkingHeader.includes("DENKT NACH") &&
          thinkingHeader.includes("HOCH") &&
          /· \d+s/.test(thinkingHeader),
        "Aurora shows a German Thinking header with level and elapsed seconds",
      );
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
        const toolHeader = stripAnsi(component.render(120)[0]);
        assert(
          toolHeader.includes("ARBEITET") && /· \d+s/.test(toolHeader),
          "Aurora shows a German Tool header with elapsed seconds",
        );
        // The widget is Aurora's only live-work surface; the native indicator
        // remains hidden so the editor does not show two competing signals.
        eq(
          harness.workingVisibility.at(-1),
          false,
          "the native working indicator remains hidden while a tool runs",
        );
        assert(
          stripAnsi(component.render(60)[0]).includes("ARBEITET"),
          "the configured Thinking state lives only in the activity widget",
        );
        component.invalidate?.();
        component.dispose?.();
      }
      await harness.runHooks(
        "tool_execution_update",
        {
          toolCallId: "tool-aurora",
          toolName: "read",
          args: { path: "README.md" },
          partialResult: { isError: true },
        },
        context,
      );
      const erroredRead =
        typeof widget === "function"
          ? widget({ requestRender() {} }, context.ui.theme)
              .render(60)
              .join("\n")
          : "";
      assert(
        erroredRead.includes(context.ui.theme.fg("error", "◌")),
        "a real error partial styles the still-running Activity glyph as an error",
      );

      await harness.runHooks(
        "tool_execution_start",
        {
          toolCallId: "tool-aurora-bash",
          toolName: "bash",
          args: { command: "npm run test" },
        },
        context,
      );
      const railRendered =
        typeof widget === "function"
          ? widget(
              { terminal: { columns: 140, rows: 30 }, requestRender() {} },
              context.ui.theme,
            )
              .render(140)
              .map(stripAnsi)
              .join("\n")
          : "";
      assert(
        railRendered.includes("│") &&
          railRendered.includes("├─") &&
          railRendered.includes("╰─") &&
          railRendered.includes("◌ Lesen") &&
          railRendered.includes("▹ Testen"),
        "wide activity groups typed running tools with a lightweight rail",
      );

      const auroraEpoch = harness.emitted.find(
        (entry) => entry.name === "aurora-ui/state/request",
      )?.event?.sessionEpoch;
      harness.api.events.emit("aurora-ui/state/patch", {
        type: "patch",
        sessionEpoch: auroraEpoch,
        source: "lsp-test-provider",
        patch: { lsp: { state: "eingeschränkt" } },
      });
      const healthOnlyRendered =
        typeof widget === "function"
          ? widget(
              { terminal: { columns: 140, rows: 30 }, requestRender() {} },
              context.ui.theme,
            )
              .render(140)
              .map(stripAnsi)
              .join("\n")
          : "";
      assert(
        !healthOnlyRendered.includes("◇ LSP"),
        "an LSP health patch never fabricates an LSP activity row",
      );
      await harness.runHooks(
        "tool_execution_start",
        {
          toolCallId: "tool-aurora-lsp",
          toolName: "lsp_references",
          args: {
            path: "extensions/aurora-ui/index.ts",
            line: 1,
            character: 0,
          },
        },
        context,
      );
      const lspRendered =
        typeof widget === "function"
          ? widget(
              { terminal: { columns: 140, rows: 30 }, requestRender() {} },
              context.ui.theme,
            )
              .render(140)
              .map(stripAnsi)
              .join("\n")
          : "";
      assert(
        lspRendered.includes("◇ LSP") &&
          lspRendered.includes(
            "Referenzen · extensions/aurora-ui/index.ts:2:1",
          ),
        "a real LSP tool call appears in Activity with its actual position",
      );
      await harness.runHooks(
        "tool_execution_end",
        { toolCallId: "tool-aurora-lsp", toolName: "lsp_references" },
        context,
      );
      const settledLspRendered =
        typeof widget === "function"
          ? widget(
              { terminal: { columns: 140, rows: 30 }, requestRender() {} },
              context.ui.theme,
            )
              .render(140)
              .map(stripAnsi)
              .join("\n")
          : "";
      assert(
        !settledLspRendered.includes("◇ LSP"),
        "LSP Activity disappears as soon as its real tool call ends",
      );
      await harness.runHooks(
        "tool_execution_start",
        {
          toolCallId: "tool-aurora-verify",
          toolName: "verify",
          args: { check: "verify" },
        },
        context,
      );
      const verifyRendered =
        typeof widget === "function"
          ? widget(
              { terminal: { columns: 140, rows: 30 }, requestRender() {} },
              context.ui.theme,
            )
              .render(140)
              .map(stripAnsi)
              .join("\n")
          : "";
      assert(
        verifyRendered.includes("◌ Prüfen") &&
          verifyRendered.includes("verify"),
        "the running verification tool has a distinct, argument-backed Activity row without a false success mark",
      );
      await harness.runHooks(
        "tool_execution_end",
        { toolCallId: "tool-aurora-verify", toolName: "verify" },
        context,
      );
      await harness.runHooks(
        "message_update",
        { assistantMessageEvent: { type: "text_delta" } },
        context,
      );
      const respondingRendered =
        typeof widget === "function"
          ? widget({ requestRender() {} }, context.ui.theme)
              .render(120)
              .map(stripAnsi)
              .join("\n")
          : "";
      assert(
        respondingRendered.includes("ANTWORTET"),
        "a text update keeps the active turn visible as Responding",
      );

      // Rendering derives WARTET from the normal Aurora clock; the test moves
      // that clock directly instead of waiting in real time.
      {
        const originalNow = Date.now;
        const clock = originalNow() + 4_000;
        Date.now = () => clock;
        try {
          const waitingRendered =
            typeof widget === "function"
              ? widget({ requestRender() {} }, context.ui.theme)
                  .render(120)
                  .map(stripAnsi)
                  .join("\n")
              : "";
          assert(
            waitingRendered.includes("WARTET") &&
              waitingRendered.includes("0s"),
            "Aurora derives WARTET only after its documented quiet threshold",
          );
          await harness.runHooks(
            "message_update",
            { assistantMessageEvent: { type: "text_delta" } },
            context,
          );
          const resumedRendered =
            typeof widget === "function"
              ? widget({ requestRender() {} }, context.ui.theme)
                  .render(120)
                  .map(stripAnsi)
                  .join("\n")
              : "";
          assert(
            resumedRendered.includes("ANTWORTET") &&
              !resumedRendered.includes("WARTET"),
            "a concrete text event immediately replaces WARTET",
          );
        } finally {
          Date.now = originalNow;
        }
      }

      // Only thinking and running tools are moving work. Responding keeps a
      // fixed glyph while the slow status ticker still repaints the line, so
      // the glyph is sampled across a full four-frame cycle of the old pulse.
      {
        const headGlyph = () => {
          const rendered =
            typeof widget === "function"
              ? stripAnsi(
                  widget({ requestRender() {} }, context.ui.theme).render(120)[0],
                )
              : "";
          return rendered.slice(0, rendered.indexOf(" "));
        };
        const samples = [headGlyph()];
        for (let tick = 0; tick < 3; tick += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1_050));
          // Keep the turn in Responding; without a concrete event the clock
          // would derive WARTET and change the glyph for that reason instead.
          await harness.runHooks(
            "message_update",
            { assistantMessageEvent: { type: "text_delta" } },
            context,
          );
          samples.push(headGlyph());
        }
        eq(
          [...new Set(samples)],
          [samples[0]],
          "ANTWORTET keeps one static glyph while the status ticker runs",
        );
        assert(
          samples[0] !== "·",
          "the static responding glyph stays distinguishable from WARTET",
        );
      }

      // The same widget, in the same contextual motion mode, must still animate
      // while the model is thinking.
      {
        await harness.runHooks("agent_start", {}, context);
        const thinkingGlyph = () => {
          const rendered =
            typeof widget === "function"
              ? stripAnsi(
                  widget({ requestRender() {} }, context.ui.theme).render(120)[0],
                )
              : "";
          return rendered.slice(0, rendered.indexOf(" "));
        };
        const frames = new Set([thinkingGlyph()]);
        for (let tick = 0; tick < 4; tick += 1) {
          await new Promise((resolve) => setTimeout(resolve, 110));
          frames.add(thinkingGlyph());
        }
        assert(
          frames.size > 1,
          "DENKT NACH still animates in contextual motion",
        );
      }

      // The overflow line is the widget's only place where counts and status
      // labels are aggregated, and it must show both surfaces at once.
      {
        for (let index = 0; index < 8; index += 1) {
          await harness.runHooks(
            "tool_execution_start",
            {
              toolCallId: `overflow-tool-${index}`,
              toolName: "read",
              args: { path: `src/overflow-${index}.ts` },
            },
            context,
          );
        }
        await harness.runHooks(
          "tool_execution_update",
          {
            toolCallId: "overflow-tool-7",
            toolName: "read",
            partialResult: { isError: true },
          },
          context,
        );
        harness.api.events.emit("subagent:async-started", {
          id: "overflow-async",
          sessionId: context.sessionManager.getSessionId(),
          agents: ["investigator", "debugger"],
        });
        const overflowRendered =
          typeof widget === "function"
            ? widget(
                { terminal: { columns: 140, rows: 30 }, requestRender() {} },
                context.ui.theme,
              )
                .render(140)
                .map(stripAnsi)
                .join("\n")
            : "";
        assert(
          overflowRendered.includes(
            "↳ +2 Tools · 1 läuft, 1 fehler · 2 Subagenten · 2 wartet",
          ),
          "the overflow line counts both hidden surfaces with the shared status labels",
        );
        assert(
          !overflowRendered.includes("Fehler") &&
            !overflowRendered.includes("Aufmerksamkeit"),
          "the overflow line uses the shared lowercase status labels, not a second wording",
        );
        for (let index = 0; index < 8; index += 1) {
          await harness.runHooks(
            "tool_execution_end",
            { toolCallId: `overflow-tool-${index}`, toolName: "read" },
            context,
          );
        }
        harness.api.events.emit("subagent:async-complete", {
          id: "overflow-async",
          sessionId: context.sessionManager.getSessionId(),
        });
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
          let statusRepaints = 0;
          const motionComponent =
            typeof motionWidget === "function"
              ? motionWidget(
                  {
                    requestRender() {
                      statusRepaints += 1;
                    },
                  },
                  motionContext.ui.theme,
                )
              : undefined;
          const rendered =
            motionComponent?.render(60).map(stripAnsi).join("\n") ?? "";
          assert(
            rendered.includes("DENKT NACH") && rendered.includes("HOCH"),
            `Aurora keeps its Thinking header visible with ${motion} motion`,
          );
          assert(
            motion === "reduced"
              ? rendered.includes("●")
              : !rendered.includes("●"),
            `${motion} motion keeps the required static or text-only activity presentation`,
          );
          const repaintsBeforeStatusTick = statusRepaints;
          await new Promise((resolve) => setTimeout(resolve, 1_200));
          assert(
            statusRepaints > repaintsBeforeStatusTick,
            `${motion} motion repaints elapsed time and WARTET without another runtime event`,
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
      await harness.runHooks("agent_start", {}, context);
      await harness.runHooks("agent_settled", {}, context);
      eq(
        harness.widgets
          .get("aurora-ui/activity")
          ?.content({ requestRender() {} }, context.ui.theme)
          .render(140).length,
        0,
        "agent_settled also clears Aurora activity without async work",
      );

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
        2,
        "HTTP and network failures are observed separately",
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
        "completed",
        "successful native retry settles completed",
      );
      eq(
        settled?.data.observedFailureCount,
        2,
        "settled turn preserves observed failures",
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
      resilience,
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
        !auroraUi ||
        !resilience
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
        "+extensions/resilience/index.ts": resilience.default,
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
