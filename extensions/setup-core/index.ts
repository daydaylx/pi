import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { limitTextOutput } from "../shared/output-limits.ts";
import { loadVerifyProfiles } from "./verify-profiles.ts";
import {
  formatGateReport,
  runVerificationGate,
  type GateContext,
} from "./verification-gate.ts";
import { createDoomLoopState, registerDoomLoopDetector } from "./doom-loop.ts";
import {
  createEditMetrics,
  metricsSummary,
  registerEditMetrics,
} from "./edit-metrics.ts";
import {
  createEditFallbackState,
  registerEditFallbackDetector,
} from "./edit-fallback.ts";
import { checkRecoveryStatus, offerRecoveryDialog } from "./recovery-check.ts";
import { loadSetupConfig, type VerificationName } from "./config.ts";
import {
  clearTaskContract,
  createDirectContract,
  loadTaskContract,
  saveTaskContract,
} from "./task-contract.ts";
import {
  WORKFLOW_CAPABILITY_EVENTS,
  type WorkflowStateDiscardedEvent,
} from "../shared/workflow-capabilities.ts";

const CheckParams = Type.Object({
  check: Type.Union([
    Type.Literal("typecheck"),
    Type.Literal("test"),
    Type.Literal("verify"),
  ]),
});

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function packageVersion(path: string): string | undefined {
  const value = readJson(path)?.version;
  return typeof value === "string" ? value : undefined;
}

export default function setupCore(pi: ExtensionAPI): void {
  let activeCwd = process.cwd();
  let trusted = false;
  let recoveryStatus = { interrupted: false, summary: "unbekannt" };
  const doomLoop = createDoomLoopState();
  const editMetrics = createEditMetrics();
  const editFallback = createEditFallbackState();
  registerDoomLoopDetector(pi, doomLoop);
  const existCheck = (p: string) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  };
  registerEditMetrics(pi, editMetrics, { existCheck });
  registerEditFallbackDetector(pi, editFallback, { existCheck });

  const execAdapter: GateContext["exec"] = (program, args, options) =>
    pi.exec(program, args, {
      cwd: options.cwd,
      timeout: options.timeout,
      signal: options.signal as AbortSignal | undefined,
    });

  pi.on("session_start", (_event, ctx) => {
    activeCwd = ctx.cwd;
    trusted = ctx.isProjectTrusted();
    recoveryStatus = checkRecoveryStatus(ctx);
    if (recoveryStatus.interrupted && ctx.hasUI && ctx.mode === "tui") {
      const sessionId = ctx.sessionManager.getSessionId();
      void offerRecoveryDialog(ctx, recoveryStatus, execAdapter).then(
        (result) => {
          if (
            result === "plan-state-discarded" &&
            ctx.sessionManager.getSessionId() === sessionId
          ) {
            pi.events.emit(WORKFLOW_CAPABILITY_EVENTS.stateDiscarded, {
              cwd: ctx.cwd,
              sessionId,
            } satisfies WorkflowStateDiscardedEvent);
          }
        },
      ).catch((error) => {
        if (ctx.sessionManager.getSessionId() !== sessionId) return;
        ctx.ui.notify(
          `Recovery-Dialog wurde sicher abgebrochen: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      });
    }
  });

  pi.registerTool({
    name: "verify",
    label: "Verifizieren",
    description:
      "Führt ausschließlich einen vorkonfigurierten Typecheck, Testlauf oder die vollständige Verifikation aus. Akzeptiert keine freien Shell-Kommandos.",
    promptSnippet:
      "Run a configured typecheck, test, or full verification safely.",
    parameters: CheckParams,
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const loaded = loadSetupConfig(ctx.cwd, ctx.isProjectTrusted());
      const spec = loaded.config.verification[params.check as VerificationName];
      // Verification is a capability of this setup, not a generic project
      // script runner. Keeping the cwd at the agent directory prevents an
      // active repository from replacing npm/package.json or lifecycle hooks.
      const result = await pi.exec(spec.command, spec.args, {
        cwd: getAgentDir(),
        timeout: spec.timeoutMs,
        signal,
      });
      const combined = [result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n");
      const limited = limitTextOutput(combined || "(keine Ausgabe)");
      return {
        content: [{ type: "text" as const, text: limited.text }],
        details: {
          check: params.check,
          exitCode: result.code,
          killed: result.killed,
          ...(limited.truncation ? { truncation: limited.truncation } : {}),
        },
        isError: result.code !== 0,
      };
    },
  });

  pi.registerCommand("setup-doctor", {
    description: "Effektive Setup-Konfiguration und Runtime-Konsistenz prüfen",
    handler: async (_args, ctx) => {
      activeCwd = ctx.cwd;
      trusted = ctx.isProjectTrusted();
      const loaded = loadSetupConfig(activeCwd, trusted);
      const agentDir = getAgentDir();
      const devVersion = packageVersion(
        join(
          agentDir,
          "npm",
          "node_modules",
          "@earendil-works",
          "pi-coding-agent",
          "package.json",
        ),
      );
      const npmManifest = readJson(join(agentDir, "npm", "package.json"));
      const declaredVersion = (
        npmManifest?.devDependencies as Record<string, unknown> | undefined
      )?.["@earendil-works/pi-coding-agent"];
      const settings = readJson(join(agentDir, "settings.json"));
      const subagentSettings = readJson(
        join(agentDir, "extensions", "subagent", "config.json"),
      );
      const runtimeResult = await pi.exec("pi", ["--version"], {
        cwd: activeCwd,
        timeout: 5_000,
      });
      const runtimeVersion =
        runtimeResult.code === 0
          ? runtimeResult.stdout.trim().replace(/^v/, "")
          : undefined;
      const projectProfiles = loadVerifyProfiles(activeCwd, trusted);
      const profileCount = Object.keys(projectProfiles.profiles).length;
      const profileHint = projectProfiles.source
        ? trusted
          ? `${profileCount} Profil(e) geladen`
          : ".pi/verify.json ignoriert (untrusted)"
        : "keine .pi/verify.json";
      const loopHint = doomLoop.lastDetection
        ? `${doomLoop.lastDetection.kind}: ${doomLoop.lastDetection.message}`
        : "keine Doom-Loop erkannt";
      const editHint = metricsSummary(editMetrics);
      const recoveryHint = recoveryStatus.summary;
      const hasVersionDrift =
        String(declaredVersion ?? "") !== String(devVersion ?? "") ||
        (runtimeVersion !== undefined &&
          runtimeVersion !== String(declaredVersion ?? ""));
      const consistencyErrors: string[] = [];
      const enabledModels = Array.isArray(settings?.enabledModels)
        ? settings.enabledModels.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const subagentParallel = subagentSettings?.parallel as
        Record<string, unknown> | undefined;
      if (
        subagentParallel?.concurrency !== loaded.config.subagents.concurrency ||
        subagentSettings?.globalConcurrencyLimit !==
          loaded.config.subagents.concurrency
      ) {
        consistencyErrors.push(
          "Die aktive Subagenten-Parallelität weicht von setup.json ab.",
        );
      }
      const lines = [
        "Setup Doctor",
        `  config: ${loaded.sources.length ? loaded.sources.join(" → ") : "defaults"}`,
        `  project trust: ${trusted ? "trusted" : "untrusted"}`,
        `  theme/motion: ${loaded.config.ui.theme}/${loaded.config.ui.motion}`,
        `  permissions: unknown=${loaded.config.permissions.unknownTools}, bash=${loaded.config.permissions.bash}`,
        `  LSP: ${loaded.config.lsp.enabled ? loaded.config.lsp.mode : "off"}`,
        `  scoped models: ${enabledModels.length || 0} Pattern(s) in settings.enabledModels`,
        `  Pi CLI/dev package: ${runtimeVersion ?? "unknown"}/${String(declaredVersion ?? "?")}`,
        `  installed dev package: ${devVersion ?? "missing"}`,
        `  configured extensions: ${Array.isArray(settings?.extensions) ? settings.extensions.length : "?"}`,
        `  project verification profiles: ${profileHint}`,
        `  doom-loop status: ${loopHint}`,
        `  edit metrics: ${editHint}`,
        `  recovery status: ${recoveryHint}`,
      ];
      for (const diagnostic of loaded.diagnostics) {
        lines.push(
          `  ${diagnostic.level.toUpperCase()}: ${diagnostic.message} (${diagnostic.source})`,
        );
      }
      for (const diagnostic of projectProfiles.diagnostics) {
        lines.push(
          `  ${diagnostic.level.toUpperCase()}: ${diagnostic.message} (${diagnostic.source})`,
        );
      }
      for (const message of consistencyErrors)
        lines.push(`  ERROR: ${message}`);
      if (hasVersionDrift) {
        lines.push(
          "  ERROR: Pi CLI, Manifest und installiertes Dev-Paket sind nicht angeglichen.",
        );
      }
      ctx.ui.notify(
        lines.join("\n"),
        hasVersionDrift ||
          consistencyErrors.length > 0 ||
          loaded.diagnostics.some((d) => d.level === "error")
          ? "error"
          : "info",
      );
    },
  });

  pi.registerCommand("verify-gate", {
    description:
      "Universelles Verifikations-Gate (#102): Diff + Scope + Prüfungen vor dem Abschluss bewerten (advisory).",
    handler: async (_args, ctx) => {
      if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
        ctx.ui.notify(
          "/verify-gate ist erst nach Abschluss des laufenden Agent-Turns verfügbar.",
          "warning",
        );
        return;
      }
      const result = await runVerificationGate({
        projectRoot: ctx.cwd,
        trusted: ctx.isProjectTrusted(),
        exec: execAdapter,
      });
      ctx.ui.notify(
        formatGateReport(result),
        result.status === "pass" ? "info" : "warning",
      );
    },
  });

  pi.registerCommand("task", {
    description:
      "Direkte Aufgabe (ohne /plan) beginnen: /task <Ziel> — legt einen Task-Contract an, den /task-done gegen das Gate prüft.",
    handler: async (args, ctx) => {
      const goal = args.trim();
      if (!goal) {
        ctx.ui.notify("Nutzung: /task <Ziel>", "info");
        return;
      }
      const existing = loadTaskContract(ctx.cwd);
      if (existing.contract) {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          ctx.ui.notify(
            `Es existiert bereits ein Task-Contract ("${existing.contract.goal}"). Überschreiben ist ohne interaktive Bestätigung nicht möglich.`,
            "warning",
          );
          return;
        }
        const overwrite = await ctx.ui.confirm(
          "Bestehenden Task-Contract überschreiben?",
          `Aktuell: "${existing.contract.goal}" (${existing.contract.source === "plan" ? "aus Plan abgeleitet" : "direkte Aufgabe"}). Neu: "${goal}".`,
        );
        if (!overwrite) {
          ctx.ui.notify(
            "Abgebrochen; bestehender Task-Contract bleibt aktiv.",
            "info",
          );
          return;
        }
      }
      saveTaskContract(ctx.cwd, createDirectContract(goal));
      ctx.ui.notify(
        `Direkte Aufgabe gestartet: "${goal}". Nutze /task-done zum Abschluss.`,
        "info",
      );
    },
  });

  pi.registerCommand("task-done", {
    description:
      "Direkte Aufgabe (ohne /plan) abschließen: prüft das Verifikations-Gate und löscht danach den Task-Contract.",
    handler: async (_args, ctx) => {
      const loaded = loadTaskContract(ctx.cwd);
      if (!loaded.contract || loaded.contract.source !== "direct") {
        ctx.ui.notify("Keine aktive direkte Aufgabe.", "info");
        return;
      }
      const result = await runVerificationGate({
        projectRoot: ctx.cwd,
        trusted: ctx.isProjectTrusted(),
        exec: execAdapter,
      });
      if (result.status !== "pass") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          ctx.ui.notify(
            `Verifikations-Gate ${result.status.toUpperCase()}: Abschluss ohne interaktive Bestätigung nicht möglich.\n${formatGateReport(result)}`,
            "warning",
          );
          return;
        }
        const override = await ctx.ui.confirm(
          `Verifikations-Gate ${result.status.toUpperCase()} — trotzdem abschließen?`,
          formatGateReport(result),
        );
        if (!override) {
          ctx.ui.notify(
            "Abschluss abgebrochen; Gate-Ergebnis siehe oben.",
            "info",
          );
          return;
        }
      }
      clearTaskContract(ctx.cwd);
      ctx.ui.notify("Direkte Aufgabe abgeschlossen.", "info");
    },
  });
}
