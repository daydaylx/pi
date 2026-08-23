// Regression coverage for the /inspect command (extensions/aurora-ui/inspector-command.ts):
// the single, on-demand inspector shell unifying Changes/Kontext/Verification
// Evidence/Modelle/Reasoning/Diagnostics behind one consistent pattern instead
// of a separate UI per secondary surface.
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness, stripAnsi } from "../../shared/harness.mjs";

export const auroraInspectorSections = {
  "Aurora Inspector command": async (context) => {
    const { section, load, auroraUi, auroraState } = context;

    await section("Aurora Inspector command", async () => {
      if (!auroraUi || !auroraState) return;

      let selectedLabel;
      const harness = createHarness({
        select: (_labels) => selectedLabel,
      });
      auroraUi.default(harness.api);
      const ctx = harness.makeContext({ cwd: "/workspace/inspector-test" });
      await harness.runHooks("session_start", {}, ctx);

      // Aurora asks providers for a fresh snapshot right on session_start —
      // discover the sessionEpoch from that outgoing request the same way a
      // real provider (diff-viewer, setup-core, lsp) would.
      const outgoingRequest = harness.emitted.find(
        (e) =>
          e.name === auroraState.AURORA_UI_CHANNELS.request &&
          e.event.requester === "aurora-ui",
      );
      assert(
        outgoingRequest,
        "Aurora asks providers for a fresh snapshot on session_start",
      );
      const sessionEpoch = outgoingRequest.event.sessionEpoch;

      // Seed state the same way real providers do: one patch on the shared
      // bus, not a second, parallel state Aurora would have to trust blindly.
      harness.api.events.emit(auroraState.AURORA_UI_CHANNELS.patch, {
        type: "patch",
        sessionEpoch,
        source: "test-provider",
        patch: {
          model: { id: "claude-test", thinking: "high" },
          lsp: { state: "aktiv", detail: "2 Servers" },
          changes: {
            filesCount: 2,
            files: ["src/a.ts", "src/b.ts"],
            linesAdded: 12,
            linesRemoved: 4,
          },
          verification: {
            status: "checks_failed",
            declaredRequiredIds: ["typecheck", "tests"],
            requiredOutcomes: { typecheck: "success", tests: "failed" },
            blockingRecommendedIds: ["security-scan"],
          },
        },
      });

      const inspectCommand = harness.commands.get("inspect");
      assert(
        typeof inspectCommand === "function",
        "aurora-ui registers the /inspect command",
      );

      // The Verification Evidence section reads the last computed task view
      // model, which only exists once the activity widget has actually
      // rendered at least once — trigger that the same way a real tool call
      // would, exactly like the lifecycle tests in aurora-ui.mjs do.
      await harness.runHooks(
        "tool_execution_start",
        { toolCallId: "t1", toolName: "read", args: { path: "README.md" } },
        ctx,
      );
      const widget = harness.widgets.get("aurora-ui/activity")?.content;
      assert(
        typeof widget === "function",
        "the Aurora activity widget is registered",
      );
      widget({ requestRender() {} }, ctx.ui.theme).render(120);

      const cases = [
        {
          label: "Changes",
          expect: (text) =>
            text.includes("CHANGES") &&
            text.includes("src/a.ts") &&
            text.includes("+12") &&
            text.includes("−4"),
          name: "Changes section renders the real aggregated diff stats",
        },
        {
          label: "Kontext",
          expect: (text) =>
            text.includes("KONTEXT") &&
            !text.includes("Conversation") &&
            !text.includes("Tool results") &&
            !text.includes("Memory"),
          name: "Kontext section never fabricates a per-category token breakdown",
        },
        {
          label: "Verification Evidence",
          expect: (text) =>
            text.includes("VERIFICATION EVIDENCE") &&
            text.includes("tests") &&
            text.includes("security-scan"),
          name: "Verification Evidence section shows real checks and the blocking recommended id",
        },
        {
          label: "Modelle",
          expect: (text) =>
            text.includes("MODELLE") && text.includes("claude-test"),
          name: "Modelle section shows the active model id",
        },
        {
          label: "Reasoning",
          expect: (text) => text.includes("REASONING") && text.includes("HOCH"),
          name: "Reasoning section shows the current thinking level",
        },
        {
          label: "Diagnostics",
          expect: (text) =>
            text.includes("DIAGNOSTICS") && text.includes("2 Servers"),
          name: "Diagnostics section shows LSP status",
        },
      ];

      for (const testCase of cases) {
        selectedLabel = testCase.label;
        harness.notifications.length = 0;
        await inspectCommand("", ctx);
        const notified = harness.notifications.at(-1)?.message ?? "";
        assert(testCase.expect(stripAnsi(notified)), testCase.name);
      }

      // Dismissing the menu (no selection) must not throw or notify anything.
      selectedLabel = undefined;
      harness.notifications.length = 0;
      await inspectCommand("", ctx);
      eq(
        harness.notifications.length,
        0,
        "dismissing the inspector menu without a selection is a silent no-op",
      );

      // Docking: /inspect is catalogued under "code" so it surfaces through
      // the existing Super+Q command center — no new shortcut, no palette.
      const catalog = await load("extensions/shared/command-catalog.ts");
      if (catalog) {
        const definition = catalog.COMMAND_DEFINITIONS.find(
          (d) => d.name === "inspect",
        );
        assert(
          definition?.category === "code",
          "the inspect command is catalogued under the code category",
        );
        eq(
          definition?.shortcut,
          undefined,
          "the inspect command introduces no new dedicated shortcut",
        );
      }

      await harness.runHooks("session_shutdown", {}, ctx);
    });
  },
};
