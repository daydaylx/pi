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

export const uiSections = {
  "Control Center menus": async (context) => {
    const { section, thinkingMenu, modePermissions, planMode, controlPlane } =
      context;

    await section("Control Center menus", async () => {
      if (!thinkingMenu || !modePermissions || !planMode || !controlPlane)
        return;

      // Shift+Tab is the sole workflow control. Super+Q remains the independent
      // Command Center and must not offer an alternative workflow route.
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
            !controlCenter.some((entry) =>
              ["/plan", "/work", "/go", "/workflow"].some((command) =>
                entry.includes(command),
              ),
            ) &&
            controlCenter.includes("Berechtigungsmodus · /permission") &&
            controlCenter.includes("LSP-Steuerung · /lsp"),
          "Super+Q has no alternative workflow command and keeps independent commands",
        );
      }

      // This uses Pi's real selector component and the harness' non-blocking
      // shortcut dispatcher. Unlike the mapping checks above, the selector
      // promise stays open while terminal input is routed to its focus owner.
      {
        const selectorModule = await import(
          pathToFileURL(
            path.join(
              ROOT,
              "npm/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/extension-selector.js",
            ),
          ).href
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
        const { ExtensionSelectorComponent } = selectorModule;
        let selectorCalls = 0;
        let liveHarness;
        const select = (labels, title) =>
          new Promise((resolve) => {
            selectorCalls += 1;
            const close = (value) => {
              liveHarness.setFocusedComponent(undefined);
              resolve(value);
            };
            const selector = new ExtensionSelectorComponent(
              title,
              labels,
              close,
              () => close(undefined),
            );
            liveHarness.setFocusedComponent(selector);
          });
        liveHarness = createHarness({
          editorText: "unverlorener Entwurf",
          select,
        });
        planMode.default(liveHarness.api);
        controlPlane.default(liveHarness.api);
        const liveContext = liveHarness.makeContext();
        await liveHarness.runHooks("session_start", {}, liveContext);
        let globalNavigationConsumes = 0;
        liveContext.ui.onTerminalInput((data) => {
          if (data === "\u001b[57420u" || data === "\u001b") {
            globalNavigationConsumes += 1;
            return { consume: true };
          }
          return undefined;
        });

        const dispatch = liveHarness.dispatchShortcut(
          "shift+tab",
          liveContext,
        );
        let completed = false;
        void dispatch.completion.then(() => {
          completed = true;
        });
        await Promise.resolve();
        eq(dispatch.handled, true, "Shift+Tab is recognized by Pi's dispatcher");
        eq(selectorCalls, 1, "Shift+Tab opens exactly one native selector");
        eq(completed, false, "the native selector remains open for input");
        assert(
          Boolean(liveHarness.focusedComponent),
          "the open native selector owns keyboard focus",
        );
        liveHarness.sendTerminalInput("\u001b[57420u");
        liveHarness.sendTerminalInput("\u001b[13u");
        await dispatch.completion;
        eq(
          latestStatus(liveHarness, "workflow"),
          "Schnellplan",
          "CSI-u navigation and selection apply the chosen workflow",
        );
        eq(
          liveHarness.editorText,
          "unverlorener Entwurf",
          "shortcut completion restores the editor draft",
        );
        eq(
          liveHarness.focusedComponent,
          undefined,
          "closing the selector returns focus from the modal test surface",
        );

        const cancelled = liveHarness.dispatchShortcut(
          "shift+tab",
          liveContext,
        );
        liveHarness.sendTerminalInput("\u001b");
        await cancelled.completion;
        eq(
          latestStatus(liveHarness, "workflow"),
          "Schnellplan",
          "Escape closes the native selector without changing workflow",
        );
        eq(
          globalNavigationConsumes,
          0,
          "global extension input listeners cannot consume modal navigation",
        );
        liveHarness.sendTerminalInput("\u001b[57420u");
        eq(
          globalNavigationConsumes,
          1,
          "global extension input listeners remain active at editor focus",
        );
      }

      {
        let selectorCalls = 0;
        let releaseSelector;
        const selectorResult = new Promise((resolve) => {
          releaseSelector = resolve;
        });
        const guarded = createHarness({
          select: () => {
            selectorCalls += 1;
            return selectorResult;
          },
        });
        planMode.default(guarded.api);
        controlPlane.default(guarded.api);
        const guardedContext = guarded.makeContext();
        await guarded.runHooks("session_start", {}, guardedContext);
        const first = guarded.dispatchShortcut("shift+tab", guardedContext);
        const second = guarded.dispatchShortcut("shift+tab", guardedContext);
        eq(
          selectorCalls,
          1,
          "same-turn repeated shortcuts cannot queue a duplicate modal command",
        );
        eq(
          guarded.submittedCommands,
          [],
          "Shift+Tab opens the workflow selector directly without a slash command",
        );
        releaseSelector(undefined);
        await Promise.all([first.completion, second.completion]);
      }

      {
        const failing = createHarness({
          editorText: "wichtiger Entwurf",
          select: async () => {
            throw new Error("simulierter Dispatcherfehler");
          },
        });
        planMode.default(failing.api);
        const failingContext = failing.makeContext();
        const dispatch = failing.dispatchShortcut("shift+tab", failingContext);
        await dispatch.completion;
        eq(
          failing.editorText,
          "wichtiger Entwurf",
          "a failed preserve-draft shortcut restores the editor text",
        );
        assert(
          failing.notifications.some(
            (entry) =>
              entry.level === "error" &&
              entry.message.includes("simulierter Dispatcherfehler"),
          ),
          "shortcut dispatch failures remain visible",
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
      assert(
        thinkingEntries.some((entry) => entry.value === "max"),
        "Thinking menu exposes max as its own level",
      );
      eq(
        thinkingEntries.map((entry) => entry.value),
        [...thinkingMenu.THINKING_LEVELS],
        "Thinking menu lists the complete scale in order",
      );
      eq(
        thinkingEntries.find((entry) => entry.current)?.value,
        "high",
        "Thinking menu marks the active level",
      );
      // Qwen3.8-Max declares xhigh but not max; the menu shows the gap as a
      // disabled entry instead of renumbering the scale.
      const qwenMaxMap = {
        minimal: null,
        low: "low",
        medium: "medium",
        high: null,
        xhigh: "xhigh",
        max: null,
      };
      const clampedMenu = thinkingMenu.buildThinkingMenu(
        "xhigh",
        (level) => qwenMaxMap[level] !== null,
      );
      eq(
        clampedMenu.find((entry) => entry.value === "max")?.disabled,
        true,
        "an unsupported max stays visible but disabled",
      );
      eq(
        clampedMenu.find((entry) => entry.value === "xhigh")?.disabled,
        false,
        "xhigh stays selectable where max is unavailable",
      );
      const noExtendedMapMenu = thinkingMenu.buildThinkingMenu(
        "medium",
        (level) =>
          ["off", "minimal", "low", "medium", "high"].includes(level),
      );
      for (const level of ["xhigh", "max"]) {
        eq(
          noExtendedMapMenu.find((entry) => entry.value === level)?.disabled,
          true,
          `${level} stays disabled without an explicit model mapping`,
        );
      }

      const cwd = mkdtempSync(path.join(tmpdir(), "pi-control-center-"));
      try {
        let choice = "Sehr hoch";
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
            reasoning: true,
            thinkingLevelMap: { xhigh: "xhigh" },
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

        choice = "Sehr hoch";
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
        choice = "Mittel";
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
          "low",
          "a persisted auto Thinking record falls back to the runtime default level",
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

      const commandCenterHarness = createHarness({ columns: 120, rows: 40 });
      const commandCenterResult = menuUi.runMenu(
        commandCenterHarness.makeContext(),
        "Command Center",
        [
          {
            id: "work",
            label: "Arbeit",
            description: "Befehle für die aktuelle Aufgabe",
            children: [
              { id: "go", label: "Ausführen", value: "go" },
            ],
          },
        ],
        { headerShortcut: "Super+Q", appearance: "command-center" },
      );
      await new Promise((resolve) => setImmediate(resolve));
      const commandCenterComponent = commandCenterHarness.customComponents.at(-1);
      assert(
        Boolean(commandCenterComponent),
        "Command Center opens a custom overlay",
      );
      if (commandCenterComponent) {
        const renderedCommandCenter = commandCenterComponent
          .render(120)
          .map(stripAnsi)
          .join("\n");
        assert(
          stripAnsi(commandCenterComponent.render(120)[0]).startsWith("╔") &&
            renderedCommandCenter.includes("⌘ COMMAND CENTER") &&
            renderedCommandCenter.includes("BEREICHE"),
          "Command Center has its own double frame, command mark and area band",
        );
        for (const width of [30, 50, 80, 120]) {
          assert(
            commandCenterComponent
              .render(width)
              .every((line) => stripAnsi(line).length <= width),
            `Command Center remains bounded at ${width} columns`,
          );
        }
        commandCenterComponent.handleInput("\r");
        const submenu = commandCenterComponent.render(120).map(stripAnsi).join("\n");
        assert(
          submenu.includes("Command Center › Arbeit") &&
            submenu.includes("BEFEHLSZENTRALE › Arbeit"),
          "Command Center keeps its identity and breadcrumb in submenus",
        );
        commandCenterComponent.handleInput("\r");
      }
      eq(
        await commandCenterResult,
        "go",
        "Command Center appearance keeps Enter selection unchanged",
      );

      const polishHarness = createHarness({
        columns: 120,
        rows: 40,
        editorText: "unverlorener Entwurf",
      });
      const polishResult = menuUi.runMenu(
        polishHarness.makeContext(),
        "Thinking",
        [
          {
            id: "active",
            label: "Hoch",
            description: "Gründliches Nachdenken für anspruchsvolle Aufgaben",
            current: true,
            value: "high",
          },
          {
            id: "risk",
            label: "Sehr hoch",
            description: "Maximale Tiefe für komplexe Aufgaben",
            dangerous: true,
            tone: "danger",
            value: "xhigh",
          },
          {
            id: "disabled",
            label: "Nicht verfügbar",
            disabled: true,
            disabledReason: "Dieses Modell unterstützt die Stufe nicht.",
            value: "off",
          },
        ],
        { headerShortcut: "Super+D" },
      );
      await new Promise((resolve) => setImmediate(resolve));
      const polishComponent = polishHarness.customComponents.at(-1);
      assert(Boolean(polishComponent), "polished menu opens a custom overlay");
      if (polishComponent) {
        const polished = polishComponent.render(120).map(stripAnsi).join("\n");
        assert(
          polished.includes("THINKING") &&
            polished.includes("Super+D") &&
            polished.includes("● AKTIV") &&
            polished.includes("⚠ RISIKO") &&
            polished.includes("× NICHT VERFÜGBAR") &&
            polished.includes("▌"),
          "menu header, semantic badges and Aurora selection marker stay visible",
        );
        for (const width of [30, 52, 90, 120]) {
          assert(
            polishComponent
              .render(width)
              .every((line) => stripAnsi(line).length <= width),
            `polished menu remains compact and bounded at ${width} columns`,
          );
        }
        polishComponent.handleInput("\u001b");
      }
      eq(await polishResult, undefined, "Escape cancels the polished menu");
      eq(
        polishHarness.editorText,
        "unverlorener Entwurf",
        "Escape leaves the editor draft unchanged",
      );

      const menuEntries = [
        { id: "first", label: "Erster", value: "first" },
        {
          id: "disabled",
          label: "Blockiert",
          value: "disabled",
          disabled: true,
          disabledReason: "Nicht verfügbar",
        },
        { id: "last", label: "Letzter", value: "last" },
      ];
      async function openMenu() {
        const menuHarness = createHarness();
        const result = menuUi.runMenu(
          menuHarness.makeContext(),
          "Tastaturtest",
          menuEntries,
        );
        await new Promise((resolve) => setImmediate(resolve));
        return { harness: menuHarness, result };
      }
      async function isSettled(promise) {
        let settled = false;
        void promise.then(() => {
          settled = true;
        });
        await new Promise((resolve) => setImmediate(resolve));
        return settled;
      }

      {
        const opened = await openMenu();
        opened.harness.sendTerminalInput("\u001b[B");
        opened.harness.sendTerminalInput("\u001b[A");
        opened.harness.sendTerminalInput("\u001b[57420u");
        opened.harness.sendTerminalInput("\r");
        eq(
          await opened.result,
          "last",
          "legacy and CSI-u arrows navigate while skipping disabled entries",
        );
      }

      {
        const opened = await openMenu();
        opened.harness.sendTerminalInput("j");
        opened.harness.sendTerminalInput("k");
        opened.harness.sendTerminalInput("j");
        opened.harness.sendTerminalInput("\n");
        eq(
          await opened.result,
          "last",
          "j/k navigation and newline Enter select the focused enabled entry",
        );
      }

      {
        const opened = await openMenu();
        opened.harness.sendTerminalInput("\r");
        eq(await opened.result, "first", "carriage-return Enter confirms the selection");
        const opened2 = await openMenu();
        opened2.harness.sendTerminalInput("\n");
        eq(await opened2.result, "first", "newline Enter confirms the selection");
      }

      for (const [key, label] of [
        ["\u001b", "Escape"],
        ["\u0003", "Ctrl+C"],
      ]) {
        const opened = await openMenu();
        opened.harness.sendTerminalInput(key);
        const closed = await isSettled(opened.result);
        eq(closed, true, `${label} closes the custom menu`);
        if (!closed) opened.harness.sendTerminalInput("\r");
        eq(await opened.result, undefined, `${label} cancels without a value`);
        eq(
          opened.harness.focusedComponent,
          undefined,
          `${label} releases custom-menu focus`,
        );
      }

      {
        const opened = await openMenu();
        opened.harness.sendTerminalInput("x");
        eq(
          await isSettled(opened.result),
          false,
          "an unknown single character leaves the menu open",
        );
        // Typing now starts the fuzzy filter: it narrows the visible list
        // instead of doing nothing, so "x" matches no entry at all.
        const filterComponent = opened.harness.customComponents.at(-1);
        const filtered = filterComponent
          ? filterComponent.render(80).map(stripAnsi).join("\n")
          : "";
        assert(
          filtered.includes("⌕ x"),
          "typed characters become a visible filter input",
        );
        assert(
          !filtered.includes("Erster") && !filtered.includes("Letzter"),
          "the filter hides non-matching entries",
        );
        opened.harness.sendTerminalInput("\u007f");
        opened.harness.sendTerminalInput("\r");
        eq(
          await opened.result,
          "first",
          "backspace clears the filter and Enter confirms the restored selection",
        );
      }

      {
        const opened = await openMenu();
        // "tz" uniquely fuzzy-matches "Letzter" ("Blockiert" has no "z",
        // "Erster" no leading t/z subsequence after its letters).
        opened.harness.sendTerminalInput("t");
        opened.harness.sendTerminalInput("z");
        opened.harness.sendTerminalInput("\r");
        eq(
          await opened.result,
          "last",
          "a fuzzy filter narrows to the matching entry and Enter selects it",
        );
      }

      {
        const opened = await openMenu();
        opened.harness.sendTerminalInput("x");
        opened.harness.sendTerminalInput("\u001b");
        const filterComponent = opened.harness.customComponents.at(-1);
        const cleared = filterComponent
          ? filterComponent.render(80).map(stripAnsi).join("\n")
          : "";
        assert(
          cleared.includes("Erster") && !cleared.includes("⌕"),
          "Escape clears an active filter first and keeps the menu open",
        );
        opened.harness.sendTerminalInput("\u001b");
        eq(
          await opened.result,
          undefined,
          "Escape from an empty filter closes the menu",
        );
      }

      // The tab overlay was chrome around a single page. Its one caller, the
      // thinking picker, now uses the same menu shell as every other picker,
      // which the assertions above already cover.
    });
  },

  "Aurora tiles and status pills": async (context) => {
    const { section, load } = context;

    await section("Aurora tiles and status pills", async () => {
      const themeModule = await import(
        pathToFileURL(
          path.join(
            ROOT,
            "npm/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js",
          ),
        ).href
      );
      themeModule.initTheme("dark");
      const theme = themeModule.getThemeByName("dark");
      const { visibleWidth } = await import(
        pathToFileURL(
          path.join(
            ROOT,
            "npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js",
          ),
        ).href
      );
      const tile = await load("extensions/aurora-ui/tile.ts");
      const renderers = await load("extensions/aurora-ui/tool-renderers.ts");
      const startscreen = await load("extensions/aurora-ui/startscreen.ts");
      const auroraFooter = await load("extensions/aurora-ui/footer.ts");
      if (!theme || !tile || !renderers || !startscreen || !auroraFooter)
        return;

      const pendingBg = theme.getBgAnsi("toolPendingBg");
      const successBg = theme.getBgAnsi("toolSuccessBg");
      const errorBg = theme.getBgAnsi("toolErrorBg");
      const selectedBg = theme.getBgAnsi("selectedBg");

      // 1. A filled tile is one solid surface: every row has exactly the tile
      // width in cells, and title plus body rows carry the fill background.
      const card = tile.renderTile(theme, 60, {
        title: "AUFGABE",
        badge: "ARBEITEN",
        tone: "accent",
        fill: tile.NEUTRAL_TILE_FILL,
        lines: [theme.bold("Titel der Aufgabe"), theme.fg("muted", "Ziel")],
      });
      eq(card.length, 4, "a tile is frame plus one row per content line");
      assert(
        card.every((row) => visibleWidth(row) === 60),
        "every tile row spans exactly the tile width",
      );
      assert(
        card[0].includes(pendingBg) && card[1].includes(pendingBg),
        "the title row and body rows are painted with the fill background",
      );

      // 1b. A styled content line that gets truncated must not leave its
      // colour open past the ellipsis: the tile-fill close only resets the
      // background, never bold or foreground. Regression for a bug where a
      // long, coloured title/goal line leaked its styling into the tile's
      // border (and, in a two-column grid, into the neighbouring tile).
      const longLine = theme.fg(
        "muted",
        "Ein wirklich sehr langer Text, der auf einer schmalen Kachel garantiert abgeschnitten wird",
      );
      const truncatedCard = tile.renderTile(theme, 30, {
        title: "ZIEL",
        tone: "accent",
        fill: tile.NEUTRAL_TILE_FILL,
        lines: [longLine],
      });
      const contentRow = truncatedCard[1];
      assert(
        stripAnsi(contentRow).includes("…"),
        "the long line actually truncates at this width",
      );
      const fgOpens = contentRow.match(/\x1b\[38;2;[0-9;]*m/g) ?? [];
      const fgCloses = contentRow.match(/\x1b\[39m/g) ?? [];
      eq(
        fgOpens.length,
        fgCloses.length,
        "a truncated styled line closes its foreground colour instead of leaking past the ellipsis",
      );
      eq(
        tile.statusFill("success"),
        "toolSuccessBg",
        "a successful status paints the success surface",
      );
      eq(
        tile.statusFill("error"),
        "toolErrorBg",
        "a failed status paints the error surface",
      );
      eq(
        tile.statusFill("accent"),
        tile.NEUTRAL_TILE_FILL,
        "routine tones stay on the neutral card surface",
      );

      // 2. Pills: loud tones get a filled chip, routine tones stay flat.
      const accentPill = tile.renderPill(theme, "ARBEITEN", "accent");
      assert(
        accentPill.includes(selectedBg) &&
          stripAnsi(accentPill) === " ARBEITEN ",
        "an accent pill is a padded chip on the selection surface",
      );
      const errorPill = tile.renderPill(theme, "⚠ YOLO", "error");
      assert(
        errorPill.includes(errorBg),
        "an error pill is a padded chip on the error surface",
      );
      eq(
        tile.renderPill(theme, "unwichtig", "muted"),
        theme.fg("muted", "unwichtig"),
        "a muted pill stays flat text",
      );
      eq(
        tile.pillExtraCells("warning"),
        2,
        "a warning chip pays two padding cells",
      );
      eq(tile.pillExtraCells("muted"), 0, "a flat segment pays no padding");

      // 3. The wide dashboard is a 2×2 card grid: paired tiles share one row.
      const tvm = {
        sessionEpoch: "tile-test",
        phase: "work",
        phaseLabel: "Arbeiten",
        title: "Kacheln prüfen",
        goal: "GUI-Optik",
      };
      const wideDashboard = renderers.renderDashboard(
        tvm,
        theme,
        120,
        { activityLines: ["ARBEITET · 3s"], maxRows: 14 },
      );
      const wideText = wideDashboard.map(stripAnsi);
      assert(
        wideText.some((line) => line.includes("╭")) &&
          wideText.some((line) => line.includes("╰")),
        "the wide dashboard keeps card frames",
      );
      assert(
        wideText.some(
          (line) => line.includes("AUFGABE") && line.includes("AKTIVITÄT"),
        ),
        "the wide dashboard pairs task and activity tiles on one row",
      );
      assert(
        wideDashboard.some((line) => line.includes(pendingBg)),
        "wide dashboard tiles carry the card fill",
      );

      // 4. Below the grid threshold the same tiles stack, and the compact
      // dashboard stays frame-free.
      const stackedDashboard = renderers.renderDashboard(
        tvm,
        theme,
        80,
        { activityLines: ["ARBEITET · 3s"], maxRows: 14 },
      );
      const stackedText = stackedDashboard.map(stripAnsi);
      assert(
        !stackedText.some(
          (line) => line.includes("AUFGABE") && line.includes("AKTIVITÄT"),
        ),
        "below the wide threshold tiles stack instead of pairing",
      );
      const compactDashboard = renderers.renderDashboard(
        tvm,
        theme,
        45,
        { activityLines: ["ARBEITET"], maxRows: 2, compact: true },
      );
      assert(
        compactDashboard.every((line) => !stripAnsi(line).includes("╭")),
        "the compact dashboard keeps its frame-free rows",
      );

      // 5. A failed check owns the error surface and never disappears.
      const failedDashboard = renderers.renderDashboard(
        {
          ...tvm,
          verification: {
            verdict: "NOT_READY",
            criteria: [{ label: "Tests", status: "failed" }],
            blockers: ["Pflichtprüfung fehlgeschlagen."],
          },
        },
        theme,
        120,
        { activityLines: ["ARBEITET"], maxRows: 5 },
      );
      assert(
        failedDashboard.some(
          (line) => stripAnsi(line).includes("NICHT BEREIT"),
        ) && failedDashboard.some((line) => line.includes(errorBg)),
        "a failed check stays visible and paints the error surface",
      );

      // 6. The welcome window is a centered card with fields and chips.
      for (const [columns, rows] of [
        [52, 14],
        [90, 28],
        [120, 30],
      ]) {
        const welcome = startscreen.renderStartscreen(theme, {
          width: columns,
          rows,
          workflow: "Work",
          model: "aurora-test-model",
          thinking: "high",
          cwd: path.join(homedir(), "projects", "pi"),
          homeDirectory: homedir(),
        });
        assert(
          welcome.every((row) => visibleWidth(row) <= columns),
          `the welcome card fits ${columns}×${rows} cells`,
        );
        assert(
          welcome.some((row) => row.includes(pendingBg)) &&
            stripAnsi(welcome.join("\n")).includes("WORKFLOW"),
          `the welcome card is filled and carries labelled fields at ${columns}×${rows}`,
        );
      }

      // 7. Overlong titles and goals never break the frame: every row stays
      // within the dashboard width, cropped instead of overflowing.
      const longTitle = renderers.renderDashboard(
        {
          ...tvm,
          title: "Eine wirklich sehr lange Aufgabenstellung, die jeden Rahmen sprengen würde".repeat(
            4,
          ),
          goal: "Ein ebenso langes Ziel, das vollständig in der Kachel bleiben muss".repeat(
            4,
          ),
        },
        theme,
        120,
        { activityLines: [], maxRows: 14 },
      );
      assert(
        longTitle.every((row) => visibleWidth(row) <= 120) &&
          stripAnsi(longTitle.join("\n")).includes("╭"),
        "overlong titles and goals are cropped inside intact frames",
      );

      // 8. The footer upgrades workflow and risks to chips on wide tiers only.
      const footerState = {
        sessionEpoch: "tile-test",
        workflow: { phase: "work", label: "Work" },
        permissions: { level: "yolo" },
        lsp: {},
        model: { id: "aurora-test-model", thinking: "high" },
        activity: { kind: "idle" },
      };
      const wideFooter = auroraFooter.renderFooterLines(theme, 140, {
        state: footerState,
        statuses: new Map(),
        contextPercent: null,
      })[0];
      assert(
        wideFooter.includes(selectedBg) && wideFooter.includes(errorBg),
        "the wide footer paints the workflow chip and the YOLO risk chip",
      );
      const standardFooter = auroraFooter.renderFooterLines(theme, 70, {
        state: footerState,
        statuses: new Map(),
        contextPercent: null,
      })[0];
      assert(
        !standardFooter.includes(selectedBg) &&
          !standardFooter.includes(errorBg) &&
          stripAnsi(standardFooter).includes("⚠ YOLO"),
        "the standard footer stays flat but keeps the YOLO risk visible",
      );
    });
  },
};
