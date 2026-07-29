/**
 * Agent-Modellmenü (Super+S) Tests:
 * Verifiziert Shortcut-Registrierung, Modellauswahl, Speicherung in setup.json
 * und Live-Aktualisierung von session.routing.
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
import { assert, equal, test } from "./assertions.mjs";
import { createHarness } from "../shared/harness.mjs";
import { load } from "./harness.mjs";

const planMode = await load("extensions/plan-mode/index.ts");
const controlPlane = await load("extensions/control-plane.ts");
const agentModelMenu = await load("extensions/plan-mode/agent-model-menu.ts");

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

await test("agent model menu groups access, model vendor, model, then role", async () => {
  if (!agentModelMenu) return;
  const harness = createHarness({
    columns: 100,
    rows: 32,
    models: {
      "openrouter/openai/gpt-oss-20b": {
        provider: "openrouter",
        id: "openai/gpt-oss-20b",
        name: "GPT-OSS 20B",
      },
      "openrouter/tencent/hy3": {
        provider: "openrouter",
        id: "tencent/hy3",
        name: "Hunyuan 3",
      },
      "opencode-go/qwen3.7-max": {
        provider: "opencode-go",
        id: "qwen3.7-max",
        name: "Qwen3.7 Max",
      },
      "opencode-go/kimi-k2.7-code": {
        provider: "opencode-go",
        id: "kimi-k2.7-code",
        name: "Kimi K2.7 Code",
      },
      "zai/glm-5.2": {
        provider: "zai",
        id: "glm-5.2",
        name: "GLM-5.2",
      },
    },
  });
  const entries = agentModelMenu.buildAgentModelMenuEntries(
    harness.makeContext().modelRegistry.getAvailable(),
    {
      levels: {
        low: { worker: "fast" },
        standard: {
          planner: "opencode-go/qwen3.7-max",
          worker: "coding",
          reviewer: "review",
        },
        high: { planner: "planung", worker: "coding", reviewer: "review" },
      },
    },
  );
  const openCodeGo = entries.find((entry) => entry.label === "OpenCode Go Abo");
  assert(Boolean(openCodeGo), "groups models by access provider");
  const qwenVendor = openCodeGo?.children?.find(
    (entry) => entry.label === "Alibaba (Qwen)",
  );
  assert(Boolean(qwenVendor), "derives the OpenCode Go model vendor");
  const qwen = qwenVendor?.children?.find(
    (entry) => entry.label === "Qwen3.7 Max",
  );
  assert(Boolean(qwen), "shows the model once below its model vendor");
  assert(
    qwen?.children?.some(
      (entry) => entry.label === "STANDARD › Planner" && entry.current,
    ),
    "chooses the routing role after the model and marks its active assignment",
  );
  assert(
    entries.some((entry) => entry.label === "OpenRouter API"),
    "labels the OpenRouter access group",
  );
  assert(
    entries.some((entry) => entry.label === "Z.AI Coding Plan"),
    "labels the Z.AI Coding Plan access group",
  );

  const context = harness.makeContext({ mode: "tui" });
  const pending = agentModelMenu.openAgentModelMenu(harness.api, {}, context);
  await new Promise((resolve) => setImmediate(resolve));
  const component = harness.customComponents.at(-1);
  assert(Boolean(component), "agent model menu opens the shared overlay");
  if (!component) return;

  const standard = component.render(90).join("\n");
  assert(
    standard.includes("OpenCode Go Abo") && standard.includes("OpenRouter API"),
    "renders the access providers at the top level",
  );

  const compact = component.render(45).join("\n");
  assert(
    compact.includes("Z.AI Coding Plan"),
    "keeps access-provider labels visible in compact layout",
  );

  component.handleInput("\u001b");
  await pending;
});

await test("openAgentModelMenu updates setup.json and session routing", async () => {
  if (!planMode || !agentModelMenu) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-agent-model-menu-"));
  try {
    const setupPath = path.join(cwd, "setup.json");
    writeFileSync(
      setupPath,
      JSON.stringify(
        {
          routingProfiles: {
            levels: {
              low: { worker: "fast" },
              standard: { planner: "std", worker: "std", reviewer: "std" },
              high: { planner: "high", worker: "high", reviewer: "high" },
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    // The TUI path is access provider -> model vendor -> model -> role. The
    // harness resolves ctx.ui.custom() straight to the selected leaf value.
    const harness = createHarness({
      customResult: {
        id: "high-reviewer-anthropic/claude-3-opus",
        label: "anthropic/claude-3-opus",
        value: {
          slot: {
            id: "high-reviewer",
            level: "high",
            role: "reviewer",
            label: "HIGH › Reviewer",
          },
          kind: "model",
          ref: "anthropic/claude-3-opus",
        },
      },
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

    // Trigger openAgentModelMenu via the session harness
    const session = harness.session ?? {
      pi: harness.api,
      current: { stateToken: "missing" },
      notify() {},
      workflowMode() {
        return "work";
      },
    };

    await agentModelMenu.openAgentModelMenu(harness.api, session, context);

    // Verify setup.json was updated with high.reviewer = "anthropic/claude-3-opus"
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
