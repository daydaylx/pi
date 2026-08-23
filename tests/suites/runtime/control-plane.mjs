import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";

export const controlPlaneSections = {
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
};
