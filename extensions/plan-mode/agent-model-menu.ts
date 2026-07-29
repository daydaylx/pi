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
  computeRouting,
  routingInputFromDirectTask,
  routingInputFromPlan,
} from "./routing/index.ts";
import type { RoutingLevel, RoutingProfilesConfig } from "./routing/types.ts";
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

  const entries = buildAgentModelMenuEntries(
    ctx.modelRegistry.getAvailable(),
    currentProfiles,
  );

  const choice = await runMenu(
    ctx,
    "Agenten-Modelle anpassen (Super+S)",
    entries,
    {
      nonInteractiveHint: "Die Agenten-Modell-Auswahl benötigt den TUI-Modus.",
    },
  );
  if (!choice) return;

  const { slot: chosenSlot } = choice;
  const activeAssigned =
    currentProfiles.levels?.[chosenSlot.level]?.[chosenSlot.role];

  let selectedModel: string | undefined;

  if (choice.kind === "freitext") {
    const inputFn = (
      ctx.ui as unknown as {
        input?: (
          title: string,
          placeholder?: string,
        ) => Promise<string | undefined>;
      }
    ).input;
    if (typeof inputFn === "function") {
      selectedModel = await inputFn(
        `Profilname für ${chosenSlot.label}`,
        activeAssigned ?? "z. B. gpt-4o",
      );
    }
  } else {
    selectedModel = choice.ref;
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

  ctx.ui.notify(`${chosenSlot.label} auf '${selectedModel}' gesetzt.`, "info");
}

export function buildAgentModelMenuEntries(
  availableModels: readonly AvailableModel[],
  currentProfiles: RoutingProfilesConfig,
): MenuEntry<AgentModelChoice>[] {
  const accessGroups = new Map<string, Map<string, AvailableModel[]>>();
  for (const model of availableModels) {
    const vendors = accessGroups.get(model.provider) ?? new Map();
    const vendor = modelVendorDisplayName(model);
    const models = vendors.get(vendor) ?? [];
    models.push(model);
    vendors.set(vendor, models);
    accessGroups.set(model.provider, vendors);
  }

  const entries: MenuEntry<AgentModelChoice>[] = [...accessGroups.entries()]
    .sort(([left], [right]) =>
      accessProviderDisplayName(left).localeCompare(
        accessProviderDisplayName(right),
        "de-DE",
      ),
    )
    .map(([accessProvider, vendors]) => ({
      id: `access-${accessProvider}`,
      label: accessProviderDisplayName(accessProvider),
      description: `${[...vendors.values()].flat().length} verfügbare Modelle`,
      children: [...vendors.entries()]
        .sort(([left], [right]) => left.localeCompare(right, "de-DE"))
        .map(([vendor, models]) => ({
          id: `vendor-${accessProvider}-${vendor}`,
          label: vendor,
          children: [...models]
            .sort((left, right) =>
              left.name.localeCompare(right.name, "de-DE"),
            )
            .map((model) => modelEntry(model, currentProfiles)),
        })),
    }));

  entries.push({
    id: "manual-profile",
    label: "✏ Manuelles Profil / Freitext eingeben",
    description: "Profilnamen ohne Auswahl eines Registry-Modells festlegen",
    children: AGENT_ROLE_SLOTS.map((slot) => ({
      id: `manual-${slot.id}`,
      label: slot.label,
      description: `aktuell: ${assignedProfile(currentProfiles, slot)}`,
      value: { slot, kind: "freitext" },
    })),
  });
  return entries;
}

function modelEntry(
  model: AvailableModel,
  currentProfiles: RoutingProfilesConfig,
): MenuEntry<AgentModelChoice> {
  const ref = `${model.provider}/${model.id}`;
  return {
    id: `model-${ref}`,
    label: model.name,
    compactLabel: model.name,
    description: `${accessProviderDisplayName(model.provider)} · ${model.id}`,
    children: AGENT_ROLE_SLOTS.map((slot) => ({
      id: `${ref}-${slot.id}`,
      label: slot.label,
      description: `aktuell: ${assignedProfile(currentProfiles, slot)}`,
      current: ref === assignedProfile(currentProfiles, slot),
      value: { slot, kind: "model", ref },
    })),
  };
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
