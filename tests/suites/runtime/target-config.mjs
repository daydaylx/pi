import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, eq } from "../../shared/assertions.mjs";
import { contrastRatio } from "../../shared/harness.mjs";
import { ROOT } from "../../shared/jiti-loader.mjs";

export const targetConfigSections = {
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
          2,
          "subagent orchestration and minimal web access are the only active packages",
        );
        assert(
          packageSources.some((source) =>
            /^git:github\.com\/daydaylx\/pi-subagents@[0-9a-f]{40}$/.test(
              source ?? "",
            ),
          ),
          "subagent runtime remains immutable-pinned",
        );
        assert(
          packageSources.includes("npm:pi-web-access@0.24.2"),
          "web access runtime remains exact-version-pinned",
        );
        const subagentSettings = settings.subagents;
        assert(
          subagentSettings?.disableBuiltins === true,
          "subagent builtins stay disabled in favor of the local role set",
        );
        const allowedSubagentModels = Array.isArray(
          subagentSettings?.modelScope?.allow,
        )
          ? subagentSettings.modelScope.allow
          : [];
        assert(
          subagentSettings?.modelScope?.enforce === true &&
            allowedSubagentModels.length > 0,
          "subagent model scope stays enabled with an allow list",
        );
        const isScopedSubagentModel = (model) =>
          allowedSubagentModels.some((pattern) =>
            pattern.endsWith("/*")
              ? model.startsWith(pattern.slice(0, -1))
              : model === pattern,
          );
        for (const role of ["investigator", "debugger", "verifier"]) {
          const override = subagentSettings?.agentOverrides?.[role];
          const model = override?.model;
          const hasModel = typeof model === "string" && model.length > 0;
          assert(hasModel, `${role} has an explicit model override`);
          if (!hasModel) continue;
          assert(
            settings.enabledModels.includes(model),
            `${role}'s model is enabled for Pi`,
          );
          assert(
            isScopedSubagentModel(model),
            `${role}'s model is allowed by the subagent scope`,
          );
          const fallbacks = override?.fallbackModels;
          const hasFallbacks =
            Array.isArray(fallbacks) && fallbacks.length > 0;
          assert(hasFallbacks, `${role} has fallback models`);
          if (!hasFallbacks) continue;
          assert(
            fallbacks.every(
              (fallback) =>
                typeof fallback === "string" &&
                settings.enabledModels.includes(fallback) &&
                isScopedSubagentModel(fallback),
            ),
            `${role}'s fallback models are enabled and in scope`,
          );
        }
        eq(
          subagentSettings?.agentOverrides?.debugger?.thinking,
          "max",
          "debugger retains the required maximum thinking level",
        );
        eq(
          subagentSettings?.agentOverrides?.verifier?.thinking,
          "max",
          "verifier retains the required maximum thinking level",
        );

        // Compaction budget, measured rather than guessed (docs/decisions/010).
        // Pinned here because both values were previously set without a run
        // that ever reached a compaction, and a silent revert is invisible
        // until a long session overflows.
        const { shouldCompact, DEFAULT_COMPACTION_SETTINGS } = await import(
          pathToFileURL(
            path.join(
              ROOT,
              "npm/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js",
            ),
          ).href
        );
        const compaction = settings.compaction;
        assert(
          compaction.keepRecentTokens >=
            DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
          "the recent-context budget never drops below the runtime's own default",
        );
        assert(
          compaction.reserveTokens >
            DEFAULT_COMPACTION_SETTINGS.reserveTokens * 2,
          "the reserve stays large enough to survive a turn that outgrows it",
        );
        // The default model's window. Not readable from a tracked file
        // (models-store.json is runtime data), so it is stated here as the
        // assumption the two values above were measured against.
        const CONTEXT_WINDOW = 272_000;
        const trigger = CONTEXT_WINDOW - compaction.reserveTokens;
        assert(
          trigger / CONTEXT_WINDOW <= 0.85,
          "compaction triggers early enough to leave room for a real turn",
        );
        eq(
          shouldCompact(trigger, CONTEXT_WINDOW, compaction),
          false,
          "the trigger boundary itself does not compact",
        );
        eq(
          shouldCompact(trigger + 1, CONTEXT_WINDOW, compaction),
          true,
          "one token past the boundary compacts",
        );
        eq(
          shouldCompact(trigger + 1, CONTEXT_WINDOW, {
            ...compaction,
            enabled: false,
          }),
          false,
          "disabled compaction never triggers",
        );
        assert(
          !Object.hasOwn(setup, "models"),
          "setup.json contains no duplicate model-role configuration",
        );
        // Model switches are routine operations, not incidents: the defaults
        // are checked structurally (present, valid level, scoped) instead of
        // pinned to concrete provider/model values that every repin would
        // break.
        assert(
          typeof settings.defaultProvider === "string" &&
            settings.defaultProvider.length > 0,
          "the default provider is configured",
        );
        assert(
          typeof settings.defaultModel === "string" &&
            settings.defaultModel.length > 0,
          "the default model is configured",
        );
        const VALID_THINKING_LEVELS = [
          "off",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ];
        assert(
          VALID_THINKING_LEVELS.includes(settings.defaultThinkingLevel),
          `the thinking default (${settings.defaultThinkingLevel}) is a valid level`,
        );
        const defaultModelId = `${settings.defaultProvider}/${settings.defaultModel}`;
        assert(
          settings.enabledModels.includes(defaultModelId),
          `the active default model (${defaultModelId}) is contained in Pi's scoped models`,
        );
        // The Individual Plan catalog, exactly as the runtime ships it: no
        // Kimi, no MiniMax, no external token plans.
        const individualCatalog = JSON.parse(
          readFileSync(
            path.join(
              ROOT,
              "npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/qwen-token-plan-individual.json",
            ),
            "utf8",
          ),
        );
        const individualModels = Object.values(
          individualCatalog["openai-completions"],
        );
        eq(
          individualModels.map((model) => model.id).sort(),
          [
            "deepseek-v4-flash-0731",
            "deepseek-v4-pro",
            "deepseek-v4-pro-0813",
            "glm-5.2",
            "qwen3.6-flash",
            "qwen3.7-max",
            "qwen3.7-plus",
            "qwen3.8-max",
          ],
          "the Individual Plan catalog matches the expected model set",
        );
        for (const model of individualModels) {
          assert(
            settings.enabledModels.includes(
              `qwen-token-plan-individual/${model.id}`,
            ),
            `the Individual Plan model ${model.id} stays selectable for the main agent`,
          );
        }
        assert(
          settings.enabledModels.every(
            (entry) =>
              !entry.startsWith("qwen-token-plan/") &&
              !entry.startsWith("qwen-token-plan-cn/"),
          ),
          "retired token plan variants leave no scoped models behind",
        );
        // xhigh and max are separate real levels; which one a model reaches is
        // declared by the catalog and enforced by the runtime clamp, not by
        // any local mapping.
        const modelById = (id) =>
          individualModels.find((model) => model.id === id);
        eq(
          modelById("qwen3.8-max").thinkingLevelMap.xhigh,
          "xhigh",
          "Qwen3.8-Max reaches xhigh",
        );
        eq(
          modelById("qwen3.8-max").thinkingLevelMap.max,
          null,
          "Qwen3.8-Max does not support max",
        );
        for (const id of ["glm-5.2", "deepseek-v4-pro"]) {
          eq(modelById(id).thinkingLevelMap.max, "max", `${id} supports max`);
        }
        const { clampThinkingLevel } = await import(
          pathToFileURL(
            path.join(
              ROOT,
              "npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.js",
            ),
          ).href
        );
        eq(
          clampThinkingLevel(modelById("qwen3.8-max"), "max"),
          "xhigh",
          "the runtime clamps Qwen3.8-Max from max down to xhigh",
        );
        eq(
          clampThinkingLevel(modelById("glm-5.2"), "max"),
          "max",
          "the runtime keeps max for GLM-5.2",
        );
        eq(
          clampThinkingLevel(modelById("deepseek-v4-pro"), "max"),
          "max",
          "the runtime keeps max for DeepSeek-V4-Pro",
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
          auroraTheme.vars.bg,
          "#0b0d16",
          "Aurora retains its dark blue-black page background",
        );
        eq(
          auroraTheme.vars.bgDark,
          "#090a12",
          "Aurora retains its darker terminal background variant",
        );
        assert(
          contrastRatio(auroraTheme.vars.textMuted, auroraTheme.vars.bg) >=
            4.5 &&
            contrastRatio(
              auroraTheme.vars.textMuted,
              auroraTheme.vars.surface,
            ) >= 4.5,
          "Aurora muted text meets AA contrast on both primary backgrounds",
        );
        for (const color of [
          "accent",
          "borderAccent",
          "success",
          "warning",
          "error",
          "thinkingXhigh",
          "thinkingMax",
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
            "+extensions/compact-tools/index.ts",
            "+extensions/aurora-ui/index.ts",
            "+extensions/resilience/index.ts",
            "+extensions/session-health/index.ts",
            "+extensions/openrouter-doctor/index.ts",
            "+extensions/frontend-bridge/index.ts",
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
        // pi-subagents is pinned to the same git-fork commit the live runtime
        // loads (settings.json packages), not an npm-registry version — this
        // closes the drift where the harness typechecked a different codebase
        // than the one interactive sessions actually run. See
        // docs/decisions/017-verifier-acceptance-none.md.
        assert(
          /^github:daydaylx\/pi-subagents#[0-9a-f]{40}$/.test(
            packageJson.dependencies?.["pi-subagents"] ?? "",
          ),
          "pi-subagents is pinned to an exact git-fork commit in the harness",
        );
        const runtimePin = settings.packages.find(
          (entry) =>
            typeof entry === "string" &&
            entry.startsWith("git:github.com/daydaylx/pi-subagents@"),
        );
        const runtimeHash = runtimePin?.match(/@([0-9a-f]{40})$/)?.[1];
        const harnessHash = packageJson.dependencies?.["pi-subagents"]?.match(
          /#([0-9a-f]{40})$/,
        )?.[1];
        const lockResolved = lock.packages?.["node_modules/pi-subagents"]?.resolved;
        const lockHash = typeof lockResolved === "string"
          ? lockResolved.match(/#([0-9a-f]{40})$/)?.[1]
          : undefined;
        eq(
          runtimeHash,
          harnessHash,
          "settings.json and npm/package.json use the identical pi-subagents commit",
        );
        eq(
          runtimeHash,
          lockHash,
          "settings.json and package-lock.json use the identical pi-subagents commit",
        );
        return;
      }
    });
  },
};
