/**
 * Auto-Router Extension für Z.ai GLM
 *
 * Analysiert den Prompt vor jedem Agentenlauf und wählt automatisch
 * zwischen GLM-5-Turbo (einfach) und GLM-5.2 (komplex).
 * Zeigt Routing-Entscheidung sichtbar an.
 *
 * Kommandos: /auto  /turbo  /deep
 * Manuelle Modi übersteuern bis zum nächsten /auto.
 *
 * Darf NICHT: Provider registrieren, API-Keys verwalten, committen, pushen.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ── Konfiguration ─────────────────────────────────────────────────────────────

const TURBO_MODEL_ID = "glm-5-turbo"; // ggf. nach `pi --list-models` anpassen
const COMPLEX_MODEL_ID = "glm-5.2";
const PROVIDER = "zai";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type RouterMode = "auto" | "turbo" | "deep";

// Schlüsselwörter → Turbo/medium (Text-/Doku-Aufgaben)
const TURBO_TEXT_KEYWORDS = [
  "typo",
  "tippfehler",
  "readme",
  "umbenennen",
  "rename",
  "formatieren",
  "format",
  "text ändern",
  "kurze erklärung",
  "erkläre kurz",
  "übersetze",
  "translate",
];

// Schlüsselwörter → Turbo/high (kleine Codefixes)
const TURBO_CODE_KEYWORDS = [
  "kurz",
  "klein",
  "nur",
  "einzelne datei",
  "eine datei",
  "kleine korrektur",
  "kleiner fix",
  "quick fix",
  "quickfix",
];

// Schlüsselwörter → GLM-5.2/xhigh (echte Architektur- und Sicherheitsarbeit)
const DEEP_XHIGH_KEYWORDS = [
  "architektur",
  "architecture",
  "refactoring",
  "refactor",
  "migration",
  "migrieren",
  "security",
  "sicherheit",
  "implementierungsplan",
  "große änderung",
  "grosse änderung",
  "multi-file",
  "root cause",
  "ursache finden",
];

// Schlüsselwörter → GLM-5.2/high (Analyse, Review, Standard-Coding)
const DEEP_HIGH_KEYWORDS = [
  "buganalyse",
  "bug analyse",
  "fehleranalyse",
  "debug",
  "review",
  "prüfen",
  "testen",
  "tests",
  "analyse",
  "build-fehler",
  "test-fehler",
  "plan erstellen",
  "plan:",
  "dokumentation prüfen",
  "komplexe",
  "performance",
  "performanz",
  "agent",
  "workflow",
  "repo-analyse",
  "repo analyse",
  "mehrere dateien",
  "viele dateien",
];

// ── Routing-Logik ─────────────────────────────────────────────────────────────

interface RoutingDecision {
  modelId: string;
  level: ThinkingLevel;
  reason: string;
}

function analyzePrompt(prompt: string): RoutingDecision {
  const lower = prompt.toLowerCase();

  // xhigh zuerst (überschreibt alles andere)
  for (const kw of DEEP_XHIGH_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        modelId: COMPLEX_MODEL_ID,
        level: "xhigh",
        reason: `Schlüsselwort erkannt: "${kw}"`,
      };
    }
  }

  // GLM-5.2 / high
  for (const kw of DEEP_HIGH_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        modelId: COMPLEX_MODEL_ID,
        level: "high",
        reason: `Schlüsselwort erkannt: "${kw}"`,
      };
    }
  }

  // Turbo / medium (Text/Doku)
  for (const kw of TURBO_TEXT_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        modelId: TURBO_MODEL_ID,
        level: "medium",
        reason: `Leichte Text-Aufgabe: "${kw}"`,
      };
    }
  }

  // Turbo / high (kleiner Fix)
  for (const kw of TURBO_CODE_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        modelId: TURBO_MODEL_ID,
        level: "high",
        reason: `Kleiner Fix: "${kw}"`,
      };
    }
  }

  // Default: GLM-5.2 / high (lieber zu viel als zu wenig)
  return {
    modelId: COMPLEX_MODEL_ID,
    level: "high",
    reason: "Kein eindeutiges Keyword → sicherer Default",
  };
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function autoRouterExtension(pi: ExtensionAPI) {
  let routerMode: RouterMode = "auto";
  let lastRoutingKey = "";

  function updateStatus(ctx: ExtensionContext) {
    const modeLabel =
      routerMode === "auto"
        ? ctx.ui.theme.fg("accent", "auto")
        : routerMode === "turbo"
          ? ctx.ui.theme.fg("warning", "turbo")
          : ctx.ui.theme.fg("error", "deep");
    ctx.ui.setStatus("router", `glm:${modeLabel}`);
  }

  async function applyRouting(
    decision: RoutingDecision,
    ctx: ExtensionContext,
  ) {
    const model = ctx.modelRegistry.find(PROVIDER, decision.modelId);
    if (!model) {
      ctx.ui.notify(
        `AutoRouter: Modell "${decision.modelId}" nicht gefunden – Fallback: ${COMPLEX_MODEL_ID}`,
        "warning",
      );
      const fallback = ctx.modelRegistry.find(PROVIDER, COMPLEX_MODEL_ID);
      if (fallback) await pi.setModel(fallback);
      pi.setThinkingLevel("high");
      return;
    }
    await pi.setModel(model);
    pi.setThinkingLevel(decision.level);
  }

  // ── Hooks ───────────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    let decision: RoutingDecision;

    if (routerMode === "auto") {
      decision = analyzePrompt(event.prompt ?? "");
    } else if (routerMode === "turbo") {
      decision = {
        modelId: TURBO_MODEL_ID,
        level: "high",
        reason: "Modus manuell: /turbo",
      };
    } else {
      decision = {
        modelId: COMPLEX_MODEL_ID,
        level: "xhigh",
        reason: "Modus manuell: /deep",
      };
    }

    await applyRouting(decision, ctx);

    const routingKey = `${decision.modelId}/${decision.level}`;
    if (routingKey !== lastRoutingKey) {
      lastRoutingKey = routingKey;
      ctx.ui.notify(
        `AutoRouter: ${decision.modelId} / ${decision.level}\nGrund: ${decision.reason}`,
        "info",
      );
    }
  });

  // ── Kommandos ────────────────────────────────────────────────────────────────

  pi.registerCommand("auto", {
    description:
      "AutoRouter aktivieren (automatische Modell- und Thinking-Wahl)",
    handler: async (_args, ctx) => {
      routerMode = "auto";
      updateStatus(ctx);
      ctx.ui.notify("AutoRouter: Automatischer Modus aktiv", "info");
    },
  });

  pi.registerCommand("turbo", {
    description: "GLM-5-Turbo erzwingen bis /auto",
    handler: async (_args, ctx) => {
      routerMode = "turbo";
      const model = ctx.modelRegistry.find(PROVIDER, TURBO_MODEL_ID);
      if (model) {
        await pi.setModel(model);
        pi.setThinkingLevel("high");
      } else {
        ctx.ui.notify(
          `AutoRouter: "${TURBO_MODEL_ID}" nicht gefunden`,
          "warning",
        );
      }
      updateStatus(ctx);
      ctx.ui.notify(
        `AutoRouter: ${TURBO_MODEL_ID} / high — manuell fixiert`,
        "info",
      );
    },
  });

  pi.registerCommand("deep", {
    description: "GLM-5.2 / xhigh erzwingen bis /auto",
    handler: async (_args, ctx) => {
      routerMode = "deep";
      const model = ctx.modelRegistry.find(PROVIDER, COMPLEX_MODEL_ID);
      if (model) {
        await pi.setModel(model);
        pi.setThinkingLevel("xhigh");
      }
      updateStatus(ctx);
      ctx.ui.notify(
        `AutoRouter: ${COMPLEX_MODEL_ID} / xhigh — manuell fixiert`,
        "info",
      );
    },
  });
}
