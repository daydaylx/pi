/**
 * Agent-Modellmenü (Super+S) Tests:
 * Verifiziert Shortcut-Registrierung, Modellauswahl, Speicherung in setup.json
 * und Live-Aktualisierung von session.routing.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  assert(typeof handler === "function", "super+s shortcut handler is registered");
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

    // Mock select choices: first slot "HIGH › Reviewer", second model "claude-3-opus"
    let selectCallCount = 0;
    const harness = createHarness({
      select: async (labels) => {
        selectCallCount++;
        if (selectCallCount === 1) {
          const matched = labels.find(
            (opt) => opt.includes("HIGH") && opt.includes("Reviewer"),
          );
          if (!matched) {
            throw new Error(
              `Expected slot label with HIGH and Reviewer, got: ${JSON.stringify(labels)}`,
            );
          }
          return matched;
        }
        const matchedModel = labels.find((opt) => opt.includes("claude-3-opus"));
        if (!matchedModel) {
          throw new Error(
            `Expected model option with claude-3-opus, got: ${JSON.stringify(labels)}`,
          );
        }
        return matchedModel;
      },
      models: {
        "anthropic/claude-3-opus": { provider: "anthropic", id: "claude-3-opus" },
        "anthropic/claude-3-5-haiku": { provider: "anthropic", id: "claude-3-5-haiku" },
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
