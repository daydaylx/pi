/**
 * Agent model routing control (Super+S and Control Center "Agenten-Modelle").
 *
 * Provides an interactive UI to inspect and update the model profiles assigned
 * to Planner, Worker, and Reviewer roles across the three routing levels (LOW,
 * STANDARD, HIGH). Persists changes to setup.json and re-evaluates active
 * session routing in memory.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadSetupConfig } from "../setup-core/config.ts";
import { computeRouting, routingInputFromDirectTask, routingInputFromPlan } from "./routing/index.ts";
import type { RoutingLevel } from "./routing/types.ts";
import type { WorkflowSession } from "./session.ts";
import { loadDirectTask } from "./store/index.ts";

interface AgentRoleSlot {
  id: string;
  level: RoutingLevel;
  role: "planner" | "worker" | "reviewer";
  label: string;
}

const AGENT_ROLE_SLOTS: readonly AgentRoleSlot[] = [
  { id: "low-worker", level: "low", role: "worker", label: "LOW › Worker" },
  {
    id: "standard-planner",
    level: "standard",
    role: "planner",
    label: "STANDARD › Planner",
  },
  {
    id: "standard-worker",
    level: "standard",
    role: "worker",
    label: "STANDARD › Worker",
  },
  {
    id: "standard-reviewer",
    level: "standard",
    role: "reviewer",
    label: "STANDARD › Reviewer",
  },
  {
    id: "high-planner",
    level: "high",
    role: "planner",
    label: "HIGH › Planner",
  },
  { id: "high-worker", level: "high", role: "worker", label: "HIGH › Worker" },
  {
    id: "high-reviewer",
    level: "high",
    role: "reviewer",
    label: "HIGH › Reviewer",
  },
];

export async function openAgentModelMenu(
  _pi: ExtensionAPI,
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
    ctx.ui.notify(
      "Der Agent arbeitet gerade. Ein Modellwechsel ist erst danach möglich.",
      "warning",
    );
    return;
  }

  const loadedSetup = loadSetupConfig(ctx.cwd, ctx.isProjectTrusted());
  const currentProfiles = JSON.parse(
    JSON.stringify(loadedSetup.config.routingProfiles),
  );

  const slotLabels = AGENT_ROLE_SLOTS.map((slot) => {
    const assigned = currentProfiles.levels?.[slot.level]?.[slot.role] ?? "—";
    return `${slot.label.padEnd(24)} (aktuell: ${assigned})`;
  });

  const slotChoice = await ctx.ui.select(
    "Agenten-Modelle anpassen (Super+S)",
    slotLabels,
  );
  if (!slotChoice) return;

  const chosenSlot = AGENT_ROLE_SLOTS.find((slot) =>
    slotChoice.includes(slot.label),
  );
  if (!chosenSlot) return;

  const availableModels = [
    ...ctx.modelRegistry.getAvailable(),
  ].sort((left, right) =>
    `${left.provider}/${left.id}`.localeCompare(`${right.provider}/${right.id}`),
  );

  const activeAssigned =
    currentProfiles.levels?.[chosenSlot.level]?.[chosenSlot.role];

  const modelOptions: string[] = availableModels.map((model) => {
    const ref = `${model.provider}/${model.id}`;
    return ref === activeAssigned ? `● ${ref}` : `  ${ref}`;
  });

  modelOptions.push("✏  Manuelles Profil / Freitext eingeben");

  const modelChoice = await ctx.ui.select(
    `Modell für ${chosenSlot.label} wählen`,
    modelOptions,
  );
  if (!modelChoice) return;

  let selectedModel: string | undefined;

  if (modelChoice.includes("Freitext eingeben")) {
    const inputFn = (
      ctx.ui as unknown as {
        input?: (title: string, placeholder?: string) => Promise<string | undefined>;
      }
    ).input;
    if (typeof inputFn === "function") {
      selectedModel = await inputFn(
        `Profilname für ${chosenSlot.label}`,
        activeAssigned ?? "z. B. gpt-4o",
      );
    }
  } else {
    const matched = availableModels.find((model) =>
      modelChoice.endsWith(`${model.provider}/${model.id}`),
    );
    if (matched) {
      selectedModel = `${matched.provider}/${matched.id}`;
    }
  }

  if (!selectedModel || !selectedModel.trim()) return;
  selectedModel = selectedModel.trim();

  if (!currentProfiles.levels[chosenSlot.level]) {
    currentProfiles.levels[chosenSlot.level] = { worker: "default" };
  }
  currentProfiles.levels[chosenSlot.level][chosenSlot.role] = selectedModel;

  saveRoutingProfilesToSetup(ctx.cwd, currentProfiles);

  if (session.routing) {
    const task = loadDirectTask(ctx.cwd);
    const baseInput = task
      ? routingInputFromDirectTask(task)
      : session.current.snapshot
        ? routingInputFromPlan(session.current.snapshot)
        : undefined;
    if (baseInput) {
      session.routing = computeRouting(baseInput, currentProfiles);
    }
  }

  ctx.ui.notify(
    `${chosenSlot.label} auf '${selectedModel}' gesetzt.`,
    "info",
  );
}

function saveRoutingProfilesToSetup(
  cwd: string,
  routingProfiles: unknown,
): void {
  const setupPath = existsSync(join(cwd, ".pi", "setup.json"))
    ? join(cwd, ".pi", "setup.json")
    : existsSync(join(cwd, "setup.json"))
      ? join(cwd, "setup.json")
      : join(getAgentDir(), "setup.json");

  let existing: Record<string, unknown> = {};
  if (existsSync(setupPath)) {
    try {
      existing = JSON.parse(readFileSync(setupPath, "utf-8"));
    } catch {
      existing = {};
    }
  }
  existing.routingProfiles = routingProfiles;
  try {
    const dir = join(setupPath, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(setupPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  } catch {
    // ignore write errors
  }
}
