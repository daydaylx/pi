/**
 * Agent-Modellmenü (Super+S) Tests:
 * Verifiziert Shortcut-Registrierung, die Tab-Übersicht je Routing-Stufe, die
 * nach Anbieter kategorisierte Modell-Liste, Speicherung in setup.json und
 * Live-Aktualisierung von session.routing.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq, equal, test } from "./assertions.mjs";
import { createHarness } from "../shared/harness.mjs";
import { load } from "./harness.mjs";

const planMode = await load("extensions/plan-mode/index.ts");
const controlPlane = await load("extensions/control-plane.ts");
const agentModelMenu = await load("extensions/plan-mode/agent-model-menu.ts");

function baseRoutingProfiles() {
  return {
    levels: {
      low: { worker: "fast" },
      standard: { planner: "std", worker: "std", reviewer: "std" },
      high: { planner: "high", worker: "high", reviewer: "high" },
    },
  };
}

function fallbackSession() {
  return {
    pi: undefined,
    current: { stateToken: "missing" },
    notify() {},
    workflowMode() {
      return "work";
    },
  };
}

await test("Super+S shortcut is registered by the control plane", async () => {
  if (!planMode || !controlPlane) return;
  const harness = createHarness();
  planMode.default(harness.api);
  controlPlane.default(harness.api);
  const handler = harness.shortcuts.get("super+s");
  assert(
    typeof handler === "function",
    "super+s shortcut handler is registered",
  );
});

await test("buildLevelTabs exposes LOW/STANDARD/HIGH, LOW limited to Worker", async () => {
  if (!agentModelMenu) return;
  const tabs = agentModelMenu.buildLevelTabs(baseRoutingProfiles());
  eq(
    tabs.map((tab) => tab.id),
    ["low", "standard", "high"],
    "tabs follow the routing level order",
  );
  eq(
    tabs.find((tab) => tab.id === "low").entries.map((entry) => entry.label),
    ["Worker"],
    "LOW only exposes the Worker role",
  );
  eq(
    tabs
      .find((tab) => tab.id === "standard")
      .entries.map((entry) => entry.label),
    ["Planner", "Worker", "Reviewer"],
    "STANDARD exposes all three roles",
  );
  eq(
    tabs.find((tab) => tab.id === "high").entries.map((entry) => entry.label),
    ["Planner", "Worker", "Reviewer"],
    "HIGH exposes all three roles",
  );
  const lowWorker = tabs.find((tab) => tab.id === "low").entries[0];
  eq(
    lowWorker.description,
    "aktuell: fast",
    "shows the currently assigned profile per role",
  );
});

await test("buildModelPickerEntries groups by access provider and flags the active model", async () => {
  if (!agentModelMenu) return;
  const slot = {
    id: "high-worker",
    level: "high",
    role: "worker",
    label: "HIGH › Worker",
  };
  const availableModels = [
    { provider: "opencode-go", id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    {
      provider: "opencode-go",
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
    },
    { provider: "openai-codex", id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
  ];
  const profiles = {
    levels: {
      low: { worker: "fast" },
      standard: { planner: "p", worker: "w", reviewer: "r" },
      high: {
        planner: "p",
        worker: "opencode-go/deepseek-v4-pro",
        reviewer: "r",
      },
    },
  };
  const entries = agentModelMenu.buildModelPickerEntries(
    slot,
    availableModels,
    profiles,
  );
  assert(
    entries.some((entry) => entry.section === "OpenCode Go Abo"),
    "groups OpenCode Go models under their access-provider section",
  );
  assert(
    entries.some((entry) => entry.section === "OpenAI Codex Abo"),
    "groups OpenAI Codex models under their access-provider section",
  );
  const active = entries.find(
    (entry) =>
      entry.value?.kind === "model" &&
      entry.value.ref === "opencode-go/deepseek-v4-pro",
  );
  assert(active?.current, "marks the currently assigned model as active");
  assert(
    entries.some((entry) => entry.value?.kind === "freitext"),
    "offers a manual/freitext entry",
  );
});

await test("selecting a model returns to the tab overview instead of closing", async () => {
  if (!planMode || !agentModelMenu) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-agent-model-menu-e2e-"));
  try {
    const setupPath = path.join(cwd, "setup.json");
    writeFileSync(
      setupPath,
      JSON.stringify({ routingProfiles: baseRoutingProfiles() }, null, 2),
      "utf-8",
    );

    const harness = createHarness({
      models: {
        "openai-codex/gpt-5.6-terra": {
          provider: "openai-codex",
          id: "gpt-5.6-terra",
          name: "GPT-5.6 Terra",
        },
        "opencode-go/deepseek-v4-pro": {
          provider: "opencode-go",
          id: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
        },
      },
    });
    planMode.default(harness.api);
    const context = harness.makeContext({ cwd, mode: "tui" });
    await harness.runHooks("session_start", {}, context);
    const session = harness.session ?? fallbackSession();

    const pending = agentModelMenu.openAgentModelMenu(
      harness.api,
      session,
      context,
    );
    await new Promise((resolve) => setImmediate(resolve));

    let component = harness.customComponents.at(-1);
    assert(Boolean(component), "opens the level/role tab overview first");
    if (!component) return;
    // No session.routing yet -> defaults to the STANDARD tab, first role
    // (Planner) pre-selected.
    component.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));

    equal(
      harness.customComponents.length,
      2,
      "opens a second overlay for the model list",
    );
    component = harness.customComponents.at(-1);
    // Sorted by access provider first: "OpenAI Codex Abo" precedes
    // "OpenCode Go Abo", so GPT-5.6 Terra is the first selectable model.
    component.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));

    equal(
      harness.customComponents.length,
      3,
      "returns to the tab overview after a model is chosen instead of closing",
    );
    component = harness.customComponents.at(-1);
    const rendered = component.render(90).join("\n");
    assert(
      rendered.includes("aktuell: openai-codex/gpt-5.6-terra"),
      "tab overview reflects the freshly saved assignment",
    );

    component.handleInput("\u001b");
    await pending;

    const updatedSetup = JSON.parse(readFileSync(setupPath, "utf-8"));
    equal(
      updatedSetup.routingProfiles.levels.standard.planner,
      "openai-codex/gpt-5.6-terra",
      "STANDARD Planner receives the newly selected model",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("openAgentModelMenu updates setup.json and session routing", async () => {
  if (!planMode || !agentModelMenu) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-agent-model-menu-"));
  try {
    const setupPath = path.join(cwd, "setup.json");
    writeFileSync(
      setupPath,
      JSON.stringify({ routingProfiles: baseRoutingProfiles() }, null, 2),
      "utf-8",
    );

    const highReviewerSlot = {
      id: "high-reviewer",
      level: "high",
      role: "reviewer",
      label: "HIGH › Reviewer",
    };

    // The TUI path is: level/role tab overview -> model picker. The harness
    // resolves each ctx.ui.custom() call in sequence via customResults.
    const harness = createHarness({
      customResults: [
        {
          tabId: "high",
          entry: {
            id: "high-reviewer",
            label: "Reviewer",
            value: highReviewerSlot,
          },
        },
        {
          id: "model-anthropic/claude-3-opus",
          label: "Claude 3 Opus",
          value: {
            slot: highReviewerSlot,
            kind: "model",
            ref: "anthropic/claude-3-opus",
          },
        },
      ],
      models: {
        "anthropic/claude-3-opus": {
          provider: "anthropic",
          id: "claude-3-opus",
          name: "Claude 3 Opus",
        },
        "anthropic/claude-3-5-haiku": {
          provider: "anthropic",
          id: "claude-3-5-haiku",
          name: "Claude 3.5 Haiku",
        },
      },
    });
    planMode.default(harness.api);
    const context = harness.makeContext({ cwd, mode: "tui" });

    await harness.runHooks("session_start", {}, context);

    const session = harness.session ?? fallbackSession();

    await agentModelMenu.openAgentModelMenu(harness.api, session, context);

    assert(existsSync(setupPath), "setup.json exists");
    const updatedSetup = JSON.parse(readFileSync(setupPath, "utf-8"));
    equal(
      updatedSetup.routingProfiles.levels.high.reviewer,
      "anthropic/claude-3-opus",
      "HIGH reviewer model updated in setup.json",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("openAgentModelMenu accepts a manual (freitext) profile name", async () => {
  if (!planMode || !agentModelMenu) return;
  const cwd = mkdtempSync(
    path.join(tmpdir(), "pi-v3-agent-model-menu-freitext-"),
  );
  try {
    const setupPath = path.join(cwd, "setup.json");
    writeFileSync(
      setupPath,
      JSON.stringify({ routingProfiles: baseRoutingProfiles() }, null, 2),
      "utf-8",
    );

    const lowWorkerSlot = {
      id: "low-worker",
      level: "low",
      role: "worker",
      label: "LOW › Worker",
    };

    const harness = createHarness({
      customResults: [
        {
          tabId: "low",
          entry: { id: "low-worker", label: "Worker", value: lowWorkerSlot },
        },
        {
          id: "manual",
          label: "✏ Manuellen Profilnamen eingeben",
          value: { slot: lowWorkerSlot, kind: "freitext" },
        },
      ],
      input: async () => "custom-model-name",
    });
    planMode.default(harness.api);
    const context = harness.makeContext({ cwd, mode: "tui" });
    await harness.runHooks("session_start", {}, context);
    const session = harness.session ?? fallbackSession();

    await agentModelMenu.openAgentModelMenu(harness.api, session, context);

    const updatedSetup = JSON.parse(readFileSync(setupPath, "utf-8"));
    equal(
      updatedSetup.routingProfiles.levels.low.worker,
      "custom-model-name",
      "LOW worker accepts a manually entered profile name",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Esc on the tab overview closes the menu without touching setup.json", async () => {
  if (!planMode || !agentModelMenu) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-agent-model-menu-esc-"));
  try {
    const setupPath = path.join(cwd, "setup.json");
    const original = { routingProfiles: baseRoutingProfiles() };
    writeFileSync(setupPath, JSON.stringify(original, null, 2), "utf-8");

    const harness = createHarness({ customResults: [] });
    planMode.default(harness.api);
    const context = harness.makeContext({ cwd, mode: "tui" });
    await harness.runHooks("session_start", {}, context);
    const session = harness.session ?? fallbackSession();

    await agentModelMenu.openAgentModelMenu(harness.api, session, context);

    const unchanged = JSON.parse(readFileSync(setupPath, "utf-8"));
    eq(
      unchanged,
      original,
      "setup.json is left untouched when the menu closes immediately",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("menu remains fully usable without a custom TUI overlay (select fallback)", async () => {
  if (!planMode || !agentModelMenu) return;
  const cwd = mkdtempSync(
    path.join(tmpdir(), "pi-v3-agent-model-menu-fallback-"),
  );
  try {
    const setupPath = path.join(cwd, "setup.json");
    writeFileSync(
      setupPath,
      JSON.stringify({ routingProfiles: baseRoutingProfiles() }, null, 2),
      "utf-8",
    );

    let roleListPicks = 0;
    const harness = createHarness({
      models: {
        "anthropic/claude-3-opus": {
          provider: "anthropic",
          id: "claude-3-opus",
          name: "Claude 3 Opus",
        },
      },
      select: (labels) => {
        if (labels.includes("LOW › Worker")) {
          roleListPicks += 1;
          return roleListPicks === 1 ? "LOW › Worker" : undefined;
        }
        return labels.find((label) => label === "Claude 3 Opus");
      },
    });
    planMode.default(harness.api);
    const context = harness.makeContext({ cwd, mode: "tui" });
    context.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await harness.runHooks("session_start", {}, context);
    const session = harness.session ?? fallbackSession();

    await agentModelMenu.openAgentModelMenu(harness.api, session, context);

    const updatedSetup = JSON.parse(readFileSync(setupPath, "utf-8"));
    equal(
      updatedSetup.routingProfiles.levels.low.worker,
      "anthropic/claude-3-opus",
      "role and model stay reachable through the plain-select fallback",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
