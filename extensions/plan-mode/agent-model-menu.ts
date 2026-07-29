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
import { runMenu, type MenuEntry } from "../shared/menu-ui.ts";
import {
  runTabbedOverlay,
  type TabbedOverlayTab,
} from "../shared/tabbed-overlay.ts";
import {
  computeRouting,
  routingInputFromDirectTask,
  routingInputFromPlan,
} from "./routing/index.ts";
import {
  ROUTING_LEVELS,
  type RoutingLevel,
  type RoutingProfilesConfig,
} from "./routing/types.ts";
import type { WorkflowSession } from "./session.ts";
import { loadDirectTask } from "./store/index.ts";

interface AgentRoleSlot {
  id: string;
  level: RoutingLevel;
  role: "planner" | "worker" | "reviewer";
  label: string;
}

type AgentModelChoice =
  | { slot: AgentRoleSlot; kind: "model"; ref: string }
  | { slot: AgentRoleSlot; kind: "freitext" };

interface AvailableModel {
  provider: string;
  id: string;
  name: string;
}

const ACCESS_PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "openai-codex": "OpenAI Codex Abo",
  "opencode-go": "OpenCode Go Abo",
  openrouter: "OpenRouter API",
  zai: "Z.AI Coding Plan",
  anthropic: "Anthropic API",
};

const MODEL_VENDOR_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  glm: "Z.AI (GLM)",
  kimi: "Moonshot AI (Kimi)",
  minimax: "MiniMax",
  mimo: "Xiaomi (MiMo)",
  openai: "OpenAI",
  qwen: "Alibaba (Qwen)",
  tencent: "Tencent",
  zai: "Z.AI",
};

const DIRECT_MODEL_VENDORS: Readonly<Record<string, string>> = {
  "openai-codex": "OpenAI",
  zai: "Z.AI",
  anthropic: "Anthropic",
};

function accessProviderDisplayName(provider: string): string {
  return ACCESS_PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}

function modelVendorDisplayName(model: AvailableModel): string {
  const directVendor = DIRECT_MODEL_VENDORS[model.provider];
  if (directVendor) return directVendor;

  const normalizedId = model.id.toLocaleLowerCase("en-US");
  const family = Object.keys(MODEL_VENDOR_DISPLAY_NAMES).find((candidate) =>
    normalizedId.startsWith(candidate),
  );
  if (family) return MODEL_VENDOR_DISPLAY_NAMES[family];

  const routedVendor = model.id.split("/", 1)[0]?.trim();
  if (routedVendor && model.id.includes("/"))
    return readableVendorName(routedVendor);

  return accessProviderDisplayName(model.provider);
}

function readableVendorName(vendor: string): string {
  const normalized = vendor.toLocaleLowerCase("en-US");
  if (MODEL_VENDOR_DISPLAY_NAMES[normalized])
    return MODEL_VENDOR_DISPLAY_NAMES[normalized];
  return vendor
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 4
        ? part.toLocaleUpperCase("en-US")
        : `${part[0]?.toLocaleUpperCase("en-US")}${part.slice(1)}`,
    )
    .join(" ");
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

function roleLabel(role: AgentRoleSlot["role"]): string {
  switch (role) {
    case "planner":
      return "Planner";
    case "worker":
      return "Worker";
    case "reviewer":
      return "Reviewer";
  }
}

function slotsForLevel(level: RoutingLevel): readonly AgentRoleSlot[] {
  return AGENT_ROLE_SLOTS.filter((slot) => slot.level === level);
}

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
  let currentProfiles: RoutingProfilesConfig = JSON.parse(
    JSON.stringify(loadedSetup.config.routingProfiles),
  );
  let activeTabId: string = session.routing?.level ?? "standard";

  for (;;) {
    const picked = await runTabbedOverlay<AgentRoleSlot>(
      ctx,
      "Agenten-Modelle anpassen (Super+S)",
      buildLevelTabs(currentProfiles),
      {
        initialTabId: activeTabId,
        nonInteractiveHint:
          "Die Agenten-Modell-Auswahl benötigt den TUI-Modus.",
      },
    );
    if (!picked?.entry.value) return;
    activeTabId = picked.tabId;
    const slot = picked.entry.value;

    const choice = await runMenu(
      ctx,
      `${slot.label} · Modell wählen`,
      buildModelPickerEntries(
        slot,
        ctx.modelRegistry.getAvailable(),
        currentProfiles,
      ),
      {
        nonInteractiveHint:
          "Die Agenten-Modell-Auswahl benötigt den TUI-Modus.",
      },
    );
    if (!choice) continue;

    const updated = await applyModelChoice(
      choice,
      currentProfiles,
      session,
      ctx,
    );
    if (updated) currentProfiles = updated;
  }
}

/** Stufe 1: ein Tab je Routing-Stufe, Zeilen = deren Rollen-Slots (LOW nur "Worker"). */
export function buildLevelTabs(
  currentProfiles: RoutingProfilesConfig,
): TabbedOverlayTab<AgentRoleSlot>[] {
  return ROUTING_LEVELS.map((level) => ({
    id: level,
    label: level.toLocaleUpperCase("de-DE"),
    entries: slotsForLevel(level).map((slot) => ({
      id: slot.id,
      label: roleLabel(slot.role),
      description: `aktuell: ${assignedProfile(currentProfiles, slot)}`,
      value: slot,
    })),
  }));
}

/**
 * Stufe 2: flache, nach Access-Provider gruppierte Modell-Liste für einen
 * Slot. Sortiert primär nach Access-Provider (sonst reißen die `section`-
 * Blöcke im Renderer auseinander), sekundär nach Modellname.
 */
export function buildModelPickerEntries(
  slot: AgentRoleSlot,
  availableModels: readonly AvailableModel[],
  currentProfiles: RoutingProfilesConfig,
): MenuEntry<AgentModelChoice>[] {
  const assigned = assignedProfile(currentProfiles, slot);
  const entries: MenuEntry<AgentModelChoice>[] = [...availableModels]
    .sort(
      (left, right) =>
        accessProviderDisplayName(left.provider).localeCompare(
          accessProviderDisplayName(right.provider),
          "de-DE",
        ) || left.name.localeCompare(right.name, "de-DE"),
    )
    .map((model) => {
      const ref = `${model.provider}/${model.id}`;
      return {
        id: `${slot.id}-${ref}`,
        label: model.name,
        compactLabel: model.name,
        description: `${modelVendorDisplayName(model)} · ${model.id}`,
        section: accessProviderDisplayName(model.provider),
        current: ref === assigned,
        value: { slot, kind: "model", ref },
      };
    });

  entries.push({
    id: `${slot.id}-manual`,
    label: "✏ Manuellen Profilnamen eingeben",
    description: "Profilnamen ohne Auswahl eines Registry-Modells festlegen",
    section: "Manuell",
    value: { slot, kind: "freitext" },
  });

  return entries;
}

async function applyModelChoice(
  choice: AgentModelChoice,
  currentProfiles: RoutingProfilesConfig,
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<RoutingProfilesConfig | undefined> {
  const { slot } = choice;
  let selectedModel: string | undefined;

  if (choice.kind === "freitext") {
    const activeAssigned = assignedProfile(currentProfiles, slot);
    selectedModel = await ctx.ui.input(
      `Profilname für ${slot.label}`,
      activeAssigned !== "—" ? activeAssigned : "z. B. gpt-4o",
    );
  } else {
    selectedModel = choice.ref;
  }

  if (!selectedModel || !selectedModel.trim()) return undefined;
  selectedModel = selectedModel.trim();

  const next: RoutingProfilesConfig = JSON.parse(
    JSON.stringify(currentProfiles),
  );
  if (!next.levels[slot.level]) {
    next.levels[slot.level] = { worker: "default" };
  }
  next.levels[slot.level][slot.role] = selectedModel;

  saveRoutingProfilesToSetup(ctx.cwd, next);

  if (session.routing) {
    const task = loadDirectTask(ctx.cwd);
    const baseInput = task
      ? routingInputFromDirectTask(task)
      : session.current.snapshot
        ? routingInputFromPlan(session.current.snapshot)
        : undefined;
    if (baseInput) {
      session.routing = computeRouting(baseInput, next);
    }
  }

  ctx.ui.notify(`${slot.label} auf '${selectedModel}' gesetzt.`, "info");
  return next;
}

function assignedProfile(
  profiles: RoutingProfilesConfig,
  slot: AgentRoleSlot,
): string {
  return profiles.levels?.[slot.level]?.[slot.role] ?? "—";
}

function saveRoutingProfilesToSetup(
  cwd: string,
  routingProfiles: unknown,
): void {
  const setupPath = existsSync(join(cwd, ".pi", "setup.json"))
    ? join(cwd, ".pi", "setup.json")
    : join(cwd, "setup.json");

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
