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

export const uiSections = {
  "Control Center menus": async (context) => {
    const { section, thinkingMenu, modePermissions, planMode, controlPlane } =
      context;

    await section("Control Center menus", async () => {
      if (!thinkingMenu || !modePermissions || !planMode || !controlPlane)
        return;

      // Two entry points, different scope, one definition: Shift+Tab is the
      // workflow switch, Super+Q the full Control Center whose first tab IS that
      // workflow switch. Both route through plan-mode's single action router, so
      // a workflow entry can never differ between them.
      {
        const seen = [];
        let customCalls = 0;
        const shared = createHarness({
          select: (labels) => {
            seen.push([...labels]);
            return undefined;
          },
        });
        planMode.default(shared.api);
        controlPlane.default(shared.api);
        const sharedContext = shared.makeContext({
          cwd: mkdtempSync(path.join(tmpdir(), "pi-cc-entries-")),
        });
        sharedContext.ui.custom = async () => {
          customCalls += 1;
          throw new Error("use deterministic select fallback");
        };
        await shared.runHooks("session_start", {}, sharedContext);
        await shared.shortcuts.get("shift+tab")(sharedContext);
        eq(
          customCalls,
          0,
          "Shift+Tab uses Pi's native selector instead of a focus-capturing overlay",
        );
        await shared.shortcuts.get("super+q")(sharedContext);
        // Super+Q routes through an event; the bus dispatches without awaiting the
        // async listener, so let the microtask queue drain before asserting.
        await new Promise((resolve) => setImmediate(resolve));
        eq(seen.length, 2, "both entry points opened their menu");
        const [workflowSwitch, controlCenter] = seen;
        eq(
          workflowSwitch,
          ["Work", "Schnellplan", "Architekturplan"],
          "Shift+Tab exposes only the three workflow modes",
        );
        assert(
          controlCenter.length > workflowSwitch.length &&
            controlCenter.includes("Workflow wechseln · /workflow") &&
            controlCenter.includes("Berechtigungsmodus · /permission") &&
            controlCenter.includes("LSP-Steuerung · /lsp"),
          "Super+Q exposes the canonical workflow, permission and LSP commands",
        );
      }

      const thinkingEntries = thinkingMenu.buildThinkingMenu("high");
      assert(
        thinkingEntries.every((entry) =>
          thinkingMenu.THINKING_LEVELS.includes(entry.value),
        ),
        "Thinking menu offers real thinking levels only",
      );
      assert(
        thinkingEntries.some((entry) => entry.value === "xhigh"),
        "Thinking menu exposes every manual level",
      );
      eq(
        thinkingEntries.find((entry) => entry.current)?.value,
        "high",
        "Thinking menu marks the active level",
      );

      const cwd = mkdtempSync(path.join(tmpdir(), "pi-control-center-"));
      try {
        let choice = "Manuell: Sehr hoch";
        const harness = createHarness({
          select: (labels) => {
            if (choice === "__permissions__")
              return labels.find((label) =>
                label.endsWith("Berechtigungen: Lesen + Schreiben"),
              );
            if (choice === "__diagnostics__")
              return labels.find((label) => label.endsWith("LSP-Diagnose"));
            if (choice === "__models__") {
              return labels.find((label) =>
                label.endsWith("openai-codex/gpt-5.4-mini"),
              );
            }
            return labels.find((label) => label === choice);
          },
          models: {
            "openai-codex/gpt-5.4-mini": {
              provider: "openai-codex",
              id: "gpt-5.4-mini",
            },
          },
        });
        planMode.default(harness.api);
        modePermissions.default(harness.api);
        controlPlane.default(harness.api);
        const context = harness.makeContext({
          cwd,
          model: {
            provider: "openai-codex",
            id: "gpt-5.4",
            thinkingLevelMap: {},
          },
        });
        context.ui.custom = async () => {
          throw new Error("use deterministic select fallback");
        };
        await harness.runHooks("session_start", {}, context);
        assert(
          !harness.shortcuts.has("ctrl+shift+x"),
          "Ctrl+Shift+X registers no local shortcut",
        );
        assert(
          !harness.shortcuts.has("ctrl+shift+y"),
          "legacy permission shortcut is retired",
        );
        assert(harness.shortcuts.has("super+d"), "Super+D opens Thinking");
        assert(harness.shortcuts.has("super+m"), "Super+M opens models");

        choice = "Manuell: Sehr hoch";
        await harness.shortcuts.get("super+d")(context);
        eq(
          harness.api.getThinkingLevel(),
          "xhigh",
          "manual Thinking selection applies its level",
        );
        choice = "Schnellplan";
        await harness.shortcuts.get("shift+tab")(context);
        eq(
          latestStatus(harness, "workflow"),
          "Schnellplan",
          "the native workflow selector maps Schnellplan",
        );
        eq(
          harness.api.getThinkingLevel(),
          "xhigh",
          "manual Thinking survives a workflow transition",
        );
        choice = "Manuell: Mittel";
        await harness.shortcuts.get("super+d")(context);
        eq(
          harness.api.getThinkingLevel(),
          "medium",
          "manual Thinking selection applies medium level",
        );
        choice = "Architekturplan";
        await harness.shortcuts.get("shift+tab")(context);
        eq(
          latestStatus(harness, "workflow"),
          "Architekturplan",
          "the native workflow selector maps Architekturplan",
        );
        eq(
          harness.api.getThinkingLevel(),
          "medium",
          "manual Thinking stays at chosen level across workflow changes",
        );
        choice = "Work";
        await harness.shortcuts.get("shift+tab")(context);
        eq(
          latestStatus(harness, "workflow"),
          "Work",
          "the native workflow selector maps Work",
        );
        choice = undefined;
        await harness.shortcuts.get("shift+tab")(context);
        eq(
          latestStatus(harness, "workflow"),
          "Work",
          "cancelling the native workflow selector keeps the current mode",
        );

        // Sessions written before the auto mode was retired still carry
        // `manualThinkingLevel: "auto"`, which is not a thinking level.
        const legacyHarness = createHarness({
          thinkingLevel: "low",
          entries: [
            {
              type: "custom",
              customType: "mode-permissions",
              data: { thinkingMode: "auto", manualThinkingLevel: "auto" },
            },
          ],
        });
        modePermissions.default(legacyHarness.api);
        const legacyContext = legacyHarness.makeContext({ cwd });
        await legacyHarness.runHooks("session_start", {}, legacyContext);
        eq(
          legacyHarness.api.getThinkingLevel(),
          "medium",
          "a persisted auto Thinking record falls back to the default level",
        );

        choice = "__models__";
        await harness.shortcuts.get("super+m")(context);
        eq(
          harness.submittedCommands.at(-1),
          "/model",
          "Super+M delegates model selection to Pi's canonical /model command",
        );

        const busy = createHarness({
          idle: false,
          models: {
            "openai-codex/gpt-5.4-mini": {
              provider: "openai-codex",
              id: "gpt-5.4-mini",
            },
          },
          select: (labels) =>
            labels.find((label) => label.endsWith("openai-codex/gpt-5.4-mini")),
        });
        planMode.default(busy.api);
        controlPlane.default(busy.api);
        const busyContext = busy.makeContext({ cwd });
        busyContext.ui.custom = async () => {
          throw new Error("use deterministic select fallback");
        };
        await busy.shortcuts.get("super+m")(busyContext);
        eq(
          busy.submittedCommands,
          ["/model"],
          "the shortcut keeps using Pi's canonical model command while busy",
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  },

  "shared menu shell navigation and rendering": async (context) => {
    const { section, menuUi } = context;

    await section("shared menu shell navigation and rendering", async () => {
      if (!menuUi) return;
      eq(
        menuUi.initialMenuIndex([
          { id: "disabled", label: "Blockiert", disabled: true },
          { id: "active", label: "Aktiv", current: true },
        ]),
        1,
        "initial menu selection skips disabled entries",
      );
      eq(
        menuUi.moveMenuIndex(1, 1, [
          { id: "disabled", label: "Blockiert", disabled: true },
          { id: "active", label: "Aktiv" },
          { id: "last", label: "Letzter" },
        ]),
        2,
        "menu movement skips disabled entries",
      );
      const viewport = menuUi.calculateMenuViewport([1, 3, 1, 1], 1, 0, 3);
      eq(
        viewport.start <= 1 && viewport.end > 1,
        true,
        "viewport keeps selected multi-line entry visible",
      );
      eq(
        menuUi.menuOverlayWidth(80, "ANSI \u001b[31mTitel\u001b[0m", []),
        menuUi.menuOverlayWidth(80, "界界界", []),
        "overlay width does not use raw ANSI or grapheme string length",
      );

      const harness = createHarness({ columns: 120, rows: 40 });
      const context = harness.makeContext();
      const pending = menuUi.runMenu(context, "Hauptmenü", [
        {
          id: "area",
          label: "Bereich",
          description: "Untermenü mit einer ausführlichen Beschreibung",
          children: [
            {
              id: "go",
              label: "Ausführen",
              description: "Sichere explizite Aktion",
              value: "go",
            },
            {
              id: "disabled",
              label: "Blockiert",
              description: "Darf nicht ausgeführt werden",
              disabled: true,
              disabledReason: "Nicht verfügbar",
            },
          ],
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const component = harness.customComponents.at(-1);
      assert(Boolean(component), "shared menu opens a temporary overlay");
      if (!component) return;
      for (const width of [30, 50, 80, 120]) {
        const lines = component.render(width);
        assert(
          lines.every((line) => stripAnsi(line).length <= width),
          `menu frame remains within ${width} columns`,
        );
        assert(
          stripAnsi(lines[0]).startsWith("╭"),
          `menu has a complete top frame at ${width} columns`,
        );
        assert(
          lines.every((line) => !stripAnsi(line).includes(" · ")),
          `menu footer hint at ${width} columns uses the themed separator, not a raw dot`,
        );
      }
      component.handleInput("\r");
      assert(
        component
          .render(80)
          .some((line) => stripAnsi(line).includes("Hauptmenü › Bereich")),
        "opening a submenu renders a breadcrumb",
      );
      component.handleInput("\r");
      eq(
        await pending,
        "go",
        "Enter selects only the explicit focused leaf action",
      );
      assertNoGlobalChrome(harness, "menu shell installs no permanent chrome");
    });
  },
};
