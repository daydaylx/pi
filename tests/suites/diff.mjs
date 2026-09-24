import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, eq } from "../shared/assertions.mjs";
import { createHarness, stripAnsi } from "../shared/harness.mjs";
import { ROOT, npmModuleEntry } from "../shared/jiti-loader.mjs";

export const diffSections = {
  "diff viewer regressions": async (context) => {
    const {
      section,
      diffAlgorithm,
      diffFallback,
      diffTracker,
      diffViewer,
      auroraState,
    } = context;

    await section("diff viewer regressions", async () => {
      assert(
        typeof diffAlgorithm?.computeWordDiff === "function",
        "diff algorithm loads",
      );
      assert(
        typeof diffFallback?.computeFallbackDiff === "function",
        "diff fallback loads",
      );
      assert(
        typeof diffAlgorithm?.applyInlineHighlights === "function",
        "diff algorithm owns the shared inline-highlighting helper",
      );
      const diffRenderer = await context.load(
        "extensions/diff-viewer/diff-renderer.ts",
      );
      assert(
        typeof diffRenderer?.renderStatLine === "function",
        "diff renderer loads",
      );
      const statLine = diffRenderer.renderStatLine(
        {
          path: ".agent/plans/a-very-long-plan-name-that-overflows.md",
          linesAdded: 25,
          linesRemoved: 30,
          hunks: 1,
        },
        { fg: (_tone, text) => text },
        38,
      );
      const displayedStatLine = stripAnsi(statLine);
      assert(
        displayedStatLine.length <= 38 && displayedStatLine.endsWith("…"),
        "diff statistic line truncates at narrow terminal widths",
      );
      const { visibleWidth } = await import(
        pathToFileURL(npmModuleEntry("@earendil-works/pi-tui")).href
      );
      const themeModule = await import(
        pathToFileURL(
          path.join(
            ROOT,
            "npm/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js",
          ),
        ).href
      );
      themeModule.initTheme("dark");
      const { DiffEntryComponent } = await context.load(
        "extensions/diff-viewer/diff-entry.ts",
      );
      const collapsedEntry = new DiffEntryComponent(
        { fg: (_tone, text) => text },
        {
          path: "sample.txt",
          stats: {
            path: "sample.txt",
            linesAdded: 7,
            linesRemoved: 0,
            hunks: 1,
          },
          hunks: [
            {
              oldStart: 1,
              oldCount: 0,
              newStart: 1,
              newCount: 7,
              lines: Array.from({ length: 7 }, (_, index) => ({
                kind: "added",
                newLine: index + 1,
                text: `line ${index + 1}`,
              })),
            },
          ],
          toolName: "write",
          timestamp: 0,
        },
        false,
      );
      const collapsedLines = collapsedEntry.render(10);
      assert(
        visibleWidth(collapsedLines.at(-1)) <= 10 &&
          stripAnsi(collapsedLines.at(-1)).endsWith("…"),
        "collapsed diff expand hint fits narrow terminal widths",
      );
      const diffFallbackSource = readFileSync(
        path.join(ROOT, "extensions", "diff-viewer", "git-diff.ts"),
        "utf8",
      );
      assert(
        !/pi\.exec|gitDiffForFile|gitDiffAll|isGitAvailable/.test(
          diffFallbackSource,
        ),
        "active fallback diff has no dormant Git subprocess path",
      );

      const long = "token ".repeat(600);
      eq(
        diffAlgorithm.computeWordDiff(long, long + "changed"),
        [],
        "large inline diffs skip quadratic word highlighting",
      );

      const before = Array.from(
        { length: 20 },
        (_, index) => `line ${index}`,
      ).join("\n");
      const after = before
        .replace("line 2", "line two")
        .replace("line 17", "line seventeen");
      const separated = diffFallback.computeFallbackDiff(
        "sample.txt",
        before,
        after,
      );
      eq(
        separated.hunks.length,
        2,
        "fallback diff separates distant changes into hunks",
      );

      const cleared = diffFallback.computeFallbackDiff(
        "empty.txt",
        "keep\nremove",
        "",
      );
      eq(cleared.stats.linesRemoved, 2, "empty write records removed lines");

      const finalNewline = diffFallback.computeFallbackDiff(
        "newline.txt",
        "",
        "line\n",
      );
      eq(
        finalNewline.stats.linesAdded,
        1,
        "final newline does not add a phantom diff line",
      );

      if (diffViewer?.default) {
        const cwd = mkdtempSync(path.join(tmpdir(), "pi-diff-viewer-p1-"));
        try {
          const file = path.join(cwd, "sample.txt");
          writeFileSync(file, "before\n", "utf8");
          const harness = createHarness();
          diffViewer.default(harness.api);
          const context = harness.makeContext({ cwd });
          await harness.runHooks("session_start", {}, context);

          // diff-viewer participates in the Aurora UI state bus: it answers
          // a state request with its current (still empty) change summary.
          if (auroraState) {
            harness.api.events.emit(auroraState.AURORA_UI_CHANNELS.request, {
              type: "request",
              requestId: "aurora-req-1",
              sessionEpoch: "aurora-epoch-1",
              requester: "aurora-ui",
            });
            const initialSnapshot = harness.emitted.find(
              (e) =>
                e.name === auroraState.AURORA_UI_CHANNELS.snapshot &&
                e.event.source === "diff-viewer",
            );
            assert(
              initialSnapshot,
              "diff-viewer answers an Aurora state request with a snapshot",
            );
            eq(
              initialSnapshot.event.state.changes,
              null,
              "diff-viewer has nothing to report before any edit",
            );
          }

          const changesCommand = harness.commands.get("changes");
          assert(
            typeof changesCommand === "function",
            "diff viewer registers the changes command",
          );
          const nonTuiContext = harness.makeContext({
            cwd,
            mode: "text",
            hasUI: false,
          });
          await changesCommand("", nonTuiContext);
          eq(
            harness.notifications.at(-1),
            {
              message: "Diff-Check benötigt den interaktiven Modus",
              level: "warning",
            },
            "changes command reports its interactive-mode requirement",
          );
          await harness.runHooks(
            "tool_call",
            {
              toolCallId: "same-content",
              toolName: "write",
              input: { path: "sample.txt", content: "after\n" },
            },
            context,
          );
          writeFileSync(file, "after\n", "utf8");
          await harness.runHooks(
            "tool_result",
            {
              toolCallId: "same-content",
              toolName: "write",
              input: { path: "sample.txt" },
              isError: false,
            },
            context,
          );
          assert(
            harness.execCalls.every((call) => call.command !== "cat"),
            "diff viewer reads snapshots through Node FS instead of spawning cat",
          );
          eq(
            harness.appended.at(-1)?.data?.stats,
            { path: "sample.txt", linesAdded: 1, linesRemoved: 1, hunks: 1 },
            "diff viewer persists the expected successful write diff",
          );
          const changeEvents = harness.emitted.filter(
            (entry) => entry.name === "diff-viewer.change",
          );
          eq(changeEvents.length, 1, "successful write publishes one change event");
          eq(
            changeEvents[0]?.event?.stats,
            { path: "sample.txt", linesAdded: 1, linesRemoved: 1, hunks: 1 },
            "change event carries the validated structured diff",
          );

          await harness.runHooks(
            "tool_call",
            {
              toolCallId: "unchanged-content",
              toolName: "write",
              input: { path: "sample.txt", content: "after\n" },
            },
            context,
          );
          await harness.runHooks(
            "tool_result",
            {
              toolCallId: "unchanged-content",
              toolName: "write",
              input: { path: "sample.txt" },
              isError: false,
            },
            context,
          );
          eq(
            harness.emitted.filter((entry) => entry.name === "diff-viewer.change").length,
            1,
            "unchanged write publishes no additional change event",
          );

          await harness.runHooks(
            "tool_call",
            {
              toolCallId: "failed-content",
              toolName: "write",
              input: { path: "sample.txt", content: "failed\n" },
            },
            context,
          );
          await harness.runHooks(
            "tool_result",
            {
              toolCallId: "failed-content",
              toolName: "write",
              input: { path: "sample.txt" },
              isError: true,
            },
            context,
          );
          eq(
            harness.emitted.filter((entry) => entry.name === "diff-viewer.change").length,
            1,
            "failed write publishes no change event",
          );

          await harness.runHooks(
            "tool_call",
            {
              toolCallId: "changed-content",
              toolName: "write",
              input: { path: "sample.txt", content: "predicted\n" },
            },
            context,
          );
          writeFileSync(file, "actual\nextra\n", "utf8");
          await harness.runHooks(
            "tool_result",
            {
              toolCallId: "changed-content",
              toolName: "write",
              input: { path: "sample.txt" },
              isError: false,
            },
            context,
          );
          eq(
            harness.appended.at(-1)?.data?.stats,
            { path: "sample.txt", linesAdded: 2, linesRemoved: 1, hunks: 1 },
            "diff viewer records the actual content when it differs from the preview",
          );
          if (auroraState) {
            const changesPatch = [...harness.emitted]
              .reverse()
              .find(
                (e) =>
                  e.name === auroraState.AURORA_UI_CHANNELS.patch &&
                  e.event.source === "diff-viewer",
              );
            assert(
              changesPatch,
              "diff-viewer publishes a changes patch on the Aurora bus after a recorded edit",
            );
            eq(
              changesPatch.event.patch.changes,
              {
                filesCount: 1,
                files: ["sample.txt"],
                linesAdded: 2,
                linesRemoved: 1,
              },
              "the published patch carries the real, aggregated diff stats",
            );
          }
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }

      const tracker = new diffTracker.ChangeTracker();
      tracker.recordChange(
        "b.txt",
        "write",
        { path: "b.txt", linesAdded: 1, linesRemoved: 0, hunks: 1 },
        [],
        10,
      );
      tracker.recordChange(
        "a.txt",
        "edit",
        { path: "a.txt", linesAdded: 1, linesRemoved: 0, hunks: 1 },
        [],
        20,
      );
      eq(
        tracker.changedFiles.map((change) => change.path),
        ["a.txt", "b.txt"],
        "tracker sorts by persisted timestamp",
      );
    });
  },
  "diff learning": async (context) => {
    const {
      section,
      diffLearning,
      diffViewer,
    } = context;

    await section("diff learning", async () => {
      const classifier = await context.load(
        "extensions/diff-learning/classifier.ts",
      );
      const questionBank = await context.load(
        "extensions/diff-learning/question-bank.ts",
      );
      const scoring = await context.load("extensions/diff-learning/scoring.ts");
      const selector = await context.load("extensions/diff-learning/selector.ts");
      const progressStore = await context.load(
        "extensions/diff-learning/progress-store.ts",
      );
      const quiz = await context.load("extensions/diff-learning/quiz.ts");

      assert(
        typeof classifier?.classifyHunk === "function" &&
          typeof classifier?.classifyChange === "function",
        "diff-learning classifier loads",
      );
      assert(
        typeof questionBank?.buildQuestion === "function",
        "diff-learning question bank loads",
      );
      assert(
        typeof scoring?.scoreDelta === "function",
        "diff-learning scoring loads",
      );
      assert(
        typeof selector?.selectCandidate === "function",
        "diff-learning selector loads",
      );
      assert(
        typeof progressStore?.ProgressStore === "function",
        "diff-learning progress store loads",
      );
      assert(
        typeof quiz?.runLearningQuiz === "function",
        "diff-learning quiz loads",
      );

      const hunk = (removed, added) => ({
        oldStart: 1,
        oldCount: removed.length,
        newStart: 1,
        newCount: added.length,
        lines: [
          ...removed.map((text) => ({ kind: "removed", text })),
          ...added.map((text) => ({ kind: "added", text })),
        ],
      });
      const classify = (removed, added, path = "src/feature.ts") =>
        classifier.classifyHunk(path, hunk(removed, added));

      const changedGuard = classify(
        ["if (admin) return false;"],
        ["if (admin && active) return false;"],
      );
      assert(
        changedGuard?.concepts.includes("condition-and") &&
          !changedGuard.concepts.includes("guard-removal"),
        "classifier distinguishes a changed guard from guard removal",
      );
      assert(
        classify(
          ["if (admin) return false;", "continueWork();"],
          ["continueWork();"],
        )?.concepts.includes("guard-removal"),
        "classifier recognizes a removed guard",
      );
      assert(
        classify(["import oldValue from './old.js';"], ["import newValue from './new.js';"]) ===
          undefined,
        "classifier ignores import-only changes",
      );
      assert(
        classify(["// old explanation"], ["// new explanation"]) === undefined,
        "classifier ignores comment-only changes",
      );
      assert(
        classify(["  return value;"], ["return value;"]) === undefined,
        "classifier ignores whitespace-only changes",
      );
      assert(
        classify(["const oldName = value;"], ["const newName = value;"]) === undefined,
        "classifier ignores pure identifier renames",
      );
      assert(
        classify(["expect(result).toBe('blocked');"], ["expect(result).toBe('allowed');"], "tests/access.test.ts")
          ?.concepts.includes("test-expectation"),
        "classifier recognizes test expectation changes",
      );
      assert(
        classify(["if (!active) return;"], ["return;"])?.concepts.includes("negation"),
        "classifier recognizes negation",
      );
      assert(
        classify(["return false;"], ["throw new Error('blocked');"])?.concepts.includes("throw"),
        "classifier recognizes throw versus return",
      );
      assert(
        classify(["return value;"], ["return value ?? fallback;"])?.concepts.includes("fallback"),
        "classifier recognizes nullish fallback",
      );

      const supportedConcepts = [
        "diff-basics",
        "condition-if",
        "condition-and",
        "condition-or",
        "negation",
        "return",
        "throw",
        "try-catch",
        "fallback",
        "permission-change",
        "guard-removal",
        "test-expectation",
        "validation",
      ];
      for (const concept of supportedConcepts) {
        const candidate = {
          id: `candidate-${concept}`,
          path: "src/feature.ts",
          toolName: "edit",
          timestamp: 1,
          hunk: hunk(["if (old) return false;"], ["if (new) return true;"]),
          concepts: [concept],
          learningValue: 5,
        };
        const question = questionBank.buildQuestion(candidate);
        assert(question, `question exists for ${concept}`);
        eq(
          question.options.filter((option) => option.correct).length,
          1,
          `${concept} has one correct option`,
        );
        assert(
          question.options.length >= 3,
          `${concept} has at least three options`,
        );
      }

      const expectedDeltas = [0, 1, 2, 3, -1, -2, -3, -4];
      const combinations = [
        [true, 0],
        [true, 1],
        [true, 2],
        [true, 3],
        [false, 0],
        [false, 1],
        [false, 2],
        [false, 3],
      ];
      eq(
        combinations.map(([correct, confidence]) =>
          scoring.scoreDelta(correct, confidence),
        ),
        expectedDeltas,
        "scoring covers correct/wrong x confidence 0..3",
      );

      const profile = progressStore.emptyProgress();
      const weakCandidate = {
        id: "weak",
        path: "src/weak.ts",
        toolName: "edit",
        timestamp: 2,
        hunk: hunk(["return false;"], ["return true;"]),
        concepts: ["return"],
        learningValue: 4,
      };
      const strongCandidate = {
        ...weakCandidate,
        id: "strong",
        path: "src/strong.ts",
        concepts: ["condition-and"],
        learningValue: 10,
      };
      let weakened = progressStore.applyAttempt(profile, {
        concept: "return",
        questionId: "return-v1",
        timestamp: 3,
        outcome: "answered",
        correct: false,
        confidence: 3,
      });
      eq(
        selector.selectCandidate([strongCandidate, weakCandidate], weakened)?.id,
        "weak",
        "selector prioritizes a strong misconception",
      );
      assert(
        selector.selectCandidate([weakCandidate], weakened, new Set(["weak"])) ===
          undefined,
        "selector excludes immediately repeated hunks",
      );

      const storeDir = mkdtempSync(path.join(tmpdir(), "pi-diff-learning-store-"));
      try {
        const file = path.join(storeDir, "diff-learning", "progress.json");
        const store = new progressStore.ProgressStore(file);
        const initial = store.initialize();
        assert(initial.created && existsSync(file), "progress store creates a profile");
        const saved = store.record({
          concept: "condition-and",
          questionId: "condition-and-v1",
          timestamp: 4,
          outcome: "answered",
          correct: true,
          confidence: 2,
        });
        eq(saved.profile.concepts["condition-and"]?.score, 2, "progress score persists");
        const reloaded = new progressStore.ProgressStore(file).initialize();
        eq(
          reloaded.profile.concepts["condition-and"]?.attempts,
          1,
          "progress survives reload",
        );
        writeFileSync(file, '{"version":99}', "utf8");
        const corruptedStore = new progressStore.ProgressStore(file);
        const corrupted = corruptedStore.initialize();
        assert(corrupted.warning && !corrupted.created, "unknown schema is warned and not overwritten");
        corruptedStore.record({
          concept: "condition-and",
          questionId: "condition-and-v1",
          timestamp: 5,
          outcome: "answered",
          correct: true,
          confidence: 3,
        });
        eq(readFileSync(file, "utf8"), '{"version":99}', "corrupt profile remains intact after later attempts");
      } finally {
        rmSync(storeDir, { recursive: true, force: true });
      }

      if (diffLearning?.default && diffViewer?.default) {
        const cwd = mkdtempSync(path.join(tmpdir(), "pi-diff-learning-integration-"));
        const agentDir = mkdtempSync(path.join(tmpdir(), "pi-diff-learning-agent-"));
        const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
        process.env.PI_CODING_AGENT_DIR = agentDir;
        try {
          const file = path.join(cwd, "feature.ts");
          writeFileSync(file, "if (admin) return false;\n", "utf8");
          const harness = createHarness({ select: async (labels) => labels[0] });
          diffViewer.default(harness.api);
          diffLearning.default(harness.api);
          const context = harness.makeContext({ cwd });
          await harness.runHooks("session_start", {}, context);
          await harness.commands.get("learn-diff")("on", context);
          await harness.runHooks("agent_start", {}, context);
          await harness.runHooks(
            "tool_call",
            {
              toolCallId: "learning-write",
              toolName: "write",
              input: {
                path: "feature.ts",
                content: "if (admin && active) return false;\n",
              },
            },
            context,
          );
          writeFileSync(file, "if (admin && active) return false;\n", "utf8");
          await harness.runHooks(
            "tool_result",
            {
              toolCallId: "learning-write",
              toolName: "write",
              input: { path: "feature.ts" },
              isError: false,
            },
            context,
          );
          await harness.runHooks("agent_settled", {}, context);
          assert(
            harness.notifications.some((entry) => entry.message.includes("Richtig")),
            "integration completes answer and explanation after agent settle",
          );
          const profilePath = path.join(agentDir, "diff-learning", "progress.json");
          const stored = JSON.parse(readFileSync(profilePath, "utf8"));
          eq(stored.attempts.length, 1, "integration persists one learning attempt");
          await harness.runHooks("session_shutdown", {}, context);
        } finally {
          if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
          else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
          rmSync(cwd, { recursive: true, force: true });
          rmSync(agentDir, { recursive: true, force: true });
        }
      }
    });
  },
};
