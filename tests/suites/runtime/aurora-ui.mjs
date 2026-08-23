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
            statuses: new Map([["verification", "Verify: unchanged"]]),
          }).includes("unchanged"),
          "an unchanged workspace does not spend compact footer space",
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
                  { path: `${testCwd}/extensions/aurora-ui/tool-renderers.ts` },
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
              ? stripAnsi(
                  widget({ requestRender() {} }, context.ui.theme).render(
                    120,
                  )[0],
                )
              : "";
          return rendered.slice(0, rendered.indexOf(" "));
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
              ? stripAnsi(
                  widget({ requestRender() {} }, context.ui.theme).render(
                    120,
                  )[0],
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
            "↳ +2 Tools · 1 läuft, 1 fehler · 2 Subagenten · 2 im hintergrund",
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

          // Normal success: agent_end retains both the response status and its
          // clock; the subsequent terminal event alone makes Aurora idle.
          await lifecycleHarness.runHooks("agent_start", {}, lifecycleContext);
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
          eq(
            renderActivity(),
            "",
            "agent_settled alone clears normal activity",
          );

          // A transient provider failure produces agent_end before Pi waits and
          // starts the retry. Neither boundary may create an idle gap.
          await lifecycleHarness.runHooks("agent_start", {}, lifecycleContext);
          clock += 3_000;
          await lifecycleHarness.runHooks("agent_end", {}, lifecycleContext);
          assert(
            renderActivity().includes("DENKT NACH") &&
              renderActivity().includes("3s"),
            "agent_end keeps retry activity and its timer visible while Pi prepares the next run",
          );
          await lifecycleHarness.runHooks("agent_start", {}, lifecycleContext);
          assert(
            renderActivity().includes("DENKT NACH"),
            "the retry's next agent run has no idle-widget gap",
          );
          await lifecycleHarness.runHooks(
            "agent_settled",
            {},
            lifecycleContext,
          );
          eq(
            renderActivity(),
            "",
            "the retried turn clears only after settling",
          );

          // Overflow recovery compacts between loops. Aurora has no synthetic
          // compaction state, so existing activity must survive both events.
          await lifecycleHarness.runHooks("agent_start", {}, lifecycleContext);
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
          await lifecycleHarness.runHooks("agent_start", {}, lifecycleContext);
          assert(
            renderActivity().includes("DENKT NACH"),
            "the post-compaction agent run remains active",
          );
          await lifecycleHarness.runHooks(
            "agent_settled",
            {},
            lifecycleContext,
          );
          eq(
            renderActivity(),
            "",
            "the post-compaction turn clears only after settling",
          );

          // agent_end must not discard an in-flight foreground subagent. The
          // terminal settle boundary remains responsible for that cleanup.
          await lifecycleHarness.runHooks("agent_start", {}, lifecycleContext);
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
          eq(
            renderActivity(),
            "",
            "agent_settled clears foreground subagent activity",
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
            eq(renderActivity(), "", `${outcome} clears only at agent_settled`);
          }

          // A tool followed by assistant text switches presentation normally;
          // agent_end keeps that final response visible until it settles.
          await lifecycleHarness.runHooks("agent_start", {}, lifecycleContext);
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
          eq(
            renderActivity(),
            "",
            "tool-and-text activity clears at agent_settled",
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
};
