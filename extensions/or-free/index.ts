/**
 * OpenRouter free-model discovery, additive to the Z.ai default setup.
 *
 * Z.ai stays defaultProvider/defaultModel (settings.json is untouched here).
 * This extension only ever changes the *session-scoped* model via
 * pi.setModel() — never settings.json — and only on explicit user command.
 *
 * Free models are fetched from the public OpenRouter Models API, filtered/
 * cached locally (see openrouter-api.ts, storage.ts), and exposed under a
 * dedicated "openrouter-free" provider registered at runtime via
 * pi.registerProvider(). A *separate* provider name is used deliberately:
 * pi.registerProvider("openrouter", { models: [...] }) would replace the
 * entire built-in OpenRouter catalog (paid models included), which is
 * exactly what must not happen here.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
  buildFreeModelList,
  fetchOpenRouterModels,
  formatFreeModelList,
  formatSelectLabel,
  formatContextLength,
  OPENROUTER_BASE_URL,
  ROUTER_FREE_MODEL_ID,
  type FreeModelEntry,
} from "./openrouter-api.ts";
import {
  FILTER_VERSION,
  getCachePath,
  isCacheStale,
  loadConfig,
  readCache,
  writeCacheAtomic,
  type FreeModelsCache,
  type OrFreeConfig,
} from "./storage.ts";
import {
  WORKFLOW_STATUS_EVENT,
  type WorkflowStatusEvent,
} from "../shared/workflow-status.ts";

const FREE_PROVIDER_NAME = "openrouter-free";

function toProviderModelConfig(entry: FreeModelEntry): ProviderModelConfig {
  return {
    id: entry.id,
    name: `${entry.name} (free)`,
    api: "openai-completions",
    reasoning: entry.supportsReasoning,
    input: entry.inputModalities.includes("image")
      ? ["text", "image"]
      : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: entry.contextLength,
    maxTokens: entry.maxCompletionTokens ?? Math.min(entry.contextLength, 8192),
    compat: entry.supportsReasoning
      ? { thinkingFormat: "openrouter" }
      : undefined,
  };
}

async function resolveOpenRouterApiKey(
  ctx: ExtensionContext,
): Promise<string | undefined> {
  try {
    return await ctx.modelRegistry.getApiKeyForProvider("openrouter");
  } catch {
    return undefined;
  }
}

function registerFreeModelsProvider(
  pi: ExtensionAPI,
  entries: FreeModelEntry[],
  apiKey: string | undefined,
): void {
  if (entries.length === 0) return;
  pi.registerProvider(FREE_PROVIDER_NAME, {
    name: "OpenRouter (kostenlos)",
    baseUrl: OPENROUTER_BASE_URL,
    api: "openai-completions",
    apiKey: apiKey ?? "$OPENROUTER_API_KEY",
    models: entries.map(toProviderModelConfig),
  });
}

export default function orFreeExtension(pi: ExtensionAPI): void {
  let escalationActive = false;
  let planningActive = false;
  let planPhase: string = "idle";
  let lastActiveFreeModelId: string | undefined;

  pi.events.on(WORKFLOW_STATUS_EVENT, (event: WorkflowStatusEvent) => {
    if (event.source === "permission") {
      escalationActive =
        event.baseMode === "work" && event.escalation !== "none";
    } else {
      planningActive = event.planningActive;
      planPhase = event.phase;
    }
  });

  async function refreshFreeModels(
    ctx: ExtensionContext,
    options: { silent: boolean },
  ): Promise<{ ok: boolean; count?: number }> {
    const agentDir = getAgentDir();
    let raw: Awaited<ReturnType<typeof fetchOpenRouterModels>>;
    try {
      raw = await fetchOpenRouterModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!options.silent) {
        const existing = readCache(agentDir);
        if (existing) {
          ctx.ui.notify(
            `OpenRouter nicht erreichbar (${message}). Bestehender Cache bleibt aktiv (${existing.count} Modelle, Stand ${existing.fetchedAt}).`,
            "warning",
          );
        } else {
          ctx.ui.notify(
            `OpenRouter nicht erreichbar (${message}). Kein Cache vorhanden.`,
            "error",
          );
        }
      }
      return { ok: false };
    }

    const config = loadConfig(agentDir);
    const models = buildFreeModelList(raw, {
      minContextLength: config.minContextLength,
      includeRouterFree: config.includeRouterFree,
    });
    const cache: FreeModelsCache = {
      fetchedAt: new Date().toISOString(),
      filterVersion: FILTER_VERSION,
      count: models.length,
      models,
    };

    try {
      writeCacheAtomic(agentDir, cache);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!options.silent) {
        ctx.ui.notify(
          `Cache konnte nicht geschrieben werden: ${message}`,
          "error",
        );
      }
      return { ok: false };
    }

    const apiKey = await resolveOpenRouterApiKey(ctx);
    registerFreeModelsProvider(pi, cache.models, apiKey);
    return { ok: true, count: models.length };
  }

  pi.registerCommand("or-free-refresh", {
    description: "Kostenlose OpenRouter-Modelle neu abrufen und lokal cachen",
    handler: async (_args, ctx) => {
      const apiKey = await resolveOpenRouterApiKey(ctx);
      if (!apiKey) {
        ctx.ui.notify(
          'Kein OpenRouter-API-Key konfiguriert (auth.json → "openrouter" oder $OPENROUTER_API_KEY). Die Modell-Liste kann trotzdem abgerufen werden, aber die Modelle können ohne Key nicht genutzt werden.',
          "warning",
        );
      }
      ctx.ui.notify("Rufe OpenRouter Models API ab…", "info");
      const result = await refreshFreeModels(ctx, { silent: false });
      if (!result.ok) return;
      ctx.ui.notify(
        `${result.count} kostenlose OpenRouter-Modelle gefunden und gecacht (${getCachePath(getAgentDir())}).`,
        "info",
      );
    },
  });

  pi.registerCommand("or-free-list", {
    description: "Gecachte kostenlose OpenRouter-Modelle kompakt anzeigen",
    handler: async (_args, ctx) => {
      const agentDir = getAgentDir();
      const cache = readCache(agentDir);
      if (!cache || cache.models.length === 0) {
        ctx.ui.notify(
          "Kein Cache vorhanden oder leer. Führe zuerst /or-free-refresh aus.",
          "warning",
        );
        return;
      }
      const config = loadConfig(agentDir);
      let text = formatFreeModelList(cache.models, cache.fetchedAt);
      if (isCacheStale(cache.fetchedAt, config.cacheTtlHours)) {
        text += `\n\nCache ist älter als ${config.cacheTtlHours}h — /or-free-refresh empfohlen.`;
      }
      ctx.ui.notify(text, "info");
    },
  });

  async function selectAndActivate(
    ctx: ExtensionCommandContext,
    entry: FreeModelEntry,
    config: OrFreeConfig,
  ): Promise<void> {
    if (entry.id === ROUTER_FREE_MODEL_ID) {
      const confirmed = await ctx.ui.confirm(
        "openrouter/free auswählen?",
        "Zufällige Modellwahl durch OpenRouter — welches Modell tatsächlich antwortet, ist bei jeder Anfrage neu und nicht reproduzierbar. Für ernsthafte Coding-Aufgaben nicht empfohlen.",
      );
      if (!confirmed) return;
    }

    const activeTools = pi.getActiveTools();
    if (
      !entry.supportsTools &&
      (config.requireToolsForCoding || activeTools.length > 0)
    ) {
      const confirmed = await ctx.ui.confirm(
        "Modell ohne Tool-Support auswählen?",
        `${entry.id} meldet keinen Tool-Support (aktive Tools in dieser Session: ${activeTools.length}). Ohne Tool-Support kann der Agent keine Dateien lesen/schreiben oder Befehle ausführen.`,
      );
      if (!confirmed) return;
    }

    const cache = readCache(getAgentDir());
    const apiKey = await resolveOpenRouterApiKey(ctx);
    registerFreeModelsProvider(pi, cache?.models ?? [entry], apiKey);

    const model = ctx.modelRegistry.find(FREE_PROVIDER_NAME, entry.id);
    if (!model) {
      ctx.ui.notify(
        `Modell ${entry.id} konnte nicht registriert werden.`,
        "error",
      );
      return;
    }
    const ok = await pi.setModel(model);
    if (!ok) {
      ctx.ui.notify(
        'Kein gültiger OpenRouter-API-Key konfiguriert. Setze auth.json → "openrouter" oder $OPENROUTER_API_KEY.',
        "error",
      );
      return;
    }

    lastActiveFreeModelId = entry.id;
    ctx.ui.setStatus(FREE_PROVIDER_NAME, `OR-Free: ${entry.id}`);
    ctx.ui.notify(
      [
        "Provider: openrouter (free)",
        `Modell: ${entry.id}`,
        `Kontext: ${formatContextLength(entry.contextLength)}`,
        `Tools unterstützt: ${entry.supportsTools ? "ja" : "nein"}`,
        entry.id === ROUTER_FREE_MODEL_ID
          ? "Hinweis: Modellwahl nicht reproduzierbar."
          : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
      "info",
    );
  }

  pi.registerCommand("or-free", {
    description:
      "Kostenloses OpenRouter-Modell interaktiv für diese Session auswählen",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/or-free benötigt eine interaktive UI.", "error");
        return;
      }
      const agentDir = getAgentDir();
      const cache = readCache(agentDir);
      if (!cache || cache.models.length === 0) {
        ctx.ui.notify(
          "Kein Cache vorhanden. Führe zuerst /or-free-refresh aus.",
          "warning",
        );
        return;
      }
      const config = loadConfig(agentDir);
      const labels = cache.models.map((entry) => formatSelectLabel(entry));
      const choice = await ctx.ui.select(
        "Kostenloses OpenRouter-Modell wählen",
        labels,
      );
      if (!choice) return;
      const index = labels.indexOf(choice);
      const entry = cache.models[index];
      if (!entry) return;

      await selectAndActivate(ctx, entry, config);
    },
  });

  pi.registerCommand("or-free-auto", {
    description:
      "Automatisch ein freies OpenRouter-Modell für einfache Aufgaben wählen (kein Plan/Refactor/Git)",
    handler: async (_args, ctx) => {
      const agentDir = getAgentDir();
      const cache = readCache(agentDir);
      if (!cache || cache.models.length === 0) {
        ctx.ui.notify(
          "Kein Cache vorhanden. Führe zuerst /or-free-refresh aus.",
          "warning",
        );
        return;
      }
      if (escalationActive) {
        ctx.ui.notify(
          "Full Access/YOLO ist aktiv — /or-free-auto ist für sicherheitskritische Sessions gesperrt. Nutze /or-free für eine bewusste Auswahl.",
          "warning",
        );
        return;
      }
      if (planningActive || planPhase === "executing") {
        ctx.ui.notify(
          "/or-free-auto ist während Planung/Plan-Ausführung gesperrt. Nutze /or-free für eine bewusste Auswahl.",
          "warning",
        );
        return;
      }

      const candidate = cache.models.find(
        (entry) =>
          entry.supportsTools &&
          entry.id !== ROUTER_FREE_MODEL_ID &&
          (entry.group === "recommended" || entry.group === "large-context"),
      );
      if (!candidate) {
        ctx.ui.notify(
          "Kein für Auto-Auswahl geeignetes Modell im Cache (Tools + stabil erforderlich). Nutze /or-free.",
          "warning",
        );
        return;
      }

      const apiKey = await resolveOpenRouterApiKey(ctx);
      registerFreeModelsProvider(pi, cache.models, apiKey);
      const model = ctx.modelRegistry.find(FREE_PROVIDER_NAME, candidate.id);
      if (!model) {
        ctx.ui.notify(
          `Modell ${candidate.id} konnte nicht registriert werden.`,
          "error",
        );
        return;
      }
      const ok = await pi.setModel(model);
      if (!ok) {
        ctx.ui.notify(
          "Kein gültiger OpenRouter-API-Key konfiguriert.",
          "error",
        );
        return;
      }

      lastActiveFreeModelId = candidate.id;
      ctx.ui.setStatus(FREE_PROVIDER_NAME, `OR-Free-Auto: ${candidate.id}`);
      ctx.ui.notify(
        `Automatisch gewählt: ${candidate.id} (${formatContextLength(candidate.contextLength)}, tools). Nur für einfache Aufgaben — nicht für Pläne, Refactors, Git oder sicherheitskritische Arbeit.`,
        "info",
      );
    },
  });

  pi.on("model_select", async (event, ctx) => {
    if (event.model.provider === FREE_PROVIDER_NAME) {
      lastActiveFreeModelId = event.model.id;
      ctx.ui.setStatus(FREE_PROVIDER_NAME, `OR-Free: ${event.model.id}`);
    } else if (lastActiveFreeModelId !== undefined) {
      lastActiveFreeModelId = undefined;
      ctx.ui.setStatus(FREE_PROVIDER_NAME, undefined);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const agentDir = getAgentDir();
    const cache = readCache(agentDir);
    if (cache && cache.models.length > 0) {
      try {
        const apiKey = await resolveOpenRouterApiKey(ctx);
        registerFreeModelsProvider(pi, cache.models, apiKey);
      } catch {
        // Non-fatal: /or-free-refresh can be run manually if this failed.
      }
    }

    const config = loadConfig(agentDir);
    if (!config.enabled) return;
    if (
      config.autoRefresh &&
      (!cache || isCacheStale(cache.fetchedAt, config.cacheTtlHours))
    ) {
      // Fire-and-forget: never block session start, never surface network
      // errors here — /or-free-refresh gives explicit feedback on request.
      void refreshFreeModels(ctx, { silent: true }).catch(() => {});
    }
  });
}
