/**
 * Shared mock ExtensionAPI for every regression suite.
 *
 * createHarness is deliberately self-contained: it records what an extension
 * registered and emitted so a suite can drive hooks, commands, shortcuts and
 * tools without a running agent. Extracted from run.mjs so the workflow-v3
 * suites use the same harness instead of a drifting second copy.
 */
import { ROOT } from "./jiti-loader.mjs";
import { eq } from "./assertions.mjs";

export function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

export function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex
      .replace("#", "")
      .match(/.{2}/g)
      .map((channel) => parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

export function latestStatus(harness, key) {
  return [...harness.statusCalls].reverse().find((entry) => entry.key === key)
    ?.value;
}

export function assertNoGlobalChrome(harness, message) {
  eq(harness.chrome, { footer: 0, editor: 0, widget: 0, header: 0 }, message);
}

export function createHarness(options = {}) {
  const hooks = new Map();
  const eventHandlers = new Map();
  const commands = new Map();
  const commandDescriptions = new Map();
  const shortcuts = new Map();
  const tools = new Map();
  const duplicateTools = [];
  const statusCalls = [];
  const statuses = new Map();
  const notifications = [];
  const emitted = [];
  const appended = [];
  const sent = [];
  const customComponents = [];
  const entryRenderers = new Map();
  const terminalInputListeners = new Set();
  const chrome = { footer: 0, editor: 0, widget: 0, header: 0 };
  const workingMessages = [];
  const workingVisibility = [];
  const workingIndicators = [];
  const hiddenThinkingLabels = [];
  const execCalls = [];
  const widgets = new Map();
  const lifecycleCalls = [];
  let customCallIndex = 0;
  let footerFactory;
  let editorFactory;
  let thinkingLevel = options.thinkingLevel ?? "high";
  let entries = options.entries ?? [];
  let idle = options.idle ?? true;
  let branchReads = 0;
  const branchListeners = new Set();
  const setModelCalls = [];
  const submittedCommands = [];
  let editorText = options.editorText ?? "";
  let activeContext;

  const theme = {
    name: "test-theme",
    fg: (_color, text) => String(text),
    bold: (text) => String(text),
  };
  const tui = {
    terminal: {
      columns: options.columns ?? 80,
      rows: options.rows ?? 24,
    },
    requestRender() {},
  };
  const ui = {
    theme,
    setStatus(key, value) {
      statusCalls.push({ key, value });
      if (value === undefined) statuses.delete(key);
      else statuses.set(key, value);
    },
    setFooter(factory) {
      footerFactory = factory;
      if (factory) chrome.footer += 1;
    },
    setEditor() {
      chrome.editor += 1;
    },
    setEditorComponent(factory) {
      editorFactory = factory;
      if (factory) chrome.editor += 1;
    },
    getEditorComponent() {
      return editorFactory;
    },
    setWidget(key, content, widgetOptions) {
      if (content) {
        widgets.set(key, { content, options: widgetOptions });
        chrome.widget += 1;
      } else {
        widgets.delete(key);
      }
    },
    setHeader() {
      chrome.header += 1;
    },
    setWorkingMessage(message) {
      workingMessages.push(message);
    },
    setWorkingVisible(visible) {
      workingVisibility.push(visible);
    },
    setWorkingIndicator(indicator) {
      workingIndicators.push(indicator);
    },
    setHiddenThinkingLabel(label) {
      hiddenThinkingLabels.push(label);
    },
    setTheme(name) {
      theme.name = name;
      return { success: true };
    },
    notify(message, level) {
      notifications.push({ message: String(message), level });
    },
    onTerminalInput(handler) {
      terminalInputListeners.add(handler);
      return () => terminalInputListeners.delete(handler);
    },
    select: async (_title, labels) =>
      typeof options.select === "function" ? options.select(labels) : undefined,
    input: async (title, placeholder) =>
      typeof options.input === "function"
        ? options.input(title, placeholder)
        : undefined,
    confirm: async (title, message) => {
      lifecycleCalls.push({ kind: "confirm", title, message });
      return typeof options.confirm === "function"
        ? options.confirm(title, message)
        : (options.confirm ?? true);
    },
    custom(factory) {
      return new Promise((resolve) => {
        const component = factory(tui, theme, {}, resolve);
        customComponents.push(component);
        const index = customCallIndex++;
        if (Array.isArray(options.customResults)) {
          const value =
            index < options.customResults.length
              ? options.customResults[index]
              : undefined;
          queueMicrotask(() => resolve(value));
        } else if ("customResult" in options) {
          queueMicrotask(() => resolve(options.customResult));
        }
      });
    },
    getEditorText() {
      return editorText;
    },
    setEditorText(text) {
      editorText = String(text);
    },
    async submitSlashCommand(commandLine) {
      submittedCommands.push(commandLine);
      editorText = "";
      if (typeof options.onSubmitSlashCommand === "function")
        await options.onSubmitSlashCommand(commandLine);
      const match = commandLine.match(/^\/([^\s]+)(?:\s+(.*))?$/);
      const handler = match ? commands.get(match[1]) : undefined;
      if (handler && activeContext)
        await handler(match[2] ?? "", activeContext);
    },
  };

  function add(map, name, handler) {
    const handlers = map.get(name) ?? [];
    handlers.push(handler);
    map.set(name, handlers);
    return () => {
      const current = map.get(name);
      if (!current) return;
      const index = current.indexOf(handler);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) map.delete(name);
    };
  }

  const api = {
    events: {
      on(name, handler) {
        return add(eventHandlers, name, handler);
      },
      emit(name, event) {
        emitted.push({ name, event });
        for (const handler of eventHandlers.get(name) ?? []) {
          const result = handler(event);
          if (result && typeof result.catch === "function")
            void result.catch(() => {});
        }
      },
    },
    on(name, handler) {
      add(hooks, name, handler);
    },
    registerCommand(name, options) {
      commands.set(name, options.handler);
      commandDescriptions.set(name, options.description);
    },
    registerShortcut(shortcut, options) {
      shortcuts.set(shortcut, options.handler);
    },
    registerTool(tool) {
      if (tools.has(tool.name)) duplicateTools.push(tool.name);
      tools.set(tool.name, tool);
    },
    registerEntryRenderer(customType, renderer) {
      entryRenderers.set(customType, renderer);
    },
    async exec(command, args, execOptions) {
      execCalls.push({ command, args, options: execOptions });
      return {
        stdout: `${options.piVersion ?? "0.80.7"}\n`,
        stderr: "",
        code: 0,
        killed: false,
      };
    },
    registerFlag() {},
    getFlag(name) {
      return options.flags?.[name] ?? false;
    },
    appendEntry(customType, data) {
      appended.push({ type: "custom", customType, data });
    },
    sendMessage(message, sendOptions) {
      lifecycleCalls.push({
        kind: "sendMessage",
        message,
        options: sendOptions,
      });
      if (options.sendMessageError) throw new Error(options.sendMessageError);
      sent.push({ message, options: sendOptions });
    },
    setThinkingLevel(level) {
      thinkingLevel = level;
    },
    getThinkingLevel() {
      return thinkingLevel;
    },
    async setModel(model) {
      setModelCalls.push(model);
      if (options.setModelError) throw new Error(options.setModelError);
    },
    getSessionName() {
      return options.sessionName;
    },
    getCommands() {
      if (Array.isArray(options.commands)) return options.commands;
      return [...commands.keys()].map((name) => ({
        name,
        source: "extension",
        sourceInfo: {
          path: "<test>",
          source: "test",
          scope: "temporary",
          origin: "top-level",
        },
      }));
    },
  };

  return {
    api,
    hooks,
    commands,
    commandDescriptions,
    shortcuts,
    tools,
    duplicateTools,
    statusCalls,
    statuses,
    notifications,
    emitted,
    appended,
    sent,
    customComponents,
    entryRenderers,
    theme,
    chrome,
    workingMessages,
    workingVisibility,
    workingIndicators,
    hiddenThinkingLabels,
    execCalls,
    setModelCalls,
    submittedCommands,
    widgets,
    lifecycleCalls,
    setIdle(value) {
      idle = value;
    },
    sendTerminalInput(data) {
      let current = data;
      for (const listener of [...terminalInputListeners]) {
        const result = listener(current);
        if (result?.consume) return { consumed: true, data: current };
        if (result?.data !== undefined) current = result.data;
      }
      return { consumed: current.length === 0, data: current };
    },
    get terminalInputListenerCount() {
      return terminalInputListeners.size;
    },
    get footerFactory() {
      return footerFactory;
    },
    get branchReads() {
      return branchReads;
    },
    emitBranchChange() {
      for (const listener of branchListeners) listener();
    },
    get editorFactory() {
      return editorFactory;
    },
    get editorText() {
      return editorText;
    },
    makeContext({
      cwd = ROOT,
      mode = "tui",
      hasUI = mode === "tui",
      sessionId = options.sessionId ?? "test-session",
      trusted = true,
      model = {
        id: "main-model",
        provider: "main-provider",
        thinkingLevelMap: { high: "high", medium: "medium" },
      },
    } = {}) {
      activeContext = {
        cwd,
        mode,
        hasUI,
        model,
        modelRegistry: {
          find(provider, id) {
            if (typeof options.modelRegistryFind === "function")
              return options.modelRegistryFind(provider, id);
            return options.models ? options.models[`${provider}/${id}`] : true;
          },
          getAll() {
            return [];
          },
          getAvailable() {
            return options.models ? Object.values(options.models) : [];
          },
        },
        isIdle() {
          return idle;
        },
        isProjectTrusted() {
          return trusted;
        },
        abort() {
          lifecycleCalls.push({ kind: "abort" });
          if (options.abortError) throw new Error(options.abortError);
        },
        waitForIdle: async () => {
          lifecycleCalls.push({ kind: "waitForIdle" });
          if (options.waitForIdleError)
            throw new Error(options.waitForIdleError);
          if (typeof options.onWaitForIdle === "function") {
            await options.onWaitForIdle();
          }
        },
        getContextUsage() {
          return {
            percent: options.contextPercent ?? 42,
            contextWindow: 100000,
          };
        },
        sessionManager: {
          getSessionId() {
            return sessionId;
          },
          getLeafId() {
            return entries.at(-1)?.id ?? null;
          },
          getEntries() {
            return entries;
          },
          getBranch() {
            branchReads += 1;
            return entries;
          },
        },
        ui,
      };
      return activeContext;
    },
    async runHooks(name, event, context) {
      const results = [];
      for (const handler of hooks.get(name) ?? []) {
        results.push(await handler(event, context));
      }
      return results;
    },
    async dispatchEvent(name, event) {
      const results = [];
      for (const handler of eventHandlers.get(name) ?? []) {
        results.push(await handler(event));
      }
      return results;
    },
  };
}
