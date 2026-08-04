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

export const diffSections = {
  "diff viewer regressions": async (context) => {
    const { section, diffAlgorithm, diffFallback, diffTracker, diffViewer } =
      context;

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
};
