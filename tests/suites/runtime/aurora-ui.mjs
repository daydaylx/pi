import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness, stripAnsi } from "../../shared/harness.mjs";
import { ROOT } from "../../shared/jiti-loader.mjs";

export const auroraUiSections = {
  "Aurora UI lifecycle and responsive surfaces": async (context) => {
    const { section, load, auroraUi, auroraFooter } = context;

    await section("Aurora UI lifecycle and responsive surfaces", async () => {
      if (!auroraUi) return;
      // /dashboard persists into the global setup.json under getAgentDir();
      // redirect the agent dir to a throwaway folder so tests can switch
      // dashboard modes without ever touching a real configuration.
      const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
      const tempAgentDir = mkdtempSync(path.join(tmpdir(), "aurora-agent-"));
      process.env.PI_CODING_AGENT_DIR = tempAgentDir;
      try {
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
              permissions: {
                level: "project-write",
                label: "Projekt schreiben",
              },
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
        const welcomeWidget =
          harness.widgets.get("aurora-ui/activity")?.content;
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
        // Auto mode is the responsive default dashboard: resumed sessions skip
        // the welcome but keep task, activity and verification orientation.
        const autoLines = resumedLines;
        assert(
          autoLines.some((line) => stripAnsi(line).includes("Sitzung")) &&
            !autoLines.some((line) => stripAnsi(line).includes("◌ Aktivität")) &&
            !autoLines.some((line) => stripAnsi(line).includes("PI · AURORA")),
          "a resumed idle session keeps the session card without welcome or invented activity",
        );
        await resumedContext.ui.submitSlashCommand("/dashboard expanded");
        const expandedLines =
          typeof resumedWidget === "function"
            ? resumedWidget(
                { terminal: { columns: 120, rows: 30 }, requestRender() {} },
                resumedContext.ui.theme,
              ).render(120)
            : [];
        assert(
          expandedLines.some((line) => stripAnsi(line).includes("AUFGABE")) &&
            !expandedLines.some((line) =>
              stripAnsi(line).includes("PI · AURORA"),
            ),
          "a resumed conversation skips the welcome but shows the expanded dashboard",
        );
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
          // and the editor frame that used to carry it is gone. From comfortable
          // width on the workflow renders as a chip, so one padding cell leads.
          assert(
            wide.startsWith(" Architekturplan") &&
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
            [40, 12],
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
              statuses: new Map([["verification", "Verify: unchanged"]]),
            }).includes("unchanged"),
            "an unchanged workspace does not spend compact footer space",
          );
          assert(
            line(100, {
              statuses: new Map([["verification", "Verify: verified"]]),
            }).includes("verified"),
            "the footer reports a proven workspace when no dashboard owns it",
          );
          assert(
            !line(100, {
              statuses: new Map([["verification", "Verify: verified"]]),
              dashboardVisible: true,
            }).includes("verified"),
            "a dashboard-owned routine verification is not duplicated in the footer",
          );
          assert(
            line(100, {
              statuses: new Map([["verification", "Verify: verified"]]),
              dashboardVisible: false,
            }).includes("verified"),
            "the footer retains routine verification when a two-row dashboard uses its status row for live work",
          );
          assert(
            !line(45, {
              statuses: new Map([["verification", "Verify: verified"]]),
              dashboardVisible: false,
            }).includes("verified"),
            "routine verification without a dashboard owner is metadata again — it yields to width tiers",
          );
          assert(
            line(45, { state: { lsp: { state: "eingeschränkt" } } }).includes(
              "LSP eingeschränkt",
            ),
            "a broken language server is reported at any width",
          );
          for (const healthy of ["ready", "leerlauf", "aus", "3 aktiv"]) {
            assert(
              !line(140, { state: { lsp: { state: healthy } } }).includes(
                "LSP",
              ),
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
            const warned = auroraFooter.renderFooterLines(
              context.ui.theme,
              140,
              {
                statuses: new Map(),
                contextPercent: 75,
                state: footerState(),
              },
            )[0];
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
            activeStreaming.includes("LÄUFT"),
            "recent output keeps the tool row in the normal running state",
          );

          // A quiet tool is reported neutrally, never as an alarm: first a calm
          // still-active marker, then the silent duration itself (02-target-
          // behavior.md quiet-tool language). Only real failures get warning tone.
          const stillActive = auroraTools
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
            stillActive.includes("STILL AKTIV") &&
              !stillActive.includes("KEINE AUSGABE SEIT"),
            "a quietly running tool reads as neutral silence, not as an alarm",
          );

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
              45_000,
              { wide: true },
            )
            .map(stripAnsi)
            .join("\n");
          assert(
            stalled.includes("45s ohne neue Ausgabe"),
            "a longer silent stretch reports its duration without warning styling",
          );

          const testCwd = "/workspace";
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
            const described = auroraTools.describeToolActivity(
              name,
              args,
              testCwd,
            );
            eq(described.kind, kind, `${name} has the expected Activity kind`);
            eq(described.target, target, `${name} keeps only its real target`);
          }
          const absoluteWithinCwd = auroraTools.describeToolActivity(
            "read",
            { path: `${testCwd}/extensions/aurora-ui/tool-renderers.ts` },
            testCwd,
          );
          eq(
            absoluteWithinCwd.target,
            "extensions/aurora-ui/tool-renderers.ts",
            "an absolute path inside the workspace is shown workspace-relative",
          );
          const narrowNestedRead = auroraTools
            .renderActiveTools(
              [
                {
                  id: "read-nested",
                  name: "read",
                  ...auroraTools.describeToolActivity(
                    "read",
                    {
                      path: `${testCwd}/extensions/aurora-ui/tool-renderers.ts`,
                    },
                    testCwd,
                  ),
                  startedAt: 0,
                },
              ],
              context.ui.theme,
              50,
              5_000,
              { compact: true },
            )
            .map(stripAnsi)
            .join("\n");
          assert(
            narrowNestedRead.includes("tool-renderers.ts"),
            "a long nested path keeps its filename instead of losing it to end-truncation",
          );
          const waitRow = auroraTools
            .renderActiveTools(
              [
                {
                  id: "wait",
                  name: "wait",
                  kind: "wait",
                  target: "reviewer",
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
            waitRow.includes("⋯") && !waitRow.includes("◌"),
            "wait uses its own glyph, distinct from read's running marker",
          );
          const lspActivity = auroraTools
            .renderActiveTools(
              [
                {
                  id: "lsp",
                  name: "lsp_references",
                  ...auroraTools.describeToolActivity(
                    "lsp_references",
                    { path: "index.ts", line: 4, character: 2 },
                    testCwd,
                  ),
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
                  ...auroraTools.describeToolActivity(
                    "read",
                    { path: "a-very-long-file-name.ts" },
                    testCwd,
                  ),
                  startedAt: 0,
                },
                {
                  id: "test",
                  name: "bash",
                  ...auroraTools.describeToolActivity(
                    "bash",
                    { command: "npm test -- --runInBand" },
                    testCwd,
                  ),
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
          // The section theme's `fg` is a transparent stub (it returns its text
          // unchanged), so a tone spy — not an ANSI-code comparison — is the
          // only way to observe which tone a glyph actually renders with.
          const toneCalls = [];
          const spyTheme = {
            fg: (tone, text) => {
              toneCalls.push({ tone, text });
              return text;
            },
            bold: (text) => text,
          };
          auroraTools.renderSubagents(
            [{ agent: "worker", status: "running" }],
            spyTheme,
            120,
          );
          eq(
            toneCalls.find((call) => call.text === "◉")?.tone,
            "accent",
            "a running subagent uses the same accent tone as a running tool, leaving green for real success",
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
                    {
                      terminal: { columns: 140, rows: 24 },
                      requestRender() {},
                    },
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
          // These assertions cover the panel dashboard; pin the mode explicitly
          // because /dashboard persists across harnesses in this suite.
          await subagentContext.ui.submitSlashCommand("/dashboard expanded");
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
          assert(
            render().includes("AUFGABE") && !render().includes("async-worker"),
            "the parent completion clears live activity while the dashboard remains",
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
              render().includes("IM HINTERGRUND"),
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
            !render().includes("async-worker") &&
              !render().includes("reviewer") &&
              render().includes("AUFGABE"),
            "an async completion removes the subagent while keeping the session dashboard",
          );
          eq(rpcRequests, 0, "Aurora never initiates a subagent status RPC");
          await subagentHarness.runHooks(
            "session_shutdown",
            {},
            subagentContext,
          );
        }

        await harness.runHooks("agent_start", {}, context);
        const thinkingWidget =
          harness.widgets.get("aurora-ui/activity")?.content;
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
          "Aurora dashboard widget is component-backed",
        );
        if (typeof widget === "function") {
          const component = widget({ requestRender() {} }, context.ui.theme);
          assert(
            component.render(60).length >= 1,
            "Aurora activity renders in a narrow terminal",
          );
          const toolHeader = component.render(120).map(stripAnsi).join("\n");
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
            component.render(60).map(stripAnsi).join("\n").includes("ARBEITET"),
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
        // Panel grouping is the expanded presentation; auto renders the same
        // information unframed and is covered by dedicated auto-mode tests.
        await context.ui.submitSlashCommand("/dashboard expanded");
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
          railRendered.includes("╭─") &&
            railRendered.includes("AUFGABE") &&
            railRendered.includes("AKTIVITÄT") &&
            railRendered.includes("◌ Lesen") &&
            railRendered.includes("▹ Testen"),
          "wide dashboard groups typed running tools beneath the current task",
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
              waitingRendered.includes("WARTET AUF MODELL") &&
                waitingRendered.includes("0s"),
              "Aurora derives WARTET AUF MODELL only after its documented quiet threshold",
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
              "a concrete text event immediately replaces WARTET AUF MODELL",
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
                ? widget({ requestRender() {} }, context.ui.theme)
                    .render(120)
                    .map(stripAnsi)
                    .join("\n")
                : "";
            const activityLine = rendered
              .split("\n")
              .find((line) => line.includes("ANTWORTET"));
            return activityLine?.match(/[·•●]/)?.[0] ?? "";
          };
          const samples = [headGlyph()];
          for (let tick = 0; tick < 3; tick += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1_050));
            // Keep the turn in Responding; without a concrete event the clock
            // would derive WARTET AUF MODELL and change the glyph for that
            // reason instead.
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
            "the static responding glyph stays distinguishable from WARTET AUF MODELL",
          );
        }

        // The same widget, in the same contextual motion mode, must still animate
        // while the model is thinking.
        {
          await harness.runHooks("agent_start", {}, context);
          const thinkingGlyph = () => {
            const rendered =
              typeof widget === "function"
                ? widget({ requestRender() {} }, context.ui.theme)
                    .render(120)
                    .map(stripAnsi)
                    .join("\n")
                : "";
            const activityLine = rendered
              .split("\n")
              .find((line) => line.includes("DENKT NACH"));
            return activityLine?.match(/[·•●]/)?.[0] ?? "";
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
            overflowRendered.includes("↳ +") &&
              overflowRendered.includes("Tools") &&
              overflowRendered.includes("Subagenten"),
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
            const thinkingLine =
              rendered
                .split("\n")
                .find((line) => line.includes("DENKT NACH")) ?? "";
            assert(
              motion === "reduced"
                ? thinkingLine.includes("●")
                : !thinkingLine.includes("●"),
              `${motion} motion keeps the required static or text-only activity presentation`,
            );
            const repaintsBeforeStatusTick = statusRepaints;
            await new Promise((resolve) => setTimeout(resolve, 1_200));
            assert(
              statusRepaints > repaintsBeforeStatusTick,
              `${motion} motion repaints elapsed time and WARTET AUF MODELL without another runtime event`,
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

        // Dashboard modes: hidden restores the space, compact caps at two rows,
        // and auto is the responsive permanent default. Each block pins its mode
        // explicitly via /dashboard so assertions never depend on test order.
        {
          const modeHarness = createHarness();
          auroraUi.default(modeHarness.api);
          const modeContext = modeHarness.makeContext({
            sessionId: "aurora-mode-session",
          });
          await modeHarness.runHooks("session_start", {}, modeContext);
          await modeHarness.runHooks("agent_start", {}, modeContext);
          await modeHarness.runHooks(
            "tool_execution_start",
            {
              toolCallId: "mode-tool",
              toolName: "bash",
              args: { command: "npm run test" },
            },
            modeContext,
          );
          const renderMode = (columns = 100, rows = 30) => {
            const factory =
              modeHarness.widgets.get("aurora-ui/activity")?.content;
            return typeof factory === "function"
              ? factory(
                  { terminal: { columns, rows }, requestRender() {} },
                  modeContext.ui.theme,
                )
                  .render(columns)
                  .map(stripAnsi)
              : [];
          };

          await modeContext.ui.submitSlashCommand("/dashboard hidden");
          eq(
            renderMode().length,
            0,
            "hidden mode emits no dashboard rows while work runs and runtime state stays alive",
          );

          await modeContext.ui.submitSlashCommand("/dashboard compact");
          const compactMode = renderMode();
          assert(
            compactMode.length <= 2 &&
              compactMode.some((line) => line.includes("ARBEITEN")),
            "compact mode shows at most two dashboard rows during active work",
          );

          await modeContext.ui.submitSlashCommand("/dashboard auto");
          const autoMode = renderMode();
          assert(
            autoMode.length > 0 &&
              autoMode.length <= 7 &&
              autoMode.some((line) => line.includes("Sitzung")) &&
              autoMode.some((line) => line.includes("ARBEITET")) &&
              autoMode.some((line) => line.includes("Testen")),
            "auto mode keeps the framed session overview and typed tool rows within budget",
          );
          const lowestStandardAuto = renderMode(52, 14);
          assert(
            lowestStandardAuto.length <= 7,
            "auto mode preserves at least half of the smallest standard terminal for editor and footer",
          );

          await modeHarness.runHooks("session_shutdown", {}, modeContext);
        }

        // Routine success never becomes a critical footer segment merely
        // because the compact live fallback has no room for it. At standard
        // width the visible dashboard owns the duplicate-free report.
        {
          const footerHarness = createHarness();
          auroraUi.default(footerHarness.api);
          const footerContext = footerHarness.makeContext({
            sessionId: "aurora-compact-footer",
          });
          await footerHarness.runHooks("session_start", {}, footerContext);
          await footerHarness.runHooks("agent_start", {}, footerContext);
          await footerHarness.runHooks(
            "tool_execution_start",
            {
              toolCallId: "footer-tool",
              toolName: "read",
              args: { path: "README.md" },
            },
            footerContext,
          );
          const footerData = {
            getExtensionStatuses: () =>
              new Map([["verification", "Verify: verified"]]),
            onBranchChange: () => () => {},
          };
          const compactFooter = footerHarness.footerFactory?.(
            { terminal: { rows: 24 }, requestRender() {} },
            footerContext.ui.theme,
            footerData,
          );
          const standardFooter = footerHarness.footerFactory?.(
            { terminal: { rows: 24 }, requestRender() {} },
            footerContext.ui.theme,
            footerData,
          );
          assert(
            !stripAnsi(compactFooter?.render(40)[0] ?? "").includes("verified") &&
              !stripAnsi(standardFooter?.render(100)[0] ?? "").includes(
                "verified",
              ),
            "routine verification yields on compact terminals and is dashboard-owned at standard width",
          );
          await footerHarness.runHooks("session_shutdown", {}, footerContext);
        }

        // A subagent refreshes its branch before the tool hook publishes the
        // coarser `tool` activity state. A synchronous render at that exact
        // point must still show the factual active tool, not idle.
        {
          const raceHarness = createHarness();
          auroraUi.default(raceHarness.api);
          const raceContext = raceHarness.makeContext({
            sessionId: "aurora-idle-tool-race",
          });
          await raceHarness.runHooks("session_start", {}, raceContext);
          await raceHarness.runHooks("agent_start", {}, raceContext);
          await raceHarness.runHooks("agent_settled", {}, raceContext);
          const factory = raceHarness.widgets.get("aurora-ui/activity")?.content;
          let renderedDuringRefresh = "";
          let component;
          if (typeof factory === "function") {
            component = factory(
              {
                terminal: { columns: 100, rows: 30 },
                requestRender() {
                  renderedDuringRefresh = component
                    .render(100)
                    .map(stripAnsi)
                    .join("\n");
                },
              },
              raceContext.ui.theme,
            );
            await raceHarness.runHooks(
              "tool_execution_start",
              {
                toolCallId: "idle-subagent",
                toolName: "subagent",
                args: { agent: "investigator" },
              },
              raceContext,
            );
          }
          assert(
            renderedDuringRefresh.includes("ARBEITET") &&
              renderedDuringRefresh.includes("Subagent"),
            "a synchronous subagent refresh keeps an active tool visible before the agent state updates",
          );
          await raceHarness.runHooks("session_shutdown", {}, raceContext);
        }

        // Diagnostics contract: a disabled instance must be a pure pass-through
        // (normal sessions pay nothing), while an enabled instance counts,
        // snapshots, and resets load counters without losing tick-interval
        // configuration.
        {
          const diagContract = await load("extensions/aurora-ui/dev-diagnostics.ts");
          if (diagContract) {
            const expectedDefault =
              process.env.PI_AURORA_DIAG === "1" ||
              process.env.PI_AURORA_DIAG === "true";
            eq(
              diagContract.auroraDiagnostics.enabled,
              expectedDefault,
              "singleton enablement follows PI_AURORA_DIAG exactly",
            );

            const inert = diagContract.createAuroraDiagnostics({ enabled: false });
            eq(inert.enabled, false, "explicitly disabled instance reports disabled");
            const marker = { value: 42 };
            eq(
              inert.measure(() => marker),
              marker,
              "measure() passes through the result when disabled",
            );
            inert.recordDashboardRows(["a", "b"]);
            inert.recordTickInterval(100);
            eq(
              JSON.stringify(inert.snapshot()),
              JSON.stringify({
                renderCount: 0,
                totalRenderMs: 0,
                maxRenderMs: 0,
                lastDashboardRows: 0,
                activeTickIntervalMs: null,
              }),
              "disabled diagnostics never record anything",
            );
            eq(inert.report(), undefined, "report() stays silent when disabled");

            const active = diagContract.createAuroraDiagnostics({ enabled: true });
            eq(active.enabled, true, "factory can enable an isolated instance");
            let calls = 0;
            active.measure(() => {
              calls += 1;
            });
            active.measure(() => {
              calls += 1;
            });
            eq(calls, 2, "measure() always runs the wrapped function");
            eq(active.snapshot().renderCount, 2, "measure() counts each call");
            const snap = active.snapshot();
            assert(
              snap.totalRenderMs >= 0 && snap.maxRenderMs >= 0,
              "measure() records non-negative durations",
            );
            assert(
              snap.maxRenderMs <= snap.totalRenderMs + 1e-9,
              "max duration never exceeds the accumulated total",
            );
            active.recordDashboardRows(["x", "y", "z"]);
            active.recordTickInterval(250);
            eq(
              active.snapshot().lastDashboardRows,
              3,
              "recordDashboardRows stores the row count",
            );
            eq(
              active.snapshot().activeTickIntervalMs,
              250,
              "recordTickInterval stores the interval",
            );
            active.reset();
            const afterReset = active.snapshot();
            eq(afterReset.renderCount, 0, "reset() clears the render count");
            eq(afterReset.lastDashboardRows, 0, "reset() clears dashboard rows");
            eq(
              afterReset.activeTickIntervalMs,
              250,
              "reset() keeps tick-interval configuration",
            );
            assert(typeof active.report() === "string", "report() renders a line when enabled");

            const isolated = diagContract.createAuroraDiagnostics({ enabled: false });
            eq(isolated.snapshot().renderCount, 0, "instances keep isolated state");
          }
        }

        // Render-cost measurement (Phase-0 diagnostics). The widget re-renders
        // on every animation frame; this measures what one frame actually costs
        // so caching or ticker changes are decided on numbers, not assumptions.
        {
          const diagMod = await load("extensions/aurora-ui/dev-diagnostics.ts");
          if (diagMod) {
            const bench = createHarness();
            auroraUi.default(bench.api);
            const benchContext = bench.makeContext({
              sessionId: "aurora-bench-session",
            });
            await bench.runHooks("session_start", {}, benchContext);
            await bench.runHooks("agent_start", {}, benchContext);
            for (let i = 0; i < 4; i++) {
              await bench.runHooks(
                "tool_execution_start",
                {
                  toolCallId: `bench-tool-${i}`,
                  toolName: i === 3 ? "project_check" : "read",
                  args: { path: `src/module-${i}.ts` },
                },
                benchContext,
              );
            }
            const factory = bench.widgets.get("aurora-ui/activity")?.content;
            if (typeof factory === "function") {
              const component = factory(
                { terminal: { columns: 140, rows: 30 }, requestRender() {} },
                benchContext.ui.theme,
              );
              const FRAMES = 400;
              diagMod.auroraDiagnostics.reset();
              const wallStart = performance.now();
              for (let frame = 0; frame < FRAMES; frame++)
                component.render(140);
              const wallMs = performance.now() - wallStart;
              const avgMs = wallMs / FRAMES;
              console.log(
                `[render-measure] ${FRAMES} frames in ${wallMs.toFixed(1)}ms ` +
                  `(avg ${avgMs.toFixed(3)}ms/frame)`,
              );
              // Generous ceiling: a full-frame widget render must stay far below
              // even a 10 fps redraw budget (100 ms), otherwise caching would be
              // justified. This asserts architecture headroom, not exact speed.
              assert(
                avgMs < 5,
                `one full widget frame stays well under any tick budget (${avgMs.toFixed(3)}ms avg)`,
              );
            }
            await bench.runHooks("session_shutdown", {}, benchContext);
          }
        }

        // Pi may emit agent_end before retry, compaction, or another agent run.
        // Aurora must keep its existing activity visible until agent_settled.
        {
          const lifecycleHarness = createHarness();
          auroraUi.default(lifecycleHarness.api);
          const lifecycleContext = lifecycleHarness.makeContext({
            sessionId: "aurora-lifecycle-session",
          });
          const originalNow = Date.now;
          let clock = 1_000_000;
          Date.now = () => clock;
          const renderActivity = () => {
            const factory =
              lifecycleHarness.widgets.get("aurora-ui/activity")?.content;
            return typeof factory === "function"
              ? factory(
                  { terminal: { columns: 140, rows: 30 }, requestRender() {} },
                  lifecycleContext.ui.theme,
                )
                  .render(140)
                  .map(stripAnsi)
                  .join("\\n")
              : "";
          };
          try {
            await lifecycleHarness.runHooks(
              "session_start",
              {},
              lifecycleContext,
            );
            // Panel-dashboard semantics; pin explicitly against mode leakage.
            await lifecycleContext.ui.submitSlashCommand("/dashboard expanded");

            // Normal success: agent_end retains both the response status and its
            // clock; the subsequent terminal event alone makes Aurora idle.
            await lifecycleHarness.runHooks(
              "agent_start",
              {},
              lifecycleContext,
            );
            await lifecycleHarness.runHooks(
              "message_update",
              { assistantMessageEvent: { type: "text_delta" } },
              lifecycleContext,
            );
            clock += 3_000;
            await lifecycleHarness.runHooks("agent_end", {}, lifecycleContext);
            const afterEnd = renderActivity();
            assert(
              afterEnd.includes("ANTWORTET") && afterEnd.includes("3s"),
              "agent_end keeps a successful turn's response status and timer visible",
            );
            eq(
              lifecycleHarness.workingVisibility.at(-1),
              false,
              "agent_end leaves Aurora as the sole visible work indicator",
            );
            await lifecycleHarness.runHooks(
              "agent_settled",
              {},
              lifecycleContext,
            );
            assert(
              renderActivity().includes("AUFGABE") &&
                !renderActivity().includes("DENKT NACH"),
              "agent_settled clears normal live activity while preserving the dashboard",
            );

            // A transient provider failure produces agent_end before Pi waits and
            // starts the retry. Neither boundary may create an idle gap.
            await lifecycleHarness.runHooks(
              "agent_start",
              {},
              lifecycleContext,
            );
            clock += 3_000;
            await lifecycleHarness.runHooks("agent_end", {}, lifecycleContext);
            assert(
              renderActivity().includes("DENKT NACH") &&
                renderActivity().includes("3s"),
              "agent_end keeps retry activity and its timer visible while Pi prepares the next run",
            );
            await lifecycleHarness.runHooks(
              "agent_start",
              {},
              lifecycleContext,
            );
            assert(
              renderActivity().includes("DENKT NACH"),
              "the retry's next agent run has no idle-widget gap",
            );
            await lifecycleHarness.runHooks(
              "agent_settled",
              {},
              lifecycleContext,
            );
            assert(
              renderActivity().includes("AUFGABE") &&
                !renderActivity().includes("DENKT NACH"),
              "the retried turn clears live activity only after settling",
            );

            // Overflow recovery compacts between loops. Aurora has no synthetic
            // compaction state, so existing activity must survive both events.
            await lifecycleHarness.runHooks(
              "agent_start",
              {},
              lifecycleContext,
            );
            await lifecycleHarness.runHooks(
              "message_update",
              { assistantMessageEvent: { type: "text_delta" } },
              lifecycleContext,
            );
            clock += 3_000;
            await lifecycleHarness.runHooks("agent_end", {}, lifecycleContext);
            await lifecycleHarness.runHooks(
              "session_before_compact",
              { reason: "overflow", willRetry: true },
              lifecycleContext,
            );
            await lifecycleHarness.runHooks(
              "session_compact",
              { reason: "overflow", willRetry: true },
              lifecycleContext,
            );
            assert(
              renderActivity().includes("ANTWORTET") &&
                renderActivity().includes("3s"),
              "compaction after agent_end retains the active response widget and timer",
            );
            await lifecycleHarness.runHooks(
              "agent_start",
              {},
              lifecycleContext,
            );
            assert(
              renderActivity().includes("DENKT NACH"),
              "the post-compaction agent run remains active",
            );
            await lifecycleHarness.runHooks(
              "agent_settled",
              {},
              lifecycleContext,
            );
            assert(
              renderActivity().includes("AUFGABE") &&
                !renderActivity().includes("DENKT NACH"),
              "the post-compaction turn clears live activity only after settling",
            );

            // agent_end must not discard an in-flight foreground subagent. The
            // terminal settle boundary remains responsible for that cleanup.
            await lifecycleHarness.runHooks(
              "agent_start",
              {},
              lifecycleContext,
            );
            await lifecycleHarness.runHooks(
              "tool_execution_start",
              {
                toolCallId: "lifecycle-subagent",
                toolName: "subagent",
                args: { agent: "lifecycle-worker" },
              },
              lifecycleContext,
            );
            await lifecycleHarness.runHooks("agent_end", {}, lifecycleContext);
            assert(
              renderActivity().includes("lifecycle-worker"),
              "agent_end retains visible foreground subagent activity",
            );
            await lifecycleHarness.runHooks(
              "agent_settled",
              {},
              lifecycleContext,
            );
            assert(
              !renderActivity().includes("foreground-subagent") &&
                renderActivity().includes("AUFGABE"),
              "agent_settled clears foreground subagent activity but keeps the dashboard",
            );

            // Final provider errors and a user abort follow the same terminal
            // contract: their agent_end is not an Aurora completion signal.
            for (const outcome of ["provider error", "user abort"]) {
              await lifecycleHarness.runHooks(
                "agent_start",
                {},
                lifecycleContext,
              );
              clock += 2_000;
              await lifecycleHarness.runHooks(
                "agent_end",
                { outcome },
                lifecycleContext,
              );
              assert(
                renderActivity().includes("DENKT NACH") &&
                  renderActivity().includes("2s"),
                `${outcome} remains active with its timer until agent_settled`,
              );
              await lifecycleHarness.runHooks(
                "agent_settled",
                {},
                lifecycleContext,
              );
              assert(
                renderActivity().includes("AUFGABE") &&
                  !renderActivity().includes("DENKT NACH"),
                `${outcome} clears live activity only at agent_settled`,
              );
            }

            // A tool followed by assistant text switches presentation normally;
            // agent_end keeps that final response visible until it settles.
            await lifecycleHarness.runHooks(
              "agent_start",
              {},
              lifecycleContext,
            );
            await lifecycleHarness.runHooks(
              "tool_execution_start",
              { toolCallId: "lifecycle-tool", toolName: "read", args: {} },
              lifecycleContext,
            );
            assert(
              renderActivity().includes("ARBEITET"),
              "a tool call shows Tool activity",
            );
            await lifecycleHarness.runHooks(
              "tool_execution_end",
              { toolCallId: "lifecycle-tool", toolName: "read" },
              lifecycleContext,
            );
            await lifecycleHarness.runHooks(
              "message_update",
              { assistantMessageEvent: { type: "text_delta" } },
              lifecycleContext,
            );
            assert(
              renderActivity().includes("ANTWORTET"),
              "assistant text after a tool call shows Responding activity",
            );
            clock += 1_000;
            await lifecycleHarness.runHooks("agent_end", {}, lifecycleContext);
            assert(
              renderActivity().includes("ANTWORTET") &&
                renderActivity().includes("1s"),
              "agent_end does not hide tool-and-text activity or stop its timer",
            );
            await lifecycleHarness.runHooks(
              "agent_settled",
              {},
              lifecycleContext,
            );
            assert(
              renderActivity().includes("AUFGABE") &&
                renderActivity().includes("Bereit für die nächste Aufgabe."),
              "agent_settled keeps the session dashboard visible after live activity ends",
            );
          } finally {
            Date.now = originalNow;
            await lifecycleHarness.runHooks(
              "session_shutdown",
              {},
              lifecycleContext,
            );
          }
        }

        // Task Projection, Receipts, and Task Workspace rendering tests
        {
          const receiptsMod = await load("extensions/aurora-ui/receipts.ts");
          const projectionMod = await load(
            "extensions/aurora-ui/task-projection.ts",
          );
          const inspectorMod = await load("extensions/aurora-ui/inspector.ts");
          const renderersMod = await load(
            "extensions/aurora-ui/tool-renderers.ts",
          );

          if (receiptsMod && projectionMod && inspectorMod && renderersMod) {
            const { ReceiptAggregator } = receiptsMod;
            const {
              projectTaskViewModel,
              determineTaskPhase,
              extractTaskTitle,
              projectVerificationState,
              projectSubagentBranches,
            } = projectionMod;
            const {
              renderProgressBar,
              renderSubagentBranches,
              renderVerificationBlock,
              renderTaskWorkspace,
              renderTaskHeader,
              renderChangingFiles,
              renderDashboard,
              renderAutoDashboard,
            } = renderersMod;
            const { renderInspectorBox } = inspectorMod;

            // 1. ReceiptAggregator unit tests
            const agg = new ReceiptAggregator();
            agg.recordStart("1", "read", { path: "src/main.ts" }, 1000);
            agg.recordEnd("1", "content", false, 1100);
            agg.recordStart("2", "read", { path: "src/utils.ts" }, 1200);
            agg.recordEnd("2", "content", false, 1300);
            agg.recordStart("3", "grep", { query: "export function" }, 1400);
            agg.recordEnd("3", "matches", false, 1500);
            agg.recordStart("4", "edit", { path: "src/main.ts" }, 1600);
            agg.recordEnd("4", "ok", false, 1700);

            const receipts = agg.getReceipts();
            eq(
              receipts.length,
              3,
              "ReceiptAggregator aggregates investigation, search, and real edit events",
            );
            assert(
              receipts.some(
                (r) =>
                  r.kind === "investigation" && r.summary.includes("2 Dateien"),
              ),
              "investigation receipt aggregated",
            );
            assert(
              receipts.some(
                (r) =>
                  r.kind === "search" && r.summary.includes("1 Suchabfrage"),
              ),
              "search receipt aggregated",
            );
            assert(
              receipts.some(
                (r) =>
                  r.kind === "edit" &&
                  r.summary === "1 Datei geändert" &&
                  !r.summary.includes("+") &&
                  r.metrics?.join(" ") === "1 files",
              ),
              "edit receipt reports only the file count supplied by its real event",
            );

            // Error preservation
            agg.recordStart("err1", "bash", { command: "exit 1" }, 1800);
            agg.recordEnd("err1", "Command failed with code 1", true, 1900);
            const withError = agg.getReceipts();
            assert(
              withError.some(
                (r) =>
                  r.status === "failed" &&
                  r.errorDetails?.includes("failed with code 1"),
              ),
              "tool errors are preserved in receipts",
            );

            // 1b. detailRef resolves back to the underlying raw record via
            // getRecord() — investigation/search receipts are built from real
            // recordStart/recordEnd calls above, so their detailRef must
            // resolve, and an error receipt's detailRef must point at the
            // record that actually failed.
            const investigationReceipt = withError.find(
              (r) => r.kind === "investigation",
            );
            assert(
              investigationReceipt?.detailRef &&
                agg.getRecord(investigationReceipt.detailRef)?.toolName ===
                  "read",
              "investigation receipt's detailRef resolves back to a real read record",
            );
            const searchReceipt = withError.find((r) => r.kind === "search");
            assert(
              searchReceipt?.detailRef &&
                agg.getRecord(searchReceipt.detailRef)?.toolName === "grep",
              "search receipt's detailRef resolves back to a real grep record",
            );
            const errorReceipt = withError.find(
              (r) => r.status === "failed" && r.kind === "generic",
            );
            eq(
              errorReceipt?.detailRef,
              "err1",
              "error receipt's detailRef is the id of the record that failed",
            );
            eq(
              agg.getRecord("err1")?.toolName,
              "bash",
              "the failing record itself resolves via getRecord",
            );

            // 1c. An edit receipt built from a real tool record carries a
            // resolvable detailRef pointing at the last-touched file's record.
            const editAgg = new ReceiptAggregator();
            editAgg.recordStart("e1", "edit", { path: "src/app.ts" }, 100);
            editAgg.recordEnd("e1", "ok", false, 200);
            const editReceipt = editAgg
              .getReceipts()
              .find((r) => r.kind === "edit");
            assert(
              editReceipt?.detailRef === "e1" &&
                editAgg.getRecord("e1")?.args?.path === "src/app.ts",
              "edit receipt's detailRef resolves to the record for the last touched file",
            );

            // 1d. The recent-records ring buffer is bounded: the oldest record
            // is evicted once it fills up, but that never removes the receipt
            // itself or the error detail already embedded inline on it.
            const ringAgg = new ReceiptAggregator();
            ringAgg.recordStart("first", "bash", { command: "echo 1" }, 0);
            ringAgg.recordEnd("first", "1", false, 1);
            for (let i = 0; i < 25; i++) {
              ringAgg.recordStart(
                `fill-${i}`,
                "bash",
                { command: "noop" },
                i + 2,
              );
              ringAgg.recordEnd(`fill-${i}`, "ok", false, i + 3);
            }
            eq(
              ringAgg.getRecord("first"),
              undefined,
              "the oldest record is evicted once the recent-records ring buffer fills up",
            );
            eq(
              ringAgg.getRecord("fill-24")?.toolName,
              "bash",
              "the most recently completed record is still resolvable",
            );

            const ringErrAgg = new ReceiptAggregator();
            ringErrAgg.recordStart(
              "early-error",
              "bash",
              { command: "exit 1" },
              0,
            );
            ringErrAgg.recordEnd("early-error", "boom", true, 1);
            for (let i = 0; i < 25; i++) {
              ringErrAgg.recordStart(
                `noise-${i}`,
                "bash",
                { command: "ok" },
                i + 2,
              );
              ringErrAgg.recordEnd(`noise-${i}`, "ok", false, i + 3);
            }
            const survivingErrorReceipt = ringErrAgg
              .getReceipts()
              .find((r) => r.id === "early-error");
            assert(
              survivingErrorReceipt?.errorDetails?.includes("boom"),
              "an error receipt's errorDetails survives ring-buffer eviction of its raw record",
            );
            eq(
              ringErrAgg.getRecord("early-error"),
              undefined,
              "only the stale detailRef lookup is lost on eviction, never the receipt itself",
            );

            // 2. Task Phase determination
            eq(
              determineTaskPhase({
                mode: "simple_plan",
                activityKind: "tool",
                verificationStatus: null,
                hasActiveVerificationTool: false,
              }).phase,
              "plan",
              "plan mode maps to plan phase",
            );
            eq(
              determineTaskPhase({
                mode: "work",
                activityKind: "thinking",
                verificationStatus: null,
                hasActiveVerificationTool: false,
              }).phase,
              "understand",
              "work thinking maps to understand phase",
            );
            eq(
              determineTaskPhase({
                mode: "work",
                activityKind: "tool",
                verificationStatus: null,
                hasActiveVerificationTool: false,
              }).phase,
              "work",
              "work tool maps to work phase",
            );
            eq(
              determineTaskPhase({
                mode: "work",
                activityKind: "idle",
                verificationStatus: "checks_failed",
                hasActiveVerificationTool: false,
              }).phase,
              "verify",
              "failed verification maps to verify phase",
            );
            eq(
              determineTaskPhase({
                mode: "work",
                activityKind: "idle",
                verificationStatus: "verified",
                hasActiveVerificationTool: false,
              }).phase,
              "done",
              "verified status maps to done phase",
            );

            // 2b. Phase/verification contradiction matrix
            // (pi-tui-optimization-package/04-test-matrix.md, automated state tests)
            const noTools = new Map();
            const editTool = new Map([
              [
                "t1",
                {
                  id: "t1",
                  name: "edit",
                  kind: "edit",
                  target: "src/main.ts",
                  startedAt: Date.now(),
                },
              ],
            ]);
            const verifyTool = new Map([
              [
                "v1",
                {
                  id: "v1",
                  name: "project_check",
                  kind: "verification",
                  startedAt: Date.now(),
                },
              ],
            ]);

            // Scenario 1: idle after current successful verification.
            eq(
              determineTaskPhase({
                mode: "work",
                activityKind: "idle",
                verificationStatus: "verified",
                hasActiveVerificationTool: false,
                verificationIsCurrent: true,
              }).phase,
              "done",
            );
            eq(projectVerificationState("verified", noTools).verdict, "READY");

            // Scenario 2: edit starts after successful verification — active work,
            // never a running check, and the verdict turns unverified.
            eq(
              determineTaskPhase({
                mode: "work",
                activityKind: "tool",
                verificationStatus: "verified",
                hasActiveVerificationTool: false,
                verificationIsCurrent: false,
              }).phase,
              "work",
            );
            eq(
              projectVerificationState("verified", editTool).verdict,
              "UNVERIFIED",
            );

            // Scenario 3: edit finished after successful verification (idle again,
            // but the check is now stale) — must not be done.
            eq(
              determineTaskPhase({
                mode: "work",
                activityKind: "idle",
                verificationStatus: "verified",
                hasActiveVerificationTool: false,
                verificationIsCurrent: false,
              }).phase,
              "work",
            );
            eq(
              projectVerificationState("verified", noTools, null, true).verdict,
              "UNVERIFIED",
            );

            // Scenario 4: required check fails while idle — an invitation to
            // re-check, with the failure verdict, never a fabricated success.
            eq(
              determineTaskPhase({
                mode: "work",
                activityKind: "idle",
                verificationStatus: "checks_failed",
                hasActiveVerificationTool: false,
                verificationIsCurrent: true,
              }).phase,
              "verify",
            );
            eq(
              projectVerificationState("checks_failed", noTools).verdict,
              "NOT_READY",
            );

            // Scenario 5: editing to fix the failed check stays work — the earlier
            // failure must not present as a currently running verification. The
            // existing verdict contract keeps a structured failed summary at
            // NOT_READY and degrades an unstructured stale one to UNVERIFIED.
            eq(
              determineTaskPhase({
                mode: "work",
                activityKind: "tool",
                verificationStatus: "checks_failed",
                hasActiveVerificationTool: false,
                verificationIsCurrent: false,
              }).phase,
              "work",
            );
            assert(
              ["NOT_READY", "UNVERIFIED"].includes(
                projectVerificationState("checks_failed", editTool).verdict,
              ),
              "an edit after a failed check never fabricates READY",
            );

            // Scenario 6: only a real running verification tool claims verify,
            // and its in-flight result is unverified.
            eq(
              determineTaskPhase({
                mode: "work",
                activityKind: "tool",
                verificationStatus: null,
                hasActiveVerificationTool: true,
                verificationIsCurrent: false,
              }).phase,
              "verify",
            );
            eq(
              projectVerificationState(null, verifyTool).verdict,
              "UNVERIFIED",
            );

            // Scenarios 7 & 8: planning keeps its semantics without fabricating
            // a verification result.
            eq(
              determineTaskPhase({
                mode: "simple_plan",
                activityKind: "thinking",
                verificationStatus: null,
                hasActiveVerificationTool: false,
              }).phase,
              "understand",
            );
            eq(
              determineTaskPhase({
                mode: "detailed_plan",
                activityKind: "tool",
                verificationStatus: null,
                hasActiveVerificationTool: false,
              }).phase,
              "plan",
            );
            eq(projectVerificationState(null, noTools, null, false), undefined);

            // Invariant across every activity × status × staleness combination:
            // a done phase requires verified + current (no mutation since).
            for (const kind of ["thinking", "tool", "responding", "idle"]) {
              for (const status of [
                null,
                "verified",
                "checks_failed",
                "unchanged",
              ]) {
                for (const current of [true, false]) {
                  for (const hasVerify of [true, false]) {
                    const { phase } = determineTaskPhase({
                      mode: "work",
                      activityKind: kind,
                      verificationStatus: status,
                      hasActiveVerificationTool: hasVerify,
                      verificationIsCurrent: current,
                    });
                    if (phase !== "done") continue;
                    assert(
                      status === "verified" && current && !hasVerify,
                      `phase done implies READY and current verification (kind=${kind} status=${status} current=${current})`,
                    );
                  }
                }
              }
            }
            const doneTvm = projectTaskViewModel({
              state: {
                sessionEpoch: "test-epoch",
                workflow: { phase: "work", label: "Work" },
                permissions: {},
                lsp: {},
                model: { id: "test-model", thinking: "medium" },
                activity: { kind: "idle" },
              },
              activeTools: noTools,
              subagents: [],
              verificationStatus: "verified",
              workspaceChangedSinceVerification: false,
              now: Date.now(),
            });
            assert(
              doneTvm.phase === "done" &&
                doneTvm.verification?.verdict === "READY",
              "the projected view model pairs done with a READY verdict only",
            );

            // 3. Task Title extraction
            eq(
              extractTaskTitle(
                undefined,
                "# Fix Compaction\n\nZiel: threshold fix",
              ).title,
              "Fix Compaction",
              "plan title extracted",
            );
            eq(
              extractTaskTitle("/work Fix the broken test").title,
              "Fix the broken test",
              "prompt title extracted",
            );

            // 4. Progress bar rendering
            const pb = renderProgressBar("work", context.ui.theme, 120);
            assert(
              pb.includes("Verstehen") &&
                pb.includes("Arbeiten") &&
                pb.includes("Fertig"),
              "progress bar renders all phases",
            );

            // 5. Subagent branch rendering
            const subagentBranches = renderSubagentBranches(
              [
                {
                  agent: "investigator",
                  status: "completed",
                  focus: "Found 2 root causes",
                },
                {
                  agent: "verifier",
                  status: "running",
                  focus: "Running tests",
                },
              ],
              context.ui.theme,
              120,
            );
            assert(
              subagentBranches.some((l) => l.includes("investigator")) &&
                subagentBranches.some((l) => l.includes("Found 2 root causes")),
              "subagent branch rendered with findings",
            );

            // 5b. Every SubagentBranchInfo status renders a distinct, labeled
            // line — including "paused", which previously had no branch
            // rendering at all and fell through projectSubagentBranches as a
            // mislabeled "completed" (see the regression test below).
            for (const status of [
              "running",
              "paused",
              "completed",
              "failed",
              "needs_attention",
              "queued",
            ]) {
              const lines = renderSubagentBranches(
                [{ agent: "a", status }],
                context.ui.theme,
                120,
              );
              assert(
                lines.length > 0 && lines[0].includes("a"),
                `renderSubagentBranches renders a "${status}" branch`,
              );
            }

            // 5c. projectSubagentBranches maps every live SubagentInfo status
            // explicitly — "paused" must not fall through to "completed".
            const pausedBranch = projectSubagentBranches([
              { agent: "investigator", status: "paused" },
            ])[0];
            eq(
              pausedBranch.status,
              "paused",
              "a paused subagent is projected as paused, not completed",
            );
            const otherStatuses = projectSubagentBranches([
              { agent: "a", status: "running" },
              { agent: "b", status: "needs_attention" },
              { agent: "c", status: "queued" },
            ]).map((b) => b.status);
            eq(
              otherStatuses.join(","),
              "running,needs_attention,queued",
              "the other live subagent statuses still map straight through",
            );

            // 6. Verification block rendering
            const verifyBlock = renderVerificationBlock(
              {
                verdict: "READY",
                criteria: [{ label: "Unit tests passing", status: "passed" }],
                blockers: [],
              },
              context.ui.theme,
              120,
            );
            assert(
              verifyBlock.some(
                (l) => l.includes("PRÜFUNGEN") && l.includes("BEREIT"),
              ),
              "verification block renders ready verdict",
            );

            // 7. Inspector box rendering
            const inspectorBox = renderInspectorBox(
              {
                title: "CHANGES",
                badge: "3 files",
                sections: [
                  { title: "Modified", lines: ["src/main.ts (+10 -2)"] },
                ],
                actions: [{ label: "Open Diff", key: "Enter" }],
              },
              context.ui.theme,
              80,
            );
            assert(
              inspectorBox.some(
                (l) => l.includes("CHANGES") && l.includes("3 files"),
              ),
              "inspector box renders header and badge",
            );

            // 8. Full task view model & workspace rendering
            const tvm = projectTaskViewModel({
              state: {
                sessionEpoch: "test-epoch",
                workflow: { phase: "work", label: "Work" },
                permissions: {},
                lsp: {},
                model: { id: "test-model", thinking: "medium" },
                activity: { kind: "tool" },
              },
              activeTools: new Map([
                [
                  "t1",
                  {
                    id: "t1",
                    name: "edit",
                    kind: "edit",
                    target: "src/main.ts",
                    startedAt: Date.now() - 5000,
                  },
                ],
              ]),
              subagents: [],
              receiptAggregator: agg,
              now: Date.now(),
            });
            eq(tvm.phase, "work", "task view model computes correct phase");
            const workspaceLines = renderTaskWorkspace(
              tvm,
              context.ui.theme,
              120,
            );
            assert(
              workspaceLines.some((l) => l.includes("AKTUELLE ARBEIT")),
              "renderTaskWorkspace includes current work block",
            );

            const idleDashboard = renderDashboard(
              {
                ...tvm,
                phase: "done",
                phaseLabel: "Fertig",
                currentWork: undefined,
              },
              context.ui.theme,
              120,
              { activityLines: [], maxRows: 8 },
            );
            assert(
              idleDashboard.some((line) => line.includes("AUFGABE")) &&
                idleDashboard.some((line) =>
                  line.includes("Letzte Aufgabe abgeschlossen."),
                ),
              "the dashboard remains useful after a turn has settled",
            );
            // Wide terminals pair tiles side by side: task + verification cost
            // the taller member's height (4 rows), the activity/changes pair
            // 3–4 more. The failure verdict stays visible at every budget;
            // routine tiles join only once the grid actually fits the budget.
            for (const maxRows of [5, 6, 7, 8]) {
              const activityFits = maxRows >= 7;
              const failedDashboard = renderDashboard(
                {
                  ...tvm,
                  verification: {
                    verdict: "NOT_READY",
                    criteria: [{ label: "Tests", status: "failed" }],
                    blockers: ["Pflichtprüfung fehlgeschlagen."],
                  },
                },
                context.ui.theme,
                120,
                { activityLines: ["ARBEITET"], maxRows },
              );
              assert(
                failedDashboard.some((line) => line.includes("NICHT BEREIT")) &&
                  failedDashboard.some((line) => line.includes("AKTIVITÄT")) ===
                    activityFits,
                `a failed verification survives the ${maxRows}-row budget${
                  activityFits
                    ? " while the grid still fits routine activity"
                    : " before routine activity"
                }`,
              );
              const changesFits = maxRows >= 8;
              const failedDashboardWithChanges = renderDashboard(
                {
                  ...tvm,
                  changesSummary: {
                    filesCount: 1,
                    files: ["src/a.ts"],
                    linesAdded: 1,
                    linesRemoved: 0,
                  },
                  verification: {
                    verdict: "NOT_READY",
                    criteria: [{ label: "Tests", status: "failed" }],
                    blockers: ["Pflichtprüfung fehlgeschlagen."],
                  },
                },
                context.ui.theme,
                120,
                { activityLines: [], maxRows },
              );
              assert(
                failedDashboardWithChanges.some((line) =>
                  line.includes("NICHT BEREIT"),
                ) &&
                  failedDashboardWithChanges.some((line) =>
                    line.includes("ÄNDERUNGEN"),
                  ) ===
                    changesFits,
                `a failed verification survives the ${maxRows}-row budget${
                  changesFits
                    ? " while the grid still fits the changes tile"
                    : " before changes"
                }`,
              );
            }
            const compactDashboard = renderDashboard(
              tvm,
              context.ui.theme,
              45,
              {
                activityLines: ["ARBEITET · 1s"],
                maxRows: 2,
                compact: true,
              },
            );
            assert(
              compactDashboard.length <= 2 &&
                compactDashboard.some((line) => line.includes("ARBEITEN")),
              "the compact dashboard preserves the current phase in two rows",
            );

            // 8c. Responsive permanent auto-dashboard matrix.
            const failedAuto = renderAutoDashboard(
              {
                ...tvm,
                verification: {
                  verdict: "NOT_READY",
                  criteria: [{ label: "Tests", status: "failed" }],
                  blockers: ['Pflichtprüfung "test" ist fehlgeschlagen.'],
                },
              },
              context.ui.theme,
              100,
              {
                activityLines: ["ARBEITET · 9s"],
                layout: "standard",
                hasActiveWork: true,
                verificationStale: false,
                verificationKnown: true,
              },
            );
            const failedAutoText = failedAuto.map(stripAnsi).join("\n");
            assert(
              failedAutoText.indexOf("Prüfung fehlgeschlagen") !== -1 &&
                failedAutoText.indexOf("Prüfung fehlgeschlagen") <
                  failedAutoText.indexOf("ARBEITET"),
              "auto mode shows the failure verdict before routine activity",
            );
            assert(
              failedAuto.some((line) => line.includes("ist fehlgeschlagen")) &&
                !failedAutoText.includes("Prüfung · Nicht bereit"),
              "auto mode names the most relevant blocker without duplicating its verdict",
            );

            const staleAuto = renderAutoDashboard(
              { ...tvm, phase: "work", phaseLabel: "Bereit" },
              context.ui.theme,
              100,
              {
                activityLines: [],
                layout: "standard",
                hasActiveWork: false,
                verificationStale: true,
                verificationKnown: true,
              },
            );
            assert(
              staleAuto.some((line) =>
                stripAnsi(line).includes("Prüfung offen"),
              ) &&
                !staleAuto.some((line) =>
                  stripAnsi(line).includes("Prüfung · Offen"),
                ) &&
                !staleAuto.some((line) => stripAnsi(line).includes("Fertig")),
              "a stale check is reported as open once, never as finished",
            );

            const changesAuto = renderAutoDashboard(
              {
                ...tvm,
                phase: "done",
                phaseLabel: "Fertig",
                changesSummary: {
                  filesCount: 4,
                  files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
                  linesAdded: 30,
                  linesRemoved: 5,
                },
              },
              context.ui.theme,
              100,
              {
                activityLines: [],
                layout: "standard",
                hasActiveWork: false,
                verificationStale: false,
                verificationKnown: false,
              },
            );
            assert(
              changesAuto.length <= 7 &&
                changesAuto.some((line) =>
                  stripAnsi(line).includes("4 Dateien"),
                ) &&
                changesAuto.some((line) => stripAnsi(line).includes("+30 −5")) &&
                changesAuto.some((line) => stripAnsi(line).includes("FERTIG")),
              "idle sessions condense completed changes into one summary line under an uppercase phase badge",
            );

            const cleanIdleAuto = renderAutoDashboard(
              { ...tvm, phase: "work", phaseLabel: "Bereit" },
              context.ui.theme,
              100,
              {
                activityLines: [],
                layout: "standard",
                hasActiveWork: false,
                verificationStale: false,
                verificationKnown: false,
              },
            );
            assert(
              cleanIdleAuto.length > 0 &&
                cleanIdleAuto.length <= 4 &&
                cleanIdleAuto.some((line) => stripAnsi(line).includes("Sitzung")) &&
                !stripAnsi(cleanIdleAuto.join("\n")).includes(
                  "Noch keine Änderungen",
                ) &&
                !stripAnsi(cleanIdleAuto.join("\n")).includes(
                  "Noch nicht ausgeführt",
                ) &&
                !stripAnsi(cleanIdleAuto.join("\n")).includes(
                  "Bereit für die nächste Aufgabe",
                ),
              "an idle session without state keeps only the card frame plus its task row — no zero statements",
            );

            const narrowAuto = renderAutoDashboard(tvm, context.ui.theme, 40, {
              activityLines: ["ARBEITET · 4s", "◌ Lesen README.md"],
              layout: "compact",
              hasActiveWork: true,
              verificationStale: false,
              verificationKnown: false,
            });
            const { visibleWidth: cellWidth } = await import(
              pathToFileURL(
                path.join(
                  ROOT,
                  "npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js",
                ),
              ).href
            );
            assert(
              narrowAuto.length <= 2 &&
                narrowAuto.every((line) => cellWidth(stripAnsi(line)) <= 40),
              "small terminals get at most two width-safe auto rows",
            );

            // 8d. The two-row fallback never spends a row on a zero statement.
            const narrowIdleAuto = renderAutoDashboard(
              tvm,
              context.ui.theme,
              40,
              {
                activityLines: [],
                layout: "compact",
                hasActiveWork: false,
                verificationStale: false,
                verificationKnown: false,
              },
            );
            assert(
              stripAnsi(narrowIdleAuto.join("\n")).includes("ARBEITEN") &&
                !stripAnsi(narrowIdleAuto.join("\n")).includes(
                  "Noch nicht ausgeführt",
                ) &&
                !stripAnsi(narrowIdleAuto.join("\n")).includes(
                  "Noch nicht bereit",
                ) &&
                narrowIdleAuto.length === 1,
              "a small idle terminal never spends its second auto row on an unrun-check statement",
            );

            const narrowSettledAuto = renderAutoDashboard(
              {
                ...tvm,
                verification: { verdict: "READY" },
                changesSummary: {
                  filesCount: 3,
                  files: ["src/a.ts", "src/b.ts", "src/c.ts"],
                  linesAdded: 7,
                  linesRemoved: 2,
                },
              },
              context.ui.theme,
              40,
              {
                activityLines: [],
                layout: "compact",
                hasActiveWork: false,
                verificationStale: false,
                verificationKnown: true,
              },
            );
            const narrowSettledText = stripAnsi(narrowSettledAuto.join("\n"));
            assert(
              narrowSettledAuto.length === 2 &&
                narrowSettledText.includes("+7") &&
                narrowSettledText.includes("Prüfung · Bereit"),
              "with real state present, the second compact row condenses changes plus verdict into one line",
            );

            // 8b. changesSummary flows into currentWork.changingFiles as the
            // cumulative change list, not the single currently-running tool's
            // target (regression guard for the earlier duplication with the
            // active-tool line).
            const tvmWithChanges = projectTaskViewModel({
              state: {
                sessionEpoch: "test-epoch",
                workflow: { phase: "work", label: "Work" },
                permissions: {},
                lsp: {},
                model: { id: "test-model", thinking: "medium" },
                activity: { kind: "tool" },
                changes: {
                  filesCount: 2,
                  files: ["src/main.ts", "src/utils.ts"],
                  linesAdded: 20,
                  linesRemoved: 5,
                },
                verification: null,
              },
              activeTools: new Map([
                [
                  "t1",
                  {
                    id: "t1",
                    name: "edit",
                    kind: "edit",
                    target: "src/main.ts",
                    startedAt: Date.now() - 2000,
                  },
                ],
              ]),
              subagents: [],
              receiptAggregator: agg,
              now: Date.now(),
            });
            assert(
              tvmWithChanges.changesSummary?.filesCount === 2 &&
                tvmWithChanges.changesSummary.files.includes("src/main.ts") &&
                tvmWithChanges.changesSummary.files.includes("src/utils.ts"),
              "changesSummary is projected from state.changes",
            );
            assert(
              tvmWithChanges.currentWork?.changingFiles?.length === 2 &&
                tvmWithChanges.currentWork.changingFiles.includes(
                  "src/utils.ts",
                ),
              "currentWork.changingFiles reflects the cumulative change list, not just the active tool's target",
            );
            const changingFilesLines = renderChangingFiles(
              tvmWithChanges.currentWork,
              context.ui.theme,
              120,
            );
            assert(
              changingFilesLines.some(
                (l) =>
                  l.includes("Geändert:") &&
                  l.includes("src/main.ts") &&
                  l.includes("src/utils.ts"),
              ),
              "renderChangingFiles renders the full cumulative change list",
            );
            eq(
              renderChangingFiles(
                { changingFiles: undefined },
                context.ui.theme,
                120,
              ).length,
              0,
              "renderChangingFiles renders nothing without changed files",
            );

            // 8c. projectVerificationState: dynamic checks from a structured
            // verification summary (setup-core's requiredOutcomes/blockingRecommendedIds),
            // covering every negative case the test plan requires plus a
            // false-positive-READY guard.
            const noActiveTools = new Map();
            const verifyToolActive = new Map([
              [
                "v1",
                {
                  id: "v1",
                  name: "verify",
                  kind: "verification",
                  startedAt: Date.now(),
                },
              ],
            ]);

            // Case 1: a required check failed.
            const failedCase = projectVerificationState(
              "checks_failed",
              noActiveTools,
              {
                status: "checks_failed",
                declaredRequiredIds: ["typecheck"],
                requiredOutcomes: { typecheck: "failed" },
                blockingRecommendedIds: [],
              },
            );
            eq(
              failedCase.verdict,
              "NOT_READY",
              "a failed required check is NOT_READY",
            );
            assert(
              failedCase.checks.some(
                (c) => c.id === "typecheck" && c.status === "failed",
              ),
              "failed required check is reflected in checks[]",
            );
            assert(
              failedCase.blockers.some((b) => b.includes("typecheck")),
              "failed required check produces a blocker",
            );

            // Case 2: a declared required check never ran (open criterion).
            const openCase = projectVerificationState(
              "changed_unverified",
              noActiveTools,
              {
                status: "changed_unverified",
                declaredRequiredIds: ["typecheck", "lint"],
                requiredOutcomes: { typecheck: "success" },
                blockingRecommendedIds: [],
              },
            );
            eq(
              openCase.verdict,
              "UNVERIFIED",
              "an open required check is UNVERIFIED",
            );
            assert(
              openCase.checks.some(
                (c) => c.id === "lint" && c.status === "pending",
              ),
              "a required check missing from requiredOutcomes shows as pending, not passed",
            );

            // Case 3: a blocking recommended (non-required) check failed.
            const recommendedBlockedCase = projectVerificationState(
              "checks_failed",
              noActiveTools,
              {
                status: "checks_failed",
                declaredRequiredIds: ["typecheck"],
                requiredOutcomes: { typecheck: "success" },
                blockingRecommendedIds: ["security-scan"],
              },
            );
            eq(
              recommendedBlockedCase.verdict,
              "NOT_READY",
              "a blocking recommended check is NOT_READY even with all required checks passing",
            );
            assert(
              recommendedBlockedCase.evidence.some((e) =>
                e.includes("security-scan"),
              ),
              "blocking recommended id appears in evidence",
            );

            // Case 4: a required check could not run at all (aborted/unavailable).
            const unavailableCase = projectVerificationState(
              "checks_unavailable",
              noActiveTools,
              {
                status: "checks_unavailable",
                declaredRequiredIds: ["typecheck"],
                requiredOutcomes: { typecheck: "unavailable" },
                blockingRecommendedIds: [],
              },
            );
            eq(
              unavailableCase.verdict,
              "UNVERIFIED",
              "an unavailable required check is UNVERIFIED, never a silent pass",
            );
            assert(
              unavailableCase.checks.every((c) => c.status !== "passed"),
              "no check is falsely reported as passed when it never ran",
            );

            // Case 5: no structured verification summary at all (setup-core
            // disabled/untrusted project) — falls back to the coarse status
            // string. Also asserts the previously hardcoded, always-"passed"
            // "Kontext und Problem analysiert" criterion is gone for good.
            const fallbackCase = projectVerificationState(
              "checks_failed",
              noActiveTools,
              null,
            );
            eq(
              fallbackCase.verdict,
              "NOT_READY",
              "fallback path still derives a verdict from the coarse status string",
            );
            assert(
              fallbackCase.checks.length === 0 &&
                !fallbackCase.criteria.some((c) =>
                  c.label.includes("Kontext und Problem analysiert"),
                ),
              "fallback path never fabricates an always-passed criterion",
            );

            // Case 6: false-positive-READY guard — "verified" with zero
            // declared required checks is a contradiction and must not render
            // as READY.
            const noDeclaredCase = projectVerificationState(
              "verified",
              noActiveTools,
              {
                status: "verified",
                declaredRequiredIds: [],
                requiredOutcomes: {},
                blockingRecommendedIds: [],
              },
            );
            eq(
              noDeclaredCase.verdict,
              "UNVERIFIED",
              "verified with no declared required checks is never shown as READY",
            );

            // An active verification tool run overrides a stale "verified"
            // summary from a previous run — the in-progress check must not
            // still read as READY while it is running.
            const inProgressCase = projectVerificationState(
              "verified",
              verifyToolActive,
              {
                status: "verified",
                declaredRequiredIds: ["typecheck"],
                requiredOutcomes: { typecheck: "success" },
                blockingRecommendedIds: [],
              },
            );
            eq(
              inProgressCase.verdict,
              "UNVERIFIED",
              "an active verification tool run overrides a stale READY verdict",
            );

            const editToolActive = new Map([
              [
                "e1",
                {
                  id: "e1",
                  name: "edit",
                  kind: "edit",
                  startedAt: Date.now(),
                },
              ],
            ]);
            const activeEditCase = projectVerificationState(
              "verified",
              editToolActive,
              {
                status: "verified",
                declaredRequiredIds: ["typecheck"],
                requiredOutcomes: { typecheck: "success" },
                blockingRecommendedIds: [],
              },
            );
            eq(
              activeEditCase.verdict,
              "UNVERIFIED",
              "an active edit invalidates a stale READY verdict",
            );

            const completedEditCase = projectVerificationState(
              "verified",
              noActiveTools,
              {
                status: "verified",
                declaredRequiredIds: ["typecheck"],
                requiredOutcomes: { typecheck: "success" },
                blockingRecommendedIds: [],
              },
              true,
            );
            eq(
              completedEditCase.verdict,
              "UNVERIFIED",
              "a completed edit stays unverified until setup-core publishes a new status",
            );

            // A genuinely passing run is still READY.
            const readyCase = projectVerificationState(
              "verified",
              noActiveTools,
              {
                status: "verified",
                declaredRequiredIds: ["typecheck"],
                requiredOutcomes: { typecheck: "success" },
                blockingRecommendedIds: [],
              },
            );
            eq(
              readyCase.verdict,
              "READY",
              "all declared required checks passing is READY",
            );

            // 9. renderTaskHeader: title-only, title+goal, width crop
            const titleOnly = renderTaskHeader(tvm, context.ui.theme, 120);
            eq(titleOnly.length, 1, "title-only header renders a single line");
            assert(
              titleOnly[0].includes("AKTUELLE AUFGABE"),
              "title-only header renders the uppercased fallback title",
            );

            const tvmWithGoal = projectTaskViewModel({
              state: tvm && {
                sessionEpoch: "test-epoch",
                workflow: { phase: "work", label: "Work" },
                permissions: {},
                lsp: {},
                model: { id: "test-model", thinking: "medium" },
                activity: { kind: "tool" },
              },
              activeTools: new Map(),
              subagents: [],
              receiptAggregator: agg,
              now: Date.now(),
              userPrompt: "Fix the flaky test\nIt fails intermittently in CI.",
            });
            const titleAndGoal = renderTaskHeader(
              tvmWithGoal,
              context.ui.theme,
              120,
            );
            assert(
              titleAndGoal.length === 2 &&
                titleAndGoal[0].includes("FIX THE FLAKY TEST") &&
                titleAndGoal[1].includes("It fails intermittently in CI."),
              "title+goal header renders both lines",
            );

            const croppedTitle = renderTaskHeader(
              tvmWithGoal,
              context.ui.theme,
              10,
            );
            assert(
              croppedTitle.every((l) => stripAnsi(l).length <= 10),
              "renderTaskHeader crops every line to the given width",
            );
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
      } finally {
        if (previousAgentDir === undefined)
          delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        rmSync(tempAgentDir, { recursive: true, force: true });
      }
    });
  },
};
